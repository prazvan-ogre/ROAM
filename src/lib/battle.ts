import { supabase } from "./supabase/client";
import type { AnswerOption, ExploreLink, Question } from "./discover";
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

  const questionIds = (questions ?? []).map((q) => q.id);
  const [{ data: options, error: optionsError }, { data: exploreLinks, error: exploreError }] =
    questionIds.length === 0
      ? [{ data: [], error: null } as const, { data: [], error: null } as const]
      : await Promise.all([
          supabase
            .from("answer_options")
            .select("id, question_id, order_index, label, created_at")
            .in("question_id", questionIds)
            .order("order_index", { ascending: true }),
          supabase
            .from("explore_links")
            .select("*")
            .in("question_id", questionIds)
            .order("order_index", { ascending: true }),
        ]);
  if (optionsError) throw optionsError;
  if (exploreError) throw exploreError;

  const withOptions: BattleQuestion[] = (questions ?? []).map((question) => ({
    question,
    options: (options ?? []).filter((o) => o.question_id === question.id),
    exploreLinks: (exploreLinks ?? []).filter((l) => l.question_id === question.id),
  }));

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

// A team's evening result stays open for 15 minutes after the first
// individual answer, so everyone gets a chance to answer before anyone
// sees the running score (product owner spec). Late answers past that
// window still count personally (submitAnswer/record_answer's own
// responses insert, src/lib/discover.ts) but are excluded from
// battle_scores, so they can't move the team result -- same guarantee as
// a catch-up answer to a past battle (getCatchUpQuestions).
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

// Battle answers no longer have a dedicated submission function: R3
// (20260906140000_record_answer_authoritative.sql) unified Discover,
// Battle, Final and Catchup behind the single submitAnswer() in
// src/lib/discover.ts -- BattleFlow.tsx calls that directly. There is no
// "isFinal"/team/score parameter to pass anymore: the server derives all
// of it from the question/battle rows themselves (points from
// questions.points, team from the participant's own role, team-window
// eligibility from real timing, not a client-supplied flag), and decides
// on its own whether a battle-kind question's answer is still allowed to
// open or join the team's 15-minute result window -- including the
// product-owner-confirmed rule that a battle nobody played live, later
// recovered through Catchup (or any other late answer), always still
// scores personally but can never move the team result.

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
