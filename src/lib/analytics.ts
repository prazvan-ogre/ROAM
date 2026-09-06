import { supabase } from "./supabase/client";

// Event names from the ROAM spec. Storing in Supabase keeps the MVP on one
// backend; swap for PostHog later without touching call sites if needed.
export type AnalyticsEventName =
  | "trip_joined"
  | "question_opened"
  | "answer_submitted"
  | "answer_correct"
  | "extra_viewed"
  | "explore_clicked"
  | "battle_opened"
  | "battle_answered"
  | "final_battle_started"
  | "final_battle_completed"
  | "feedback_submitted";

export async function trackEvent(
  tripId: string,
  eventName: AnalyticsEventName,
  participantId?: string,
  props: Record<string, unknown> = {},
) {
  // R4 (2026-09-06 batch): the doc comment below already promised
  // analytics "must never break the product flow", but only a query-level
  // {error} was ever caught -- a network-level exception from the fetch
  // itself (offline, DNS failure, a dropped connection) still threw
  // straight out of this function. Several call sites `await` this
  // (Discover's initial load, BattleFlow's handleStart, FeedbackForm and
  // OnboardingWizard's own success paths) specifically because ordering
  // matters there, not because they want a failure here to abort an
  // otherwise-successful flow -- Discover's `load()` catch, for instance,
  // used to turn a pure analytics hiccup into "could not load the
  // question" for the whole page. Catching here, once, is what actually
  // delivers on the comment below instead of merely stating it.
  try {
    const { error } = await supabase.from("analytics_events").insert({
      trip_id: tripId,
      participant_id: participantId ?? null,
      event_name: eventName,
      event_props: props,
    });
    // Analytics must never break the product flow — log and move on.
    if (error) {
      console.error("trackEvent failed", eventName, error);
    }
  } catch (err) {
    console.error("trackEvent threw", eventName, err);
  }
}
