// R4 regression (2026-09-06 batch; feedback part corrected round 2):
// two lib-level fixes bundled here since both are small, pure functions
// with the same "must never surface an already-handled failure as a
// hard error" shape.
//
// submitFeedback no longer keys off `unique (trip_id, participant_id)`
// (that constraint asserted an unconfirmed "one feedback ever per
// participant" product rule -- see 20260907120000_r4_feedback_request_
// id_idempotency.sql's own comment for why). It now uses a client-
// generated requestId, exactly like addChildProfile: a 23505 there can
// only mean THIS specific attempt's own earlier insert already landed,
// with no ambiguity to reconcile and no need to ever read feedback back
// (feedback has no SELECT policy at all, intentionally) -- this file
// proves both the idempotency and that no select is ever attempted.
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
          select: () => {
            throw new Error("feedback has no SELECT policy -- submitFeedback must never attempt to read it back");
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

const feedbackPayload = {
  trip_id: "trip-1",
  participant_id: "participant-1",
  learned_new: 5,
  generated_conversations: 5,
  searched_more: true,
  anticipated_next: "da" as const,
  would_use_again: "sigur" as const,
  comment: null,
};

describe("R4 regression: submitFeedback is idempotent on requestId, never reads feedback back", () => {
  it("a genuinely new submission succeeds, inserts exactly once, and carries the request id", async () => {
    const { submitFeedback } = await import("@/lib/feedback");
    nextFeedbackError = null;
    feedbackInserts.length = 0;

    await expect(submitFeedback(feedbackPayload, "req-1")).resolves.toBeUndefined();
    expect(feedbackInserts).toHaveLength(1);
    expect(feedbackInserts[0]).toMatchObject({ client_request_id: "req-1" });
  });

  it("a unique_violation (23505) retry of the SAME requestId resolves without throwing or reading feedback back", async () => {
    const { submitFeedback } = await import("@/lib/feedback");
    nextFeedbackError = { code: "23505", message: "duplicate key value violates unique constraint" };

    await expect(submitFeedback(feedbackPayload, "req-1")).resolves.toBeUndefined();
  });

  it("a DIFFERENT requestId is a genuinely separate submission -- not blocked by an earlier one", async () => {
    const { submitFeedback } = await import("@/lib/feedback");
    nextFeedbackError = null;
    feedbackInserts.length = 0;

    await expect(submitFeedback(feedbackPayload, "req-2")).resolves.toBeUndefined();
    await expect(submitFeedback({ ...feedbackPayload, comment: "altceva" }, "req-3")).resolves.toBeUndefined();
    expect(feedbackInserts).toHaveLength(2);
  });

  it("any OTHER error still throws", async () => {
    const { submitFeedback } = await import("@/lib/feedback");
    nextFeedbackError = { code: "500", message: "internal error" };

    await expect(submitFeedback(feedbackPayload, "req-4")).rejects.toMatchObject({ code: "500" });
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
