// R9: validateGeneratedQuestionContent (single-question content rules)
// and validateGeneratedQuestionsResponse (JSON parsing + per-item
// validation + slot matching against exactly what was requested) --
// src/lib/generatedQuestions.ts. Pure functions, no mocks.
import { describe, it, expect } from "vitest";
import {
  validateGeneratedQuestionContent,
  validateGeneratedQuestionsResponse,
} from "@/lib/generatedQuestions";
import type { GenerationSlotRequest } from "@/lib/ai/questionGenerationProvider";

const validContent = {
  prompt: "Ce insulă găzduiește Achilleion?",
  explanation: "Achilleion a fost construit pentru împărăteasa Sisi.",
  options: [
    { label: "Corfu", is_correct: true },
    { label: "Rodos", is_correct: false },
  ],
  themeCategory: "history",
  difficulty: "medium",
  dayNumber: 1,
  slot: "morning",
};

describe("validateGeneratedQuestionContent", () => {
  it("accepts a fully valid question", () => {
    const result = validateGeneratedQuestionContent(validContent, 5);
    expect(result.ok).toBe(true);
  });

  it("rejects a missing/blank prompt", () => {
    const result = validateGeneratedQuestionContent({ ...validContent, prompt: "   " }, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("prompt_missing");
  });

  it("rejects a prompt over the length limit", () => {
    const result = validateGeneratedQuestionContent({ ...validContent, prompt: "a".repeat(501) }, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("prompt_too_long");
  });

  it("rejects a missing explanation", () => {
    const result = validateGeneratedQuestionContent({ ...validContent, explanation: "" }, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("explanation_missing");
  });

  it("rejects duplicate option labels", () => {
    const result = validateGeneratedQuestionContent(
      { ...validContent, options: [{ label: "A", is_correct: true }, { label: "A", is_correct: false }] },
      5,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("options_duplicate_label");
  });

  it("rejects zero correct options", () => {
    const result = validateGeneratedQuestionContent(
      { ...validContent, options: [{ label: "A", is_correct: false }, { label: "B", is_correct: false }] },
      5,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("options_correct_count");
  });

  it("rejects two correct options", () => {
    const result = validateGeneratedQuestionContent(
      { ...validContent, options: [{ label: "A", is_correct: true }, { label: "B", is_correct: true }] },
      5,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("options_correct_count");
  });

  it("rejects fewer than 2 options", () => {
    const result = validateGeneratedQuestionContent({ ...validContent, options: [{ label: "A", is_correct: true }] }, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("options_count");
  });

  it("rejects an unsupported theme category", () => {
    const result = validateGeneratedQuestionContent({ ...validContent, themeCategory: "weather" }, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("theme_category_unsupported");
  });

  it("rejects an unsupported difficulty", () => {
    const result = validateGeneratedQuestionContent({ ...validContent, difficulty: "extreme" }, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("difficulty_unsupported");
  });

  it("rejects a day number outside the trip's duration", () => {
    const result = validateGeneratedQuestionContent({ ...validContent, dayNumber: 6 }, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("day_out_of_range");
  });

  it("rejects a day number of 0", () => {
    const result = validateGeneratedQuestionContent({ ...validContent, dayNumber: 0 }, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("day_out_of_range");
  });

  it("rejects an unsupported slot", () => {
    const result = validateGeneratedQuestionContent({ ...validContent, slot: "evening" }, 5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain("slot_unsupported");
  });
});

const slots: GenerationSlotRequest[] = [
  { dayNumber: 1, slot: "morning", themeCategory: "history", difficulty: "medium" },
  { dayNumber: 1, slot: "lunch", themeCategory: "places", difficulty: "medium" },
];

function itemFor(slot: GenerationSlotRequest, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    dayNumber: slot.dayNumber,
    slot: slot.slot,
    themeCategory: slot.themeCategory,
    difficulty: slot.difficulty,
    prompt: "Prompt?",
    explanation: "Explanation.",
    options: [
      { label: "A", is_correct: true },
      { label: "B", is_correct: false },
    ],
    ...overrides,
  };
}

describe("validateGeneratedQuestionsResponse", () => {
  it("rejects the whole batch on invalid JSON", () => {
    const result = validateGeneratedQuestionsResponse("not json{", slots, 5);
    expect(result.valid).toHaveLength(0);
    expect(result.rejectedCount).toBe(slots.length);
    expect(result.rejectedReasons[0]).toMatch(/JSON invalid/i);
  });

  it("rejects the whole batch when the response isn't an array", () => {
    const result = validateGeneratedQuestionsResponse(JSON.stringify({ not: "an array" }), slots, 5);
    expect(result.valid).toHaveLength(0);
    expect(result.rejectedCount).toBe(slots.length);
  });

  it("accepts a valid response matching every requested slot", () => {
    const raw = JSON.stringify(slots.map((s) => itemFor(s)));
    const result = validateGeneratedQuestionsResponse(raw, slots, 5);
    expect(result.valid).toHaveLength(2);
    expect(result.rejectedCount).toBe(0);
  });

  it("rejects an individual item with duplicate options without failing the whole batch", () => {
    const raw = JSON.stringify([
      itemFor(slots[0], { options: [{ label: "A", is_correct: true }, { label: "A", is_correct: false }] }),
      itemFor(slots[1]),
    ]);
    const result = validateGeneratedQuestionsResponse(raw, slots, 5);
    expect(result.valid).toHaveLength(1);
    // The invalid item itself is one rejection; since it never validly
    // claimed slots[0], that slot is also reported as never addressed --
    // both facts are real and worth surfacing, not deduplicated away.
    expect(result.rejectedCount).toBe(2);
  });

  it("rejects an item whose day/slot/category/difficulty doesn't match any requested slot", () => {
    const raw = JSON.stringify([itemFor(slots[0], { dayNumber: 3 }), itemFor(slots[1])]);
    const result = validateGeneratedQuestionsResponse(raw, slots, 5);
    expect(result.valid).toHaveLength(1);
    // Same reasoning: the mismatched item is one rejection, and slots[0]
    // (never validly claimed) is separately reported as unaddressed.
    expect(result.rejectedCount).toBe(2);
  });

  it("counts a slot the response never addressed at all as rejected", () => {
    const raw = JSON.stringify([itemFor(slots[0])]);
    const result = validateGeneratedQuestionsResponse(raw, slots, 5);
    expect(result.valid).toHaveLength(1);
    expect(result.rejectedCount).toBe(1);
  });

  it("rejects a duplicate fill of the same slot (a slot can only be consumed once)", () => {
    const raw = JSON.stringify([itemFor(slots[0]), itemFor(slots[0])]);
    const result = validateGeneratedQuestionsResponse(raw, slots, 5);
    expect(result.valid).toHaveLength(1);
    // Both the duplicate fill AND the never-addressed slots[1] count as rejected.
    expect(result.rejectedCount).toBe(2);
  });
});
