// A hand-rolled fake standing in for the subset of the Supabase JS client
// that src/lib/discover.ts's submitAnswer actually calls -- a single RPC
// to record_answer() (20260906140000_record_answer_authoritative.sql),
// the one authoritative write path for Discover/Battle/Final/Catchup
// alike. Not a real database and not a real transaction: the real
// function's own atomicity (an exception raised inside a plpgsql
// function rolls back every write it made) is proven against a real
// Postgres in supabase/tests/record_answer.test.sql, not here -- this
// fake only exists to prove that submitAnswer itself propagates an RPC
// failure as a rejected promise rather than swallowing it or fabricating
// a result, and that it correctly unwraps a successful RPC's composite
// return shape.

export interface FakeDb {
  responses: Array<{ id: string; participant_id: string; question_id: string; selected_option_id: string; is_correct: boolean | null }>;
}

export function createFakeSupabaseClient(db: FakeDb, opts: { failRpc?: boolean } = {}) {
  let idCounter = 0;
  const nextId = () => `fake-${++idCounter}`;

  return {
    async rpc(fnName: string, args: Record<string, unknown>) {
      if (fnName !== "record_answer") {
        throw new Error(`fake supabase client: unexpected rpc "${fnName}"`);
      }
      if (opts.failRpc) {
        // Simulates the RPC call itself failing (dropped connection, a
        // rejected transaction, anything) -- the real function's
        // atomicity means nothing was ever committed in this branch.
        return { data: null, error: new Error("simulated network failure") };
      }

      const response = {
        id: nextId(),
        participant_id: args.p_participant_id as string,
        question_id: args.p_question_id as string,
        selected_option_id: args.p_selected_option_id as string,
        is_correct: true,
      };
      db.responses.push(response);
      return {
        data: {
          status: "accepted",
          response,
          contributed_to_team: true,
          correct_option_id: args.p_selected_option_id as string,
        },
        error: null,
      };
    },
  };
}
