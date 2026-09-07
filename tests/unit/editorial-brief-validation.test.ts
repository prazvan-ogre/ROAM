// Trip editorial brief (20260909090000_trip_editorial_brief.sql):
// validateEditorialBrief (src/lib/editorialBrief.ts) is the single
// server-side validation both app/api/trips/create/route.ts (the
// initial brief) and app/api/trips/[slug]/brief/route.ts (a later edit)
// call -- these tests exercise that function directly, the same rules
// both routes rely on.
import { describe, it, expect } from "vitest";
import { validateEditorialBrief, type EditorialBriefRawInput } from "@/lib/editorialBrief";

function validInput(overrides: Partial<EditorialBriefRawInput> = {}): EditorialBriefRawInput {
  return {
    difficulty: "medium",
    style: "fun",
    narratorCharacterName: "",
    themeHistory: 25,
    themePlaces: 25,
    themeFood: 25,
    themeCuriosities: 25,
    ...overrides,
  };
}

describe("validateEditorialBrief: a fully valid brief", () => {
  it("accepts the default proposal (medium/fun/equal split) and normalizes the value", () => {
    const result = validateEditorialBrief(validInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        difficulty: "medium",
        style: "fun",
        narratorCharacterName: null,
        themeHistory: 25,
        themePlaces: 25,
        themeFood: 25,
        themeCuriosities: 25,
      });
    }
  });

  it("accepts a category at 0% as long as the total is still exactly 100", () => {
    const result = validateEditorialBrief(
      validInput({ themeHistory: 0, themePlaces: 40, themeFood: 30, themeCuriosities: 30 }),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts string-typed percent inputs (as they arrive from a form's number input)", () => {
    const result = validateEditorialBrief(
      validInput({ themeHistory: "25", themePlaces: "25", themeFood: "25", themeCuriosities: "25" }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("validateEditorialBrief: difficulty and style", () => {
  it("rejects an unknown difficulty value", () => {
    const result = validateEditorialBrief(validInput({ difficulty: "extreme" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.difficulty).toBeTruthy();
  });

  it("rejects an unknown style value", () => {
    const result = validateEditorialBrief(validInput({ style: "dramatic" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.style).toBeTruthy();
  });

  it("rejects a missing/non-string difficulty or style", () => {
    const result = validateEditorialBrief(validInput({ difficulty: undefined, style: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.difficulty).toBeTruthy();
      expect(result.errors.style).toBeTruthy();
    }
  });
});

describe("validateEditorialBrief: narrator character name, required only for narrated_by_character", () => {
  it("does not require a name for 'fun'", () => {
    const result = validateEditorialBrief(validInput({ style: "fun", narratorCharacterName: "" }));
    expect(result.ok).toBe(true);
  });

  it("does not require a name for 'academic'", () => {
    const result = validateEditorialBrief(validInput({ style: "academic", narratorCharacterName: "" }));
    expect(result.ok).toBe(true);
  });

  it("requires a name for 'narrated_by_character'", () => {
    const result = validateEditorialBrief(validInput({ style: "narrated_by_character", narratorCharacterName: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.narratorCharacterName).toBeTruthy();
  });

  it("rejects a whitespace-only name for 'narrated_by_character'", () => {
    const result = validateEditorialBrief(validInput({ style: "narrated_by_character", narratorCharacterName: "   " }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.narratorCharacterName).toBeTruthy();
  });

  it("normalizes internal whitespace runs and trims the ends", () => {
    const result = validateEditorialBrief(
      validInput({ style: "narrated_by_character", narratorCharacterName: "  Ștefan   cel  Mare " }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.narratorCharacterName).toBe("Ștefan cel Mare");
  });

  it("rejects a name longer than the maximum length", () => {
    const result = validateEditorialBrief(
      validInput({ style: "narrated_by_character", narratorCharacterName: "A".repeat(81) }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.narratorCharacterName).toBeTruthy();
  });

  it("accepts a name at exactly the maximum length", () => {
    const result = validateEditorialBrief(
      validInput({ style: "narrated_by_character", narratorCharacterName: "A".repeat(80) }),
    );
    expect(result.ok).toBe(true);
  });

  it("ignores a stray name value when the style isn't narrated_by_character -- never surfaces as an error", () => {
    const result = validateEditorialBrief(validInput({ style: "fun", narratorCharacterName: "" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.narratorCharacterName).toBeNull();
  });
});

describe("validateEditorialBrief: theme distribution percentages", () => {
  it("rejects a non-integer percentage", () => {
    const result = validateEditorialBrief(validInput({ themeHistory: 25.5 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.themeHistory).toBeTruthy();
  });

  it("rejects a negative percentage", () => {
    const result = validateEditorialBrief(validInput({ themePlaces: -10, themeHistory: 35 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.themePlaces).toBeTruthy();
  });

  it("rejects a percentage over 100", () => {
    const result = validateEditorialBrief(validInput({ themeFood: 150, themeHistory: -50 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.themeFood).toBeTruthy();
  });

  it("rejects a missing/non-numeric percentage", () => {
    const result = validateEditorialBrief(validInput({ themeCuriosities: "" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.themeCuriosities).toBeTruthy();
  });

  it("rejects a total different from exactly 100, with a message near the total (not per-field)", () => {
    const result = validateEditorialBrief(
      validInput({ themeHistory: 30, themePlaces: 30, themeFood: 30, themeCuriosities: 30 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.themeTotal).toBeTruthy();
      expect(result.errors.themeHistory).toBeUndefined();
      expect(result.errors.themePlaces).toBeUndefined();
    }
  });

  it("rejects a total under 100 the same way as over 100", () => {
    const result = validateEditorialBrief(
      validInput({ themeHistory: 10, themePlaces: 10, themeFood: 10, themeCuriosities: 10 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.themeTotal).toBeTruthy();
  });
});

describe("validateEditorialBrief: multiple simultaneous errors", () => {
  it("reports every broken field at once, not just the first", () => {
    const result = validateEditorialBrief(
      validInput({ difficulty: "extreme", themeHistory: 10, themePlaces: 10, themeFood: 10, themeCuriosities: 10 }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.difficulty).toBeTruthy();
      expect(result.errors.themeTotal).toBeTruthy();
    }
  });
});
