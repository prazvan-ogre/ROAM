// Verifies the fix for hypothesis B/R3 from the 2026-09-05 review, now
// carried by submitAnswer (src/lib/discover.ts) instead of the
// battle-specific recordBattleAnswer this file used to test directly.
// recordBattleAnswer/record_battle_answer used to write the personal
// response and the team battle_scores row as two separate, sequential
// operations with no shared transaction -- a failure on the second write
// left the first one committed with no compensating rollback.
//
// R3 (20260906140000_record_answer_authoritative.sql) went further:
// there is no longer a battle-specific submission path at all --
// Discover, Battle, Final and Catchup all call the same submitAnswer(),
// which makes exactly one RPC call (record_answer) that does every write
// (responses, and battle_scores when eligible) inside one Postgres
// function. From the client's own perspective there is now only ever one
// call to succeed or fail as a whole -- the two-separate-calls
// divergence this file used to reproduce is structurally impossible
// here, not just fixed by a retry.
//
// What's left worth testing at this level (an in-memory fake, no real
// Postgres) is narrower and different in kind: does submitAnswer
// propagate an RPC failure as a rejected promise without fabricating a
// result or leaving any client-side state behind, and does it correctly
// unwrap a successful call's composite return shape (status/response/
// contributedToTeam/correctOptionId)? The actual atomicity proof --
// forcing a failure between the responses and battle_scores writes and
// confirming no orphaned row survives -- now lives against a real
// Postgres in supabase/tests/record_answer.test.sql, since that's the
// only place the transaction itself actually exists.
import { describe, it, expect, vi } from "vitest";
import { createFakeSupabaseClient, type FakeDb } from "./helpers/fakeSupabaseClient";

let db: FakeDb;
let failRpc = false;

vi.mock("@/lib/supabase/client", () => ({
  get supabase() {
    return createFakeSupabaseClient(db, { failRpc });
  },
}));

describe("R3: submitAnswer propagates record_answer's outcome faithfully", () => {
  it("rejects and leaves no local trace when the RPC call fails", async () => {
    db = { responses: [] };
    failRpc = true;
    const { submitAnswer } = await import("@/lib/discover");

    await expect(submitAnswer("p1", "q1", "opt1")).rejects.toThrow("simulated network failure");

    expect(db.responses).toHaveLength(0);
  });

  it("returns the accepted result, unwrapped, when the RPC succeeds", async () => {
    db = { responses: [] };
    failRpc = false;
    const { submitAnswer } = await import("@/lib/discover");

    const result = await submitAnswer("p1", "q1", "opt1");

    expect(result.status).toBe("accepted");
    expect(result.response.participant_id).toBe("p1");
    expect(result.response.question_id).toBe("q1");
    expect(result.contributedToTeam).toBe(true);
    expect(result.correctOptionId).toBe("opt1");
    expect(db.responses).toHaveLength(1);
  });
});
