// R9: the deterministic slot-planning helpers in
// src/lib/ai/generationService.ts -- day/slot gap-filling and
// theme-category allocation. Pure functions, no mocks; the orchestrator
// (runGeneration itself, which calls the provider + persists drafts) is
// exercised end-to-end by the SQL regression suite (supabase/tests/
// trip_question_generation.test.sql) and by tests/unit/api-trips-
// generate.test.ts's route-level tests.
import { describe, it, expect } from "vitest";
import { allocateThemeCategorySequence, buildDaySlotSequence } from "@/lib/ai/generationService";

describe("buildDaySlotSequence", () => {
  it("fills every day/slot gap before repeating any pair, for an empty trip", () => {
    const seq = buildDaySlotSequence(3, 6, new Set());
    expect(seq).toEqual([
      { dayNumber: 1, slot: "morning" },
      { dayNumber: 1, slot: "lunch" },
      { dayNumber: 2, slot: "morning" },
      { dayNumber: 2, slot: "lunch" },
      { dayNumber: 3, slot: "morning" },
      { dayNumber: 3, slot: "lunch" },
    ]);
  });

  it("prioritizes gaps over already-occupied day/slot pairs", () => {
    const occupied = new Set(["1|morning", "1|lunch"]);
    const seq = buildDaySlotSequence(2, 2, occupied);
    // Day 1 is fully occupied -- both requested slots go to day 2's gaps.
    expect(seq).toEqual([
      { dayNumber: 2, slot: "morning" },
      { dayNumber: 2, slot: "lunch" },
    ]);
  });

  it("cycles back through every pair once gaps run out, rather than stopping short", () => {
    const occupied = new Set(["1|morning", "1|lunch"]);
    const seq = buildDaySlotSequence(1, 3, occupied);
    expect(seq).toHaveLength(3);
    // A 1-day trip has exactly 2 distinct pairs (morning/lunch), both
    // already occupied -- cycling through them still produces exactly
    // `count` results instead of stopping at 2.
    expect(seq).toEqual([
      { dayNumber: 1, slot: "morning" },
      { dayNumber: 1, slot: "lunch" },
      { dayNumber: 1, slot: "morning" },
    ]);
  });
});

describe("allocateThemeCategorySequence", () => {
  it("allocates proportionally to the brief's own percentages and sums to exactly `count`", () => {
    const seq = allocateThemeCategorySequence(8, { history: 25, places: 25, food: 25, curiosities: 25 });
    expect(seq).toHaveLength(8);
    const counts = { history: 0, places: 0, food: 0, curiosities: 0 };
    for (const c of seq) counts[c]++;
    expect(counts).toEqual({ history: 2, places: 2, food: 2, curiosities: 2 });
  });

  it("uses largest-remainder rounding so an uneven split still sums exactly to `count`", () => {
    // 40/30/20/10 of 5 = 2/1.5/1/0.5 -- must still sum to 5.
    const seq = allocateThemeCategorySequence(5, { history: 40, places: 30, food: 20, curiosities: 10 });
    expect(seq).toHaveLength(5);
    const counts = { history: 0, places: 0, food: 0, curiosities: 0 };
    for (const c of seq) counts[c]++;
    expect(counts.history + counts.places + counts.food + counts.curiosities).toBe(5);
    // The largest share (history, 40%) gets at least as many as the smallest (curiosities, 10%).
    expect(counts.history).toBeGreaterThanOrEqual(counts.curiosities);
  });

  it("interleaves categories round-robin rather than grouping same-category items together", () => {
    const seq = allocateThemeCategorySequence(4, { history: 100, places: 0, food: 0, curiosities: 0 });
    expect(seq).toEqual(["history", "history", "history", "history"]);
    const mixed = allocateThemeCategorySequence(4, { history: 50, places: 50, food: 0, curiosities: 0 });
    expect(mixed).toEqual(["history", "places", "history", "places"]);
  });

  it("handles a single requested question without erroring", () => {
    const seq = allocateThemeCategorySequence(1, { history: 25, places: 25, food: 25, curiosities: 25 });
    expect(seq).toHaveLength(1);
  });
});
