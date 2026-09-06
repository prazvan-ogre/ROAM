// R4 regression (2026-09-06 batch): "confirmare pierdută" + "retry
// reușit fără duplicare" for prize voting. castPrizeVote (src/lib/prize.ts)
// used to surface prize_votes' own `unique (participant_id)` constraint
// violation as a hard error on any retry -- even though that constraint
// firing means the vote had ALREADY been recorded (the exact "lost
// confirmation" shape: the insert committed, the response never reached
// the caller). Fixed to recognize Postgres 23505 as "already voted,
// nothing left to do" rather than a real failure.
import { describe, it, expect, vi } from "vitest";

const insertCalls: unknown[] = [];
let nextError: { code: string; message: string } | null = null;

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "prize_votes") throw new Error(`unexpected table "${table}"`);
      return {
        insert: async (row: unknown) => {
          insertCalls.push(row);
          if (nextError) return { error: nextError };
          return { error: null };
        },
      };
    },
  },
}));

describe("R4 regression: castPrizeVote is idempotent on a duplicate vote", () => {
  it("a genuinely new vote succeeds and inserts exactly once", async () => {
    const { castPrizeVote } = await import("@/lib/prize");
    nextError = null;
    insertCalls.length = 0;

    await expect(castPrizeVote("trip-1", "participant-1", "option-1")).resolves.toBeUndefined();
    expect(insertCalls).toHaveLength(1);
  });

  it("a unique_violation (23505) retry -- the vote already landed on an earlier attempt -- resolves without throwing", async () => {
    const { castPrizeVote } = await import("@/lib/prize");
    nextError = { code: "23505", message: "duplicate key value violates unique constraint" };

    await expect(castPrizeVote("trip-1", "participant-1", "option-1")).resolves.toBeUndefined();
  });

  it("any OTHER error still throws -- 23505 is the only error treated as success", async () => {
    const { castPrizeVote } = await import("@/lib/prize");
    nextError = { code: "500", message: "internal error" };

    await expect(castPrizeVote("trip-1", "participant-1", "option-1")).rejects.toMatchObject({ code: "500" });
  });
});
