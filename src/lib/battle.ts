import { supabase } from "./supabase/client";
import type { AnswerOption, Question } from "./discover";
import type { Database, BattleTeam } from "./supabase/types";

export type Battle = Database["public"]["Tables"]["battles"]["Row"];

export interface BattleQuestion {
  question: Question;
  options: AnswerOption[];
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
    const { data: options, error: optionsError } = await supabase
      .from("answer_options")
      .select("*")
      .eq("question_id", question.id)
      .order("order_index", { ascending: true });
    if (optionsError) throw optionsError;
    withOptions.push({ question, options: options ?? [] });
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

export async function isBattleCompleted(battleId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("battle_scores")
    .select("id", { count: "exact", head: true })
    .eq("battle_id", battleId);

  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function recordTeamAnswer(
  battleId: string,
  team: BattleTeam,
  isCorrect: boolean,
): Promise<void> {
  const { error } = await supabase.from("battle_scores").insert({
    battle_id: battleId,
    team,
    score: isCorrect ? 1 : 0,
  });
  if (error) throw error;
}

export async function getBattleLeaderboard(
  battleId: string,
): Promise<Record<BattleTeam, number>> {
  const { data, error } = await supabase.rpc("battle_leaderboard", { p_battle_id: battleId });
  if (error) throw error;
  const result: Record<BattleTeam, number> = { adults: 0, kids: 0 };
  for (const row of data ?? []) {
    result[row.team] = row.total_score;
  }
  return result;
}

export async function getTripLeaderboard(tripId: string): Promise<Record<BattleTeam, number>> {
  const { data, error } = await supabase.rpc("trip_battle_leaderboard", { p_trip_id: tripId });
  if (error) throw error;
  const result: Record<BattleTeam, number> = { adults: 0, kids: 0 };
  for (const row of data ?? []) {
    result[row.team] = row.total_score;
  }
  return result;
}
