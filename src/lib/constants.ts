import type { QuestionSlot, TripDifficulty, TripQuestionStyle } from "./supabase/types";

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

// Trip editorial brief (20260909090000_trip_editorial_brief.sql): the
// allowed value sets and length limit both the client form and
// src/lib/editorialBrief.ts's server-side validation check against --
// trip_editorial_briefs' own trip_difficulty/trip_question_style enums
// and its narrator-name length CHECK are the actual, non-bypassable
// source of truth; these are documented mirrors, same convention as
// MIN/MAX_TRIP_DURATION_DAYS above (SQL can't import a TS constant).
export const TRIP_DIFFICULTIES: readonly TripDifficulty[] = ["easy", "medium", "hard"];
export const TRIP_QUESTION_STYLES: readonly TripQuestionStyle[] = ["fun", "academic", "narrated_by_character"];
export const MAX_NARRATOR_CHARACTER_NAME_LENGTH = 80;

// Visible, editable starting proposals shown on a fresh creation-form
// brief -- never a claim about any existing trip's actual preferences
// (see app/page.tsx and app/trip/[slug]/settings/page.tsx: a trip with
// no saved brief row shows "Preferințe nespecificate", not these).
export const DEFAULT_TRIP_DIFFICULTY: TripDifficulty = "medium";
export const DEFAULT_TRIP_QUESTION_STYLE: TripQuestionStyle = "fun";
export const DEFAULT_THEME_DISTRIBUTION = { history: 25, places: 25, food: 25, curiosities: 25 } as const;
