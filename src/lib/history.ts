import { supabase } from "./supabase/client";
import { loadBattleContent, getBattleTeamScore, type Battle } from "./battle";
import type { AnswerOption, Extra, ExploreLink, Question, Response } from "./discover";
import type { BattleTeam } from "./supabase/types";

export interface DiscoverHistoryItem {
  question: Question;
  options: AnswerOption[];
  responsesByParticipant: Record<string, Response>;
  // Whichever Extra was assigned to each of this device's participants
  // when they played this question live (extra_assignments) -- not a
  // fresh assignment, just reading back what they already got, same as
  // responsesByParticipant reads back their existing response.
  extrasByParticipant: Record<string, Extra>;
  exploreLinks: ExploreLink[];
}

export interface BattleHistoryQuestion {
  question: Question;
  options: AnswerOption[];
  exploreLinks: ExploreLink[];
  responsesByParticipant: Record<string, Response>;
}

export interface BattleHistoryItem {
  battle: Battle;
  score: Record<BattleTeam, number>;
  questions: BattleHistoryQuestion[];
}

export interface TripHistory {
  discover: DiscoverHistoryItem[];
  battles: BattleHistoryItem[];
}

// Recap of every Discover question reached so far (day_number <=
// uptoDay), plus every Battle anyone's played. Product owner follow-up:
// a question the calendar hasn't reached yet must not appear at all --
// even its bare prompt lets someone look the answer up elsewhere ahead
// of time -- so this stays day-gated, unlike the reveal below. Only
// published/verified content can ever be fetched (RLS) regardless. The
// correct answer, One Thing, Common Core, and assigned Extra for a
// Discover question are only meaningful once this device has actually
// answered it -- callers must gate the reveal on `responsesByParticipant`
// having an entry, same spoiler-avoidance the live Discover flow already
// has by construction.
export async function getTripHistory(
  tripId: string,
  uptoDay: number,
  profileIds: string[],
): Promise<TripHistory> {
  const { data: questionRows, error: questionsError } = await supabase
    .from("questions")
    .select("*")
    .eq("trip_id", tripId)
    .eq("kind", "discover")
    .lte("day_number", uptoDay);
  if (questionsError) throw questionsError;

  const sortedQuestions = (questionRows ?? []).slice().sort((a, b) => {
    if (a.day_number !== b.day_number) return (a.day_number ?? 0) - (b.day_number ?? 0);
    return (a.slot === "morning" ? 0 : 1) - (b.slot === "morning" ? 0 : 1);
  });

  let options: AnswerOption[] = [];
  let responses: Response[] = [];
  let extras: Extra[] = [];
  let assignments: { participant_id: string; extra_id: string }[] = [];
  let exploreLinks: ExploreLink[] = [];
  const questionIds = sortedQuestions.map((q) => q.id);

  if (questionIds.length > 0) {
    const [
      { data: optionRows, error: optionsError },
      { data: extraRows, error: extrasError },
      { data: linkRows, error: linksError },
    ] = await Promise.all([
      supabase.from("answer_options").select("*").in("question_id", questionIds),
      supabase.from("extras").select("*").in("question_id", questionIds),
      supabase.from("explore_links").select("*").in("question_id", questionIds),
    ]);
    if (optionsError) throw optionsError;
    if (extrasError) throw extrasError;
    if (linksError) throw linksError;
    options = optionRows ?? [];
    extras = extraRows ?? [];
    exploreLinks = linkRows ?? [];

    if (profileIds.length > 0) {
      const extraIds = extras.map((e) => e.id);
      const [{ data: responseRows, error: responsesError }, assignmentResult] = await Promise.all([
        supabase.from("responses").select("*").in("question_id", questionIds).in("participant_id", profileIds),
        extraIds.length > 0
          ? supabase
              .from("extra_assignments")
              .select("participant_id, extra_id")
              .in("participant_id", profileIds)
              .in("extra_id", extraIds)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (responsesError) throw responsesError;
      if (assignmentResult.error) throw assignmentResult.error;
      responses = responseRows ?? [];
      assignments = assignmentResult.data ?? [];
    }
  }

  const extraById = new Map(extras.map((e) => [e.id, e]));

  const discover: DiscoverHistoryItem[] = sortedQuestions.map((question) => {
    const questionExtraIds = new Set(extras.filter((e) => e.question_id === question.id).map((e) => e.id));
    const extrasByParticipant: Record<string, Extra> = {};
    for (const a of assignments) {
      if (!questionExtraIds.has(a.extra_id)) continue;
      const extra = extraById.get(a.extra_id);
      if (extra) extrasByParticipant[a.participant_id] = extra;
    }
    return {
      question,
      options: options.filter((o) => o.question_id === question.id),
      responsesByParticipant: Object.fromEntries(
        responses.filter((r) => r.question_id === question.id).map((r) => [r.participant_id, r]),
      ),
      extrasByParticipant,
      exploreLinks: exploreLinks.filter((l) => l.question_id === question.id),
    };
  });

  const battles: BattleHistoryItem[] = [];
  if (profileIds.length > 0) {
    const { data: battleRows, error: battlesError } = await supabase
      .from("battles")
      .select("*")
      .eq("trip_id", tripId)
      .eq("is_active", true);
    if (battlesError) throw battlesError;

    for (const battle of battleRows ?? []) {
      const content = await loadBattleContent(battle);
      const battleQuestionIds = content.questions.map((q) => q.question.id);
      if (battleQuestionIds.length === 0) continue;

      // Same spoiler-avoidance rule as Discover above: a Battle question
      // only appears once this device's own participants have actually
      // answered it, via their individual `responses` row (live play or
      // catch-up alike) -- not merely because the battle has been played
      // by someone, somewhere, on another device.
      const { data: battleResponseRows, error: battleResponsesError } = await supabase
        .from("responses")
        .select("*")
        .in("question_id", battleQuestionIds)
        .in("participant_id", profileIds);
      if (battleResponsesError) throw battleResponsesError;

      const questions: BattleHistoryQuestion[] = content.questions
        .map(({ question, options, exploreLinks }) => ({
          question,
          options,
          exploreLinks,
          responsesByParticipant: Object.fromEntries(
            (battleResponseRows ?? [])
              .filter((r) => r.question_id === question.id)
              .map((r) => [r.participant_id, r]),
          ),
        }))
        .filter((q) => Object.keys(q.responsesByParticipant).length > 0);
      if (questions.length === 0) continue;

      const score = await getBattleTeamScore(battle.id);
      battles.push({ battle, score, questions });
    }
    battles.sort((a, b) => (a.battle.day_number ?? 0) - (b.battle.day_number ?? 0));
  }

  return { discover, battles };
}
