import { supabase } from "./supabase/client";
import type { Database } from "./supabase/types";

export type FeedbackInput = Omit<
  Database["public"]["Tables"]["feedback"]["Row"],
  "id" | "created_at"
>;

export async function submitFeedback(input: FeedbackInput): Promise<void> {
  const { error } = await supabase.from("feedback").insert(input);
  if (error) {
    // R4 (2026-09-06 batch): `unique (trip_id, participant_id)`
    // (20260907100000_r4_feedback_participant_unique.sql) is the
    // idempotency signal a retry needs -- a lost confirmation (the
    // insert committed, but the response never reached this call) used
    // to surface as a hard error on retry, even though the feedback had
    // already been recorded. Postgres code 23505 = unique_violation:
    // this participant already has feedback on record for this trip, so
    // there is nothing left to save.
    if (error.code === "23505") return;
    throw error;
  }
}
