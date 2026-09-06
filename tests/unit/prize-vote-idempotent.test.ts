// R4 regression (2026-09-06 batch; corrected round 2): "confirmare
// pierdută" + "retry reușit fără duplicare" for prize voting, WITHOUT
// blindly treating every 23505 as success. castPrizeVote (src/lib/
// prize.ts) used to surface prize_votes' own `unique (participant_id)`
// constraint violation as a hard error on any retry -- fixed once to
// swallow every 23505 as "already voted, done" -- but that was itself
// wrong: 23505 only proves *a* vote is on record, not that it's the
// SAME option just attempted. A real conflict (this participant already
// voted for a DIFFERENT option before) must be reported as a conflict,
// not confirmed as if the new pick had been saved. castPrizeVote now
// reconciles by reading back which option is actually on record
// (permitted by prize_votes' own "trip members can read prize votes"
// policy -- no new access) and returns a 3-way status.
import { describe, it, expect, vi } from "vitest";

const insertCalls: unknown[] = [];
let nextInsertError: { code: string; message: string } | null = null;
let existingVote: { prize_option_id: string } | null = null;

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "prize_votes") throw new Error(`unexpected table "${table}"`);
      return {
        insert: async (row: unknown) => {
          insertCalls.push(row);
          if (nextInsertError) return { error: nextInsertError };
          return { error: null };
        },
        select: (_cols: string) => ({
          eq: (_column: string, _value: string) => ({
            single: async () => {
              if (!existingVote) return { data: null, error: { code: "PGRST116", message: "no rows" } };
              return { data: existingVote, error: null };
            },
          }),
        }),
      };
    },
  },
}));

describe("R4 regression: castPrizeVote reconciles a duplicate vote instead of blindly confirming it", () => {
  it("a genuinely new vote succeeds, inserts exactly once, and reports 'recorded'", async () => {
    const { castPrizeVote } = await import("@/lib/prize");
    nextInsertError = null;
    insertCalls.length = 0;

    await expect(castPrizeVote("trip-1", "participant-1", "option-1")).resolves.toBe("recorded");
    expect(insertCalls).toHaveLength(1);
  });

  it("a unique_violation retry for the SAME option (lost confirmation) reports 'already_recorded', not an error", async () => {
    const { castPrizeVote } = await import("@/lib/prize");
    nextInsertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    existingVote = { prize_option_id: "option-1" };

    await expect(castPrizeVote("trip-1", "participant-1", "option-1")).resolves.toBe("already_recorded");
  });

  it("a unique_violation retry for a DIFFERENT option reports 'conflict' -- never silently confirmed as saved", async () => {
    const { castPrizeVote } = await import("@/lib/prize");
    nextInsertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    existingVote = { prize_option_id: "option-1" };

    await expect(castPrizeVote("trip-1", "participant-1", "option-2")).resolves.toBe("conflict");
  });

  it("any OTHER insert error still throws -- 23505 is the only code that gets reconciled", async () => {
    const { castPrizeVote } = await import("@/lib/prize");
    nextInsertError = { code: "500", message: "internal error" };

    await expect(castPrizeVote("trip-1", "participant-1", "option-1")).rejects.toMatchObject({ code: "500" });
  });

  it("a failure reading back the existing vote (reconciliation itself broken) throws rather than guessing", async () => {
    const { castPrizeVote } = await import("@/lib/prize");
    nextInsertError = { code: "23505", message: "duplicate key value violates unique constraint" };
    existingVote = null; // simulates the reconciliation select itself erroring/finding nothing

    await expect(castPrizeVote("trip-1", "participant-1", "option-1")).rejects.toMatchObject({ code: "PGRST116" });
  });
});
