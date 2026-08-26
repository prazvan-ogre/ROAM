import { supabase } from "./supabase/client";
import { submitResponse, type AnswerOption, type ExploreLink, type Question, type Response } from "./discover";
import type { Database, BattleTeam } from "./supabase/types";

export type Battle = Database["public"]["Tables"]["battles"]["Row"];

export interface BattleQuestion {
  question: Question;
  options: AnswerOption[];
  exploreLinks: ExploreLink[];
}

export interface BattleContent {
  battle: Battle;
  questions: BattleQuestion[];
}

export async function loadBattleContent(battle: Battle): Promise<BattleContent> {
  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("*")
    .eq("battle_id", battle.id)
    .order("order_index", { ascending: true });

  if (questionsError) throw questionsError;

  const withOptions: BattleQuestion[] = [];
  for (const question of questions ?? []) {
    const [{ data: options, error: optionsError }, { data: exploreLinks, error: exploreError }] =
      await Promise.all([
        supabase
          .from("answer_options")
          .select("*")
          .eq("question_id", question.id)
          .order("order_index", { ascending: true }),
        supabase
          .from("explore_links")
          .select("*")
          .eq("question_id", question.id)
          .order("order_index", { ascending: true }),
      ]);
    if (optionsError) throw optionsError;
    if (exploreError) throw exploreError;
    withOptions.push({ question, options: options ?? [], exploreLinks: exploreLinks ?? [] });
  }

  return { battle, questions: withOptions };
}

// Daily battles (spec sections 15-17) are published/verified just like
// Discover content -- gating on those flags is also the "admin override
// makes content immediately available" mechanism from spec section 30,
// so no separate time-of-day logic is needed.
export async function getDailyBattle(tripId: string, dayNumber: number): Promise<BattleContent | null> {
  const { data: battle, error } = await supabase
    .from("battles")
    .select("*")
    .eq("trip_id", tripId)
    .eq("day_number", dayNumber)
    .eq("is_final", false)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!battle) return null;
  return loadBattleContent(battle);
}

export async function getFinalBattle(tripId: string): Promise<BattleContent | null> {
  const { data: battle, error } = await supabase
    .from("battles")
    .select("*")
    .eq("trip_id", tripId)
    .eq("is_final", true)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw error;
  if (!battle) return null;
  return loadBattleContent(battle);
}

// Product owner spec: every participant answers Battle questions
// individually now, not one submission per team via a shared
// "controller" device. Correct answers are worth 10 points (Final
// Battle: 5 points), same values as before.
const BATTLE_POINTS = { normal: 10, final: 5 } as const;

// A team's evening result stays open for 15 minutes after the first
// individual answer, so everyone gets a chance to answer before anyone
// sees the running score (product owner spec). Late answers past that
// window still count personally (submitResponse below) but are excluded
// from battle_scores, so they can't move the team result -- same
// guarantee as a catch-up answer to a past battle (getCatchUpQuestions).
const RESULT_WINDOW_MS = 15 * 60 * 1000;

export interface BattleWindowStatus {
  // Whether a fresh answer right now would still count toward the team
  // result (true before anyone has answered yet, or within 15 minutes of
  // the first individual answer).
  countable: boolean;
  // Whether the team result is old enough to reveal. False for the whole
  // 15-minute window, even to someone who already answered -- the point
  // is nobody sees a partial score while others might still be deciding.
  visible: boolean;
  opensAt: string | null;
  closesAt: string | null;
}

export async function getBattleWindowStatus(battleId: string): Promise<BattleWindowStatus> {
  const { data, error } = await supabase
    .from("battle_scores")
    .select("created_at")
    .eq("battle_id", battleId)
    .not("participant_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { countable: true, visible: false, opensAt: null, closesAt: null };

  const opensAt = new Date(data.created_at).getTime();
  const closesAt = opensAt + RESULT_WINDOW_MS;
  const now = Date.now();
  return {
    countable: now < closesAt,
    visible: now >= closesAt,
    opensAt: data.created_at,
    closesAt: new Date(closesAt).toISOString(),
  };
}

// One participant's answer to one Battle question, live (not a catch-up
// answer to a past battle -- see getCatchUpQuestions, which never
// touches battle_scores at all). Always records a personal
// `responses` row (submitResponse, same as Discover -- feeds the
// individual leaderboard and prevents answering the same question
// twice). Also adds a battle_scores row with this participant's team +
// score, unless the 15-minute result window has already closed -- a
// late answer still counts personally, just never moves the team
// result.
export async function recordBattleAnswer(
  participantId: string,
  team: BattleTeam,
  battleId: string,
  question: Question,
  selectedOption: AnswerOption,
  isFinal: boolean,
): Promise<Response> {
  const response = await submitResponse(participantId, question.id, selectedOption);

  const window = await getBattleWindowStatus(battleId);
  if (window.countable) {
    const { error } = await supabase.from("battle_scores").insert({
      battle_id: battleId,
      participant_id: participantId,
      team,
      score: selectedOption.is_correct ? (isFinal ? BATTLE_POINTS.final : BATTLE_POINTS.normal) : 0,
    });
    if (error) throw error;
  }

  return response;
}

// A team's resolved score for one battle: the arithmetic mean of its
// members' points (sum / distinct participants who answered), so an
// uneven team size (e.g. 3 kids vs 2 adults) doesn't skew the result.
// Battles played before this feature (participant_id null rows) keep
// their original raw-sum result instead -- see the migration.
export async function getBattleTeamScore(battleId: string): Promise<Record<BattleTeam, number>> {
  const { data, error } = await supabase.rpc("battle_team_score", { p_battle_id: battleId });
  if (error) throw error;
  const result: Record<BattleTeam, number> = { adults: 0, kids: 0 };
  for (const row of data ?? []) {
    result[row.team] = row.score;
  }
  return result;
}

// The headline "PĂRINȚI X — COPII Y" for one evening: 1 for whichever
// team has the higher resolved score (see getBattleTeamScore), 1-1 on a
// tie. Only meaningful once the result window has closed (caller should
// gate on getBattleWindowStatus().visible first) -- an unplayed or
// still-open battle reads as a tie otherwise.
export async function getBattleResult(battleId: string): Promise<Record<BattleTeam, number>> {
  const scores = await getBattleTeamScore(battleId);
  return {
    adults: scores.adults >= scores.kids ? 1 : 0,
    kids: scores.kids >= scores.adults ? 1 : 0,
  };
}

// The season-long "PĂRINȚI vs COPII" headline: sum of evenings won (see
// trip_battle_win_tally() -- tie evenings count for both teams).
export async function getTripBattleWinTally(tripId: string): Promise<Record<BattleTeam, number>> {
  const { data, error } = await supabase.rpc("trip_battle_win_tally", { p_trip_id: tripId });
  if (error) throw error;
  const result: Record<BattleTeam, number> = { adults: 0, kids: 0 };
  for (const row of data ?? []) {
    result[row.team] = row.wins;
  }
  return result;
}
