// Verifies R3's hypothesis from the 2026-09-05 review: recordBattleAnswer
// (src/lib/battle.ts) writes the personal response and the team
// battle_scores row as two separate, sequential inserts with no shared
// transaction -- so a failure on the second write leaves the first one
// committed with no compensating rollback. Runs the real
// submitResponse/recordBattleAnswer code against a fake client (see
// helpers/fakeSupabaseClient.ts) that fails only the battle_scores
// insert, the way a dropped connection between the two calls would.
import { describe, it, expect, vi } from "vitest";
import { createFakeSupabaseClient, type FakeDb } from "./helpers/fakeSupabaseClient";

let db: FakeDb;
let failBattleScoreInsert = false;

vi.mock("@/lib/supabase/client", () => ({
  get supabase() {
    return createFakeSupabaseClient(db, { failBattleScoreInsert });
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

describe("R3: personal/team score atomicity", () => {
  it("persists the personal response even when the team battle_scores write fails", async () => {
    db = { responses: [], battle_scores: [] };
    failBattleScoreInsert = true;
    const { recordBattleAnswer } = await import("@/lib/battle");

    await expect(
      recordBattleAnswer("p1", "adults", "b1", question, correctOption, false),
    ).rejects.toThrow("simulated network failure");

    // The bug: the personal answer is already committed even though the
    // caller sees an error and the team never got credit for it -- there
    // is no way, from this thrown error alone, to tell the two writes
    // diverged.
    expect(db.responses).toHaveLength(1);
    expect(db.responses[0].participant_id).toBe("p1");
    expect(db.battle_scores).toHaveLength(0);
  });

  it("records both writes when neither fails, for contrast", async () => {
    db = { responses: [], battle_scores: [] };
    failBattleScoreInsert = false;
    const { recordBattleAnswer } = await import("@/lib/battle");

    await recordBattleAnswer("p1", "adults", "b1", question, correctOption, false);

    expect(db.responses).toHaveLength(1);
    expect(db.battle_scores).toHaveLength(1);
  });
});
