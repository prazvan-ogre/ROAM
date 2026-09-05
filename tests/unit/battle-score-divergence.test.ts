// Verifies the fix for hypothesis B/R3 from the 2026-09-05 review:
// recordBattleAnswer (src/lib/battle.ts) used to write the personal
// response and the team battle_scores row as two separate, sequential
// inserts with no shared transaction -- a failure on the second write
// left the first one committed with no compensating rollback. It now
// makes a single RPC call to record_battle_answer()
// (20260906120000_atomic_record_battle_answer.sql), which does both
// inserts inside one Postgres function: if anything inside it raises,
// the whole thing rolls back, responses included.
//
// Runs the real recordBattleAnswer code against a fake client (see
// helpers/fakeSupabaseClient.ts) that fails the RPC call outright, the
// way a dropped connection would -- and checks that *neither* table
// gets a row, unlike the divergence this file used to demonstrate.
import { describe, it, expect, vi } from "vitest";
import { createFakeSupabaseClient, type FakeDb } from "./helpers/fakeSupabaseClient";

let db: FakeDb;
let failRpc = false;

vi.mock("@/lib/supabase/client", () => ({
  get supabase() {
    return createFakeSupabaseClient(db, { failRpc });
  },
}));

const question = {
  id: "q1",
  trip_id: "t1",
  battle_id: "b1",
  kind: "battle",
  day_number: 1,
  slot: null,
  order_index: 1,
  prompt: "?",
  question_type: "single_choice",
  media_url: null,
  points: 10,
  common_core: null,
  one_thing: null,
  correct_reveal_message: null,
  alternative_reveal_message: null,
  sources: [],
  verified: true,
  published: true,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
} as never;

const correctOption = { id: "opt1", question_id: "q1", order_index: 1, label: "A", is_correct: true, created_at: "" } as never;

describe("R3: personal/team score atomicity (fixed)", () => {
  it("commits neither write when the RPC call fails", async () => {
    db = { responses: [], battle_scores: [] };
    failRpc = true;
    const { recordBattleAnswer } = await import("@/lib/battle");

    await expect(
      recordBattleAnswer("p1", "adults", "b1", question, correctOption),
    ).rejects.toThrow("simulated network failure");

    // Fixed: no partial write survives a failed call -- both tables stay
    // empty, matching the real function's atomicity.
    expect(db.responses).toHaveLength(0);
    expect(db.battle_scores).toHaveLength(0);
  });

  it("records both writes together when the RPC succeeds", async () => {
    db = { responses: [], battle_scores: [] };
    failRpc = false;
    const { recordBattleAnswer } = await import("@/lib/battle");

    await recordBattleAnswer("p1", "adults", "b1", question, correctOption);

    expect(db.responses).toHaveLength(1);
    expect(db.responses[0].participant_id).toBe("p1");
    expect(db.battle_scores).toHaveLength(1);
    expect(db.battle_scores[0].participant_id).toBe("p1");
  });
});
