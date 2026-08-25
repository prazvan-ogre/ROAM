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
}
