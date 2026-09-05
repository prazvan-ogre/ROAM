import type { QuestionSlot } from "./supabase/types";

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
