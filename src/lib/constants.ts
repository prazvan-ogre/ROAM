import type { QuestionSlot } from "./supabase/types";

// R7: the trip duration bounds every layer that creates or validates a
// trip must agree on -- app/page.tsx's own duration picker,
// app/api/trips/create/route.ts's server-side check, and
// validate_trip_content()'s own v_min_duration/v_max_duration
// (supabase/migrations/20260908090000_r7_content_publishing_pipeline.sql
// -- SQL can't import a TS constant, so that copy is a documented mirror
// of this one -- keep both in sync if these ever change).
export const MIN_TRIP_DURATION_DAYS = 3;
export const MAX_TRIP_DURATION_DAYS = 10;

// Shared display labels for Discover/Battle content. Was previously
// duplicated verbatim across app/trip/[slug]/page.tsx, discover/[slot]/
// page.tsx, catchup/page.tsx, questions/page.tsx, and
// src/components/BattleFlow.tsx -- one place to change a label instead
// of three or four.
export const SLOT_LABEL: Record<QuestionSlot | "battle", string> = {
  morning: "Dimineață",
  lunch: "Prânz",
  battle: "Battle",
};

export const EXTRA_TYPE_LABEL: Record<string, string> = {
  know: "ȘTIAI CĂ",
  think: "GÂNDEȘTE-TE",
  connect: "CONEXIUNE",
  ask: "ÎNTREABĂ",
  explore: "EXPLOREAZĂ",
};
