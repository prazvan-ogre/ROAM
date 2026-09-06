import { supabase } from "./supabase/client";
import type { Database } from "./supabase/types";

export type FeedbackInput = Omit<
  Database["public"]["Tables"]["feedback"]["Row"],
  "id" | "created_at" | "client_request_id"
>;

// R4 correction (2026-09-06 batch, round 2): requestId is a real
// idempotency key (client_request_id, 20260907120000_r4_feedback_
// request_id_idempotency.sql) instead of a `unique (trip_id,
// participant_id)` constraint -- that constraint asserted a "one
// feedback ever per participant" product rule that was never actually
// confirmed (see the migration's own comment for why its original
// justification, the per-device localStorage flag, didn't hold up).
// requestId gives retry-safety alone: FeedbackForm generates one id per
// submission attempt and keeps it stable across a retry of THAT
// attempt, so a lost-confirmation resend can't create a duplicate --
// without deciding whether a genuinely separate second submission
// should ever be allowed (a different id always succeeds; that's a
// product question left open, not answered here).
export async function submitFeedback(input: FeedbackInput, requestId: string): Promise<void> {
  const { error } = await supabase.from("feedback").insert({ ...input, client_request_id: requestId });
  if (error) {
    // 23505 here can only mean THIS requestId already has a row -- since
    // the key is generated fresh per attempt (never reused across a
    // materially different submission, see FeedbackForm), there is no
    // ambiguity to reconcile: this is that same attempt's own earlier
    // insert already having landed, not a different submission's
    // content to compare against. feedback has no SELECT policy at all
    // (intentionally -- "nothing reads it back through the anon key",
    // 20260907090000_batch2_trip_activity_rls.sql), so this never needs
    // to read feedback content back to know that.
    if (error.code === "23505") return;
    throw error;
  }
}
