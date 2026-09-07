import type { QuestionSlot, QuestionThemeCategory, TripDifficulty } from "@/lib/supabase/types";
import {
  MAX_GENERATED_QUESTION_EXPLANATION_LENGTH,
  MAX_GENERATED_QUESTION_OPTIONS,
  MAX_GENERATED_QUESTION_PROMPT_LENGTH,
  MIN_GENERATED_QUESTION_OPTIONS,
  QUESTION_THEME_CATEGORIES,
  TRIP_DIFFICULTIES,
} from "@/lib/constants";
import type { GenerationSlotRequest } from "@/lib/ai/questionGenerationProvider";

// R9 (20260910090000_r9_question_generation.sql): the strict schema an
// AI-generated question (or an admin's own edit of one, before
// acceptance) must satisfy -- validated server-side, before anything is
// ever persisted. Mirrors src/lib/editorialBrief.ts's own posture (real
// TypeScript validation, not just parsed Postgres constraint text): a
// generation response is semi-structured JSON from an external provider,
// which is exactly the kind of check this codebase already chose TS for
// over a database CHECK constraint. accept_generated_question_draft()
// (the SQL function) re-derives the same rules procedurally as the
// actual, non-bypassable last line of defense -- this module is what
// gives the admin UI (and this module's own bulk parser) a clear,
// field-scoped reason BEFORE that RPC is ever called.

export interface GeneratedOption {
  label: string;
  is_correct: boolean;
}

export interface GeneratedQuestionContent {
  prompt: string;
  explanation: string;
  options: GeneratedOption[];
  themeCategory: QuestionThemeCategory;
  difficulty: TripDifficulty;
  dayNumber: number;
  slot: QuestionSlot;
}

export type ValidatedGeneratedQuestion = GeneratedQuestionContent;

export type ContentValidationError =
  | "prompt_missing"
  | "prompt_too_long"
  | "explanation_missing"
  | "explanation_too_long"
  | "options_count"
  | "options_duplicate_label"
  | "options_correct_count"
  | "theme_category_unsupported"
  | "difficulty_unsupported"
  | "day_out_of_range"
  | "slot_unsupported";

// Validates ONE question's content -- reused both for each item inside
// a bulk AI response (validateGeneratedQuestionsResponse below) and for
// an admin's own edit of a single draft before it's accepted
// (app/api/trips/[slug]/generate/drafts/[draftId]/accept -- the same
// module the UI's own inline field errors come from).
export function validateGeneratedQuestionContent(
  input: {
    prompt: unknown;
    explanation: unknown;
    options: unknown;
    themeCategory: unknown;
    difficulty: unknown;
    dayNumber: unknown;
    slot: unknown;
  },
  durationDays: number,
): { ok: true; value: GeneratedQuestionContent } | { ok: false; errors: ContentValidationError[] } {
  const errors: ContentValidationError[] = [];

  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) errors.push("prompt_missing");
  else if (prompt.length > MAX_GENERATED_QUESTION_PROMPT_LENGTH) errors.push("prompt_too_long");

  const explanation = typeof input.explanation === "string" ? input.explanation.trim() : "";
  if (!explanation) errors.push("explanation_missing");
  else if (explanation.length > MAX_GENERATED_QUESTION_EXPLANATION_LENGTH) errors.push("explanation_too_long");

  let options: GeneratedOption[] = [];
  if (
    Array.isArray(input.options) &&
    input.options.every(
      (o): o is GeneratedOption =>
        typeof o === "object" && o !== null && typeof (o as GeneratedOption).label === "string" && typeof (o as GeneratedOption).is_correct === "boolean",
    )
  ) {
    options = (input.options as GeneratedOption[]).map((o) => ({ label: o.label.trim(), is_correct: o.is_correct }));
  }
  if (options.length < MIN_GENERATED_QUESTION_OPTIONS || options.length > MAX_GENERATED_QUESTION_OPTIONS || options.some((o) => !o.label)) {
    errors.push("options_count");
  } else {
    const uniqueLabels = new Set(options.map((o) => o.label));
    if (uniqueLabels.size !== options.length) errors.push("options_duplicate_label");
    const correctCount = options.filter((o) => o.is_correct).length;
    if (correctCount !== 1) errors.push("options_correct_count");
  }

  const themeCategory = QUESTION_THEME_CATEGORIES.includes(input.themeCategory as QuestionThemeCategory)
    ? (input.themeCategory as QuestionThemeCategory)
    : null;
  if (!themeCategory) errors.push("theme_category_unsupported");

  const difficulty = TRIP_DIFFICULTIES.includes(input.difficulty as TripDifficulty) ? (input.difficulty as TripDifficulty) : null;
  if (!difficulty) errors.push("difficulty_unsupported");

  const dayNumber = typeof input.dayNumber === "number" && Number.isInteger(input.dayNumber) ? input.dayNumber : null;
  if (dayNumber === null || dayNumber < 1 || dayNumber > durationDays) errors.push("day_out_of_range");

  const slot = input.slot === "morning" || input.slot === "lunch" ? (input.slot as QuestionSlot) : null;
  if (!slot) errors.push("slot_unsupported");

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      prompt,
      explanation,
      options,
      themeCategory: themeCategory!,
      difficulty: difficulty!,
      dayNumber: dayNumber!,
      slot: slot!,
    },
  };
}

export interface GeneratedQuestionsValidationResult {
  valid: ValidatedGeneratedQuestion[];
  rejectedCount: number;
  // Short, non-sensitive summaries (never the raw provider text) -- safe
  // to show an admin or write to a run's own error_message.
  rejectedReasons: string[];
}

function slotKey(s: { dayNumber: number; slot: string; themeCategory: string; difficulty: string }): string {
  return `${s.dayNumber}|${s.slot}|${s.themeCategory}|${s.difficulty}`;
}

// Parses and validates a provider's raw response against the EXACT set
// of slots this run asked for (day/slot/category/difficulty -- assigned
// deterministically by the caller, never left to the model to invent --
// see src/lib/ai/generationService.ts). An item that isn't valid JSON,
// isn't an array, or is an object that doesn't match a still-unclaimed
// requested slot, is rejected individually; a completely unparseable/
// non-array response rejects the whole batch (nothing to salvage).
export function validateGeneratedQuestionsResponse(
  raw: string,
  expectedSlots: GenerationSlotRequest[],
  durationDays: number,
): GeneratedQuestionsValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: [], rejectedCount: expectedSlots.length, rejectedReasons: ["JSON invalid: nu s-a putut parsa răspunsul furnizorului."] };
  }
  if (!Array.isArray(parsed)) {
    return { valid: [], rejectedCount: expectedSlots.length, rejectedReasons: ["Răspunsul furnizorului nu este un array JSON."] };
  }

  const remaining = new Map<string, number>();
  for (const s of expectedSlots) {
    const key = slotKey(s);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const valid: ValidatedGeneratedQuestion[] = [];
  const rejectedReasons: string[] = [];
  let rejectedCount = 0;

  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      rejectedCount++;
      rejectedReasons.push("Element din răspuns nu este un obiect JSON valid.");
      continue;
    }
    const record = item as Record<string, unknown>;
    const result = validateGeneratedQuestionContent(
      {
        prompt: record.prompt,
        explanation: record.explanation,
        options: record.options,
        themeCategory: record.themeCategory,
        difficulty: record.difficulty,
        dayNumber: record.dayNumber,
        slot: record.slot,
      },
      durationDays,
    );
    if (!result.ok) {
      rejectedCount++;
      rejectedReasons.push(`Întrebare respinsă (${result.errors.join(", ")}).`);
      continue;
    }
    const key = slotKey(result.value);
    const left = remaining.get(key) ?? 0;
    if (left <= 0) {
      rejectedCount++;
      rejectedReasons.push("Întrebare respinsă: nu corespunde niciunui slot solicitat (zi/moment/categorie/dificultate).");
      continue;
    }
    remaining.set(key, left - 1);
    valid.push(result.value);
  }

  // Every requested slot the response never addressed at all also
  // counts as rejected -- a short/partial AI response is not silently
  // treated as if the missing items simply didn't exist.
  for (const left of remaining.values()) {
    if (left > 0) {
      rejectedCount += left;
      rejectedReasons.push(`${left} slot(uri) solicitate nu au primit niciun răspuns valid.`);
    }
  }

  return { valid, rejectedCount, rejectedReasons };
}
