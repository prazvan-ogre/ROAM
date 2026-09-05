// A hand-rolled fake standing in for the subset of the Supabase JS client
// that src/lib/discover.ts's submitResponse and src/lib/battle.ts's
// recordBattleAnswer/getBattleWindowStatus actually call. Not a real
// database and not an RLS/transaction test -- it exists to let the real
// application code run against an in-memory store, so a test can observe
// exactly which writes happen (and in what order) when one of two
// separate inserts is made to fail, the way a dropped connection would.

export interface FakeDb {
  responses: Array<{ id: string; participant_id: string; question_id: string; is_correct: boolean | null }>;
  battle_scores: Array<{ id: string; battle_id: string; participant_id: string; team: string; score: number; created_at: string }>;
}

export function createFakeSupabaseClient(db: FakeDb, opts: { failBattleScoreInsert?: boolean } = {}) {
  let idCounter = 0;
  const nextId = () => `fake-${++idCounter}`;

  return {
    from(table: keyof FakeDb) {
      if (table === "responses") {
        return {
          insert(row: Record<string, unknown>) {
            return {
              select() {
                return {
                  async single() {
                    const inserted = { id: nextId(), ...row } as FakeDb["responses"][number];
                    db.responses.push(inserted);
                    return { data: inserted, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "battle_scores") {
        return {
          select(_columns: string) {
            const query = {
              eq(_column: string, _value: string) {
                return query;
              },
              not(_column: string, _op: string, _value: unknown) {
                return query;
              },
              order(_column: string, _opts: { ascending: boolean }) {
                return query;
              },
              limit(_n: number) {
                return query;
              },
              async maybeSingle() {
                // No prior individual answer recorded yet in this
                // fixture -- getBattleWindowStatus() sees an empty
                // battle_scores table and reports the window as still
                // open (countable: true), same as a battle nobody has
                // answered yet.
                return { data: null, error: null };
              },
            };
            return query;
          },
          async insert(row: Record<string, unknown>) {
            if (opts.failBattleScoreInsert) {
              // Simulates a dropped connection / request failure on this
              // second write -- the first (responses) insert above has
              // already completed and returned by the time this runs.
              return { data: null, error: new Error("simulated network failure") };
            }
            db.battle_scores.push({ id: nextId(), created_at: new Date().toISOString(), ...row } as FakeDb["battle_scores"][number]);
            return { data: null, error: null };
          },
        };
      }

      throw new Error(`fake supabase client: unexpected table "${String(table)}"`);
    },
  };
}
