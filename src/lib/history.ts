import { supabase } from "./supabase/client";
import { loadBattleContent, getBattleTeamScore, type BattleContent } from "./battle";
import type { AnswerOption, Question, Response } from "./discover";
import type { BattleTeam } from "./supabase/types";

export interface DiscoverHistoryItem {
  question: Question;
  options: AnswerOption[];
  responsesByParticipant: Record<string, Response>;
}

export interface BattleHistoryItem {
  content: BattleContent;
  score: Record<BattleTeam, number>;
}

export interface TripHistory {
  discover: DiscoverHistoryItem[];
  battles: BattleHistoryItem[];
}

// Recap of everything published so far -- spec has no direct section for
// this, added at the product owner's explicit request. Only published/
// verified content can ever be fetched (RLS), so "so far" already excludes
// draft content for later days.
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
  const questionIds = sortedQuestions.map((q) => q.id);

  if (questionIds.length > 0) {
    const { data: optionRows, error: optionsError } = await supabase
      .from("answer_options")
      .select("*")
      .in("question_id", questionIds);
    if (optionsError) throw optionsError;
    options = optionRows ?? [];

    if (profileIds.length > 0) {
      const { data: responseRows, error: responsesError } = await supabase
        .from("responses")
        .select("*")
        .in("question_id", questionIds)
        .in("participant_id", profileIds);
      if (responsesError) throw responsesError;
      responses = responseRows ?? [];
    }
  }

  const discover: DiscoverHistoryItem[] = sortedQuestions.map((question) => ({
    question,
    options: options.filter((o) => o.question_id === question.id),
    responsesByParticipant: Object.fromEntries(
      responses.filter((r) => r.question_id === question.id).map((r) => [r.participant_id, r]),
    ),
  }));

  const { data: battleRows, error: battlesError } = await supabase
    .from("battles")
    .select("*")
    .eq("trip_id", tripId)
    .eq("is_active", true);
  if (battlesError) throw battlesError;

  const battles: BattleHistoryItem[] = [];
  for (const battle of battleRows ?? []) {
    const { count } = await supabase
      .from("battle_scores")
      .select("id", { count: "exact", head: true })
      .eq("battle_id", battle.id);
    if (!count) continue;

    const [content, score] = await Promise.all([
      loadBattleContent(battle),
      getBattleTeamScore(battle.id),
    ]);
    battles.push({ content, score });
  }
  battles.sort((a, b) => (a.content.battle.day_number ?? 0) - (b.content.battle.day_number ?? 0));

  return { discover, battles };
}
