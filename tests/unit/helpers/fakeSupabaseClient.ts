// A hand-rolled fake standing in for the subset of the Supabase JS client
// that src/lib/battle.ts's recordBattleAnswer actually calls -- a single
// RPC to record_battle_answer()
// (20260906120000_atomic_record_battle_answer.sql), since the fix for
// hypothesis B moved the previously-separate responses/battle_scores
// inserts into that one atomic Postgres function. Not a real database
// and not a real transaction -- it exists to let the real application
// code run against an in-memory store, and to prove that a failed RPC
// call writes to *neither* table, matching the real function's
// atomicity (an exception raised inside a plpgsql function rolls back
// every write that function made).
//
// record_battle_answer() no longer takes p_is_correct/p_score as inputs
// (20260906130000_server_side_answer_correctness.sql moved correctness
// server-side) -- this fake doesn't re-derive them from real
// answer_options data either (that logic is only exercised by the
// Postgres regression tests, supabase/tests/record_battle_answer_atomicity.test.sql),
// it just fabricates a fixed is_correct/score per call so the atomicity
// tests here (which only assert row counts and participant_id) still
// have something to store.

export interface FakeDb {
  responses: Array<{ id: string; participant_id: string; question_id: string; is_correct: boolean | null }>;
  battle_scores: Array<{ id: string; battle_id: string; participant_id: string; team: string; score: number; created_at: string }>;
}

export function createFakeSupabaseClient(db: FakeDb, opts: { failRpc?: boolean } = {}) {
  let idCounter = 0;
  const nextId = () => `fake-${++idCounter}`;

  return {
    async rpc(fnName: string, args: Record<string, unknown>) {
      if (fnName !== "record_battle_answer") {
        throw new Error(`fake supabase client: unexpected rpc "${fnName}"`);
      }
      if (opts.failRpc) {
        // Simulates the RPC call itself failing (dropped connection, a
        // rejected transaction, anything) -- the real function's
        // atomicity means neither write below is ever reached in this
        // branch, the same way a raised exception mid-function rolls
        // back everything it already did.
        return { data: null, error: new Error("simulated network failure") };
      }

      const response = {
        id: nextId(),
        participant_id: args.p_participant_id as string,
        question_id: args.p_question_id as string,
        is_correct: true,
      };
      db.responses.push(response);
      db.battle_scores.push({
        id: nextId(),
        battle_id: args.p_battle_id as string,
        participant_id: args.p_participant_id as string,
        team: args.p_team as string,
        score: 10,
        created_at: new Date().toISOString(),
      });
      return { data: response, error: null };
    },
  };
}
