// R7: the pure formatting/counting helpers behind scripts/validate-trip-
// content.mjs (the operator CLI wrapper around the real
// validate_trip_content()/publish_trip() SQL functions -- see
// supabase/tests/r7_content_publishing.test.sql for coverage of the
// actual validation logic those functions implement). This file only
// exercises the script's own small amount of JS logic: it deliberately
// guards its `main()` behind an import.meta.url check so importing it
// here never triggers a live Supabase call or process.exit.
import { describe, it, expect } from "vitest";
import { formatIssueLine, countErrors } from "../../scripts/validate-trip-content.mjs";

describe("scripts/validate-trip-content.mjs -- pure helpers", () => {
  it("formatIssueLine shows the day number when present", () => {
    const line = formatIssueLine({
      check_key: "discover.missing",
      severity: "error",
      message: "No Morning Discover question for this day.",
      day_number: 3,
      entity_id: null,
    });
    expect(line).toBe("[error] discover.missing (day 3): No Morning Discover question for this day.");
  });

  it("formatIssueLine falls back to the entity id when there's no day number", () => {
    const line = formatIssueLine({
      check_key: "trip.timezone_missing",
      severity: "error",
      message: "Trip has no timezone set.",
      day_number: null,
      entity_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(line).toBe("[error] trip.timezone_missing (11111111-1111-1111-1111-111111111111): Trip has no timezone set.");
  });

  it("formatIssueLine shows neither when both are absent", () => {
    const line = formatIssueLine({
      check_key: "battle.final_missing",
      severity: "error",
      message: "No active Final Battle for this trip.",
      day_number: null,
      entity_id: null,
    });
    expect(line).toBe("[error] battle.final_missing: No active Final Battle for this trip.");
  });

  it("countErrors counts only severity 'error', ignoring warnings and a null/empty list", () => {
    const issue = (severity: string) => ({ check_key: "x", severity, message: "m", day_number: null, entity_id: null });
    expect(countErrors(null)).toBe(0);
    expect(countErrors([])).toBe(0);
    expect(countErrors([issue("error"), issue("warning"), issue("error")])).toBe(2);
  });
});
