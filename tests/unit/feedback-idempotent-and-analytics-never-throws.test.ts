// R4 regression (2026-09-06 batch): two lib-level fixes bundled here
// since both are small, pure functions with the same "must never surface
// an already-handled failure as a hard error" shape.
import { describe, it, expect, vi } from "vitest";

const feedbackInserts: unknown[] = [];
let nextFeedbackError: { code: string; message: string } | null = null;
const analyticsInserts: unknown[] = [];
let analyticsShouldThrow = false;

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "feedback") {
        return {
          insert: async (row: unknown) => {
            feedbackInserts.push(row);
            if (nextFeedbackError) return { error: nextFeedbackError };
            return { error: null };
          },
        };
      }
      if (table === "analytics_events") {
        return {
          insert: async (row: unknown) => {
            if (analyticsShouldThrow) {
              // Simulates a network-level exception (offline, DNS
              // failure) -- NOT the {error} shape a query failure
              // returns, a real thrown exception from the fetch itself.
              throw new Error("simulated network failure");
            }
            analyticsInserts.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table "${table}"`);
    },
  },
}));

describe("R4 regression: submitFeedback is idempotent on a duplicate submission", () => {
  it("a genuinely new submission succeeds and inserts exactly once", async () => {
    const { submitFeedback } = await import("@/lib/feedback");
    nextFeedbackError = null;
    feedbackInserts.length = 0;

    await expect(
      submitFeedback({
        trip_id: "trip-1",
        participant_id: "participant-1",
        learned_new: 5,
        generated_conversations: 5,
        searched_more: true,
        anticipated_next: "da",
        would_use_again: "sigur",
        comment: null,
      }),
    ).resolves.toBeUndefined();
    expect(feedbackInserts).toHaveLength(1);
  });

  it("a unique_violation (23505) retry -- feedback already on record from an earlier attempt -- resolves without throwing", async () => {
    const { submitFeedback } = await import("@/lib/feedback");
    nextFeedbackError = { code: "23505", message: "duplicate key value violates unique constraint" };

    await expect(
      submitFeedback({
        trip_id: "trip-1",
        participant_id: "participant-1",
        learned_new: 5,
        generated_conversations: 5,
        searched_more: true,
        anticipated_next: "da",
        would_use_again: "sigur",
        comment: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("any OTHER error still throws", async () => {
    const { submitFeedback } = await import("@/lib/feedback");
    nextFeedbackError = { code: "500", message: "internal error" };

    await expect(
      submitFeedback({
        trip_id: "trip-1",
        participant_id: "participant-1",
        learned_new: 5,
        generated_conversations: 5,
        searched_more: true,
        anticipated_next: "da",
        would_use_again: "sigur",
        comment: null,
      }),
    ).rejects.toMatchObject({ code: "500" });
  });
});

describe("R4 regression: trackEvent never throws, even on a network-level exception", () => {
  it("a query-level {error} is caught and logged, not thrown (existing contract, unchanged)", async () => {
    const { trackEvent } = await import("@/lib/analytics");
    analyticsShouldThrow = false;
    analyticsInserts.length = 0;

    await expect(trackEvent("trip-1", "trip_joined", "participant-1")).resolves.toBeUndefined();
    expect(analyticsInserts).toHaveLength(1);
  });

  it("a thrown network-level exception is also caught -- callers that await this must never see it reject", async () => {
    const { trackEvent } = await import("@/lib/analytics");
    analyticsShouldThrow = true;

    await expect(trackEvent("trip-1", "trip_joined", "participant-1")).resolves.toBeUndefined();
  });
});
