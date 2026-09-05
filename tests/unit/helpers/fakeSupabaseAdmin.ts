// A hand-rolled fake standing in for the subset of the Supabase JS query
// builder that app/api/account/route.ts actually calls
// (.from().select().eq().maybeSingle(), .from().update().eq().select().maybeSingle()).
// Deliberately not a full Supabase mock and not a real database/RLS check --
// it exists only to let the route handler's *own* logic run against an
// in-memory "creator_accounts" table, so these tests can prove what the
// code itself does (or doesn't) verify before returning/mutating a row.
// Whether Postgres RLS would separately block this is a different,
// deployed-policy question this batch does not attempt to answer.

export interface FakeAccountRow {
  id: string;
  phone_number: string;
  pin_hash: string;
  is_admin: boolean;
  display_name: string | null;
}

export function createFakeAdminClient(rows: FakeAccountRow[]) {
  return {
    from(table: string) {
      if (table !== "creator_accounts") {
        throw new Error(`fake admin client: unexpected table "${table}"`);
      }
      return {
        select(_columns: string) {
          let filterId: string | undefined;
          const builder = {
            eq(column: string, value: string) {
              if (column !== "id") throw new Error(`fake admin client: unexpected eq column "${column}"`);
              filterId = value;
              return builder;
            },
            async maybeSingle() {
              const row = rows.find((r) => r.id === filterId) ?? null;
              return { data: row, error: null };
            },
          };
          return builder;
        },
        update(patch: Partial<FakeAccountRow>) {
          let filterId: string | undefined;
          const builder = {
            eq(column: string, value: string) {
              if (column !== "id") throw new Error(`fake admin client: unexpected eq column "${column}"`);
              filterId = value;
              return builder;
            },
            select(_columns: string) {
              return {
                async maybeSingle() {
                  const row = rows.find((r) => r.id === filterId);
                  if (!row) return { data: null, error: null };
                  Object.assign(row, patch);
                  return { data: row, error: null };
                },
              };
            },
          };
          return builder;
        },
      };
    },
  };
}
