import { supabase } from "./supabase/client";
import type { Database, ParticipantRole, QuestionSlot } from "./supabase/types";

export type Question = Database["public"]["Tables"]["questions"]["Row"];
export type AnswerOption = Database["public"]["Tables"]["answer_options"]["Row"];
export type ExploreLink = Database["public"]["Tables"]["explore_links"]["Row"];
export type Extra = Database["public"]["Tables"]["extras"]["Row"];
export type Response = Database["public"]["Tables"]["responses"]["Row"];

export interface DiscoverQuestion {
  question: Question;
  options: AnswerOption[];
  exploreLinks: ExploreLink[];
}

// Only published + verified content is ever fetched -- RLS enforces this
// server-side too (docs/DATABASE.md "Content integrity"), this is just
// the client-side mirror of the same rule.
export async function getDiscoverQuestion(
  tripId: string,
  dayNumber: number,
  slot: QuestionSlot,
): Promise<DiscoverQuestion | null> {
  const { data: question, error: questionError } = await supabase
    .from("questions")
    .select("*")
    .eq("trip_id", tripId)
    .eq("kind", "discover")
    .eq("day_number", dayNumber)
    .eq("slot", slot)
    .maybeSingle();

  if (questionError) throw questionError;
  if (!question) return null;

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

  return { question, options: options ?? [], exploreLinks: exploreLinks ?? [] };
}

export async function getMyResponse(
  participantId: string,
  questionId: string,
): Promise<Response | null> {
  const { data, error } = await supabase
    .from("responses")
    .select("*")
    .eq("participant_id", participantId)
    .eq("question_id", questionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function submitResponse(
  participantId: string,
  questionId: string,
  selectedOption: AnswerOption,
): Promise<Response> {
  const { data, error } = await supabase
    .from("responses")
    .insert({
      participant_id: participantId,
      question_id: questionId,
      selected_option_id: selectedOption.id,
      is_correct: selectedOption.is_correct,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Assigns (or returns the already-assigned) Extra for this participant +
// question. Eligible extras are filtered by audience and load-balanced by
// picking whichever eligible extra currently has the fewest assignments,
// so different participants tend to see different Extras (spec section
// 11) without needing a database function for it.
export async function getOrAssignExtra(
  participantId: string,
  participantRole: ParticipantRole,
  questionId: string,
): Promise<Extra | null> {
  const { data: eligible, error: extrasError } = await supabase
    .from("extras")
    .select("*")
    .eq("question_id", questionId)
    .in("audience", ["all", participantRole]);

  if (extrasError) throw extrasError;
  if (!eligible || eligible.length === 0) return null;

  const eligibleIds = eligible.map((e) => e.id);

  const { data: existingAssignment, error: assignmentError } = await supabase
    .from("extra_assignments")
    .select("extra_id")
    .eq("participant_id", participantId)
    .in("extra_id", eligibleIds)
    .maybeSingle();

  if (assignmentError) throw assignmentError;
  if (existingAssignment) {
    const assignedExtra = eligible.find((e) => e.id === existingAssignment.extra_id);
    if (assignedExtra) return assignedExtra;
  }

  const { data: counts, error: countsError } = await supabase
    .from("extra_assignments")
    .select("extra_id")
    .in("extra_id", eligibleIds);

  if (countsError) throw countsError;

  const countByExtra = new Map<string, number>(eligibleIds.map((id) => [id, 0]));
  for (const row of counts ?? []) {
    countByExtra.set(row.extra_id, (countByExtra.get(row.extra_id) ?? 0) + 1);
  }

  const leastAssigned = eligible.reduce((min, e) =>
    (countByExtra.get(e.id) ?? 0) < (countByExtra.get(min.id) ?? 0) ? e : min,
  );

  const { error: insertError } = await supabase.from("extra_assignments").insert({
    extra_id: leastAssigned.id,
    participant_id: participantId,
  });

  if (insertError) throw insertError;
  return leastAssigned;
}
