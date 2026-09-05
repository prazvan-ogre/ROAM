// A hand-rolled fake standing in for the subset of the Supabase JS query
// builder + Auth admin API app/api/account/route.ts (and
// src/lib/security/session.ts's resolveAccountSession/resolveBearerAuthUserId)
// actually call. Deliberately not a full Supabase mock and not a real
// database/RLS check -- it exists only to let the route handlers' *own*
// logic run against an in-memory "creator_accounts" table plus a fake
// Auth admin surface, so these tests can prove what the code itself does
// (or doesn't) verify before returning/mutating a row or trusting a
// token. Whether Postgres RLS would separately block a given write is a
// different, deployed-policy question these unit tests don't attempt to
// answer (see supabase/tests/*.test.sql for that).

export interface FakeAccountRow {
  id: string;
  phone_number: string;
  pin_hash: string | null;
  auth_user_id: string | null;
  is_admin: boolean;
  display_name: string | null;
}

export interface FakeAuthOptions {
  // access token -> the Supabase Auth user id it verifies as, simulating
  // admin.auth.getUser(token). A token with no entry here behaves like an
  // expired/forged one (getUser returns an error).
  validTokens?: Record<string, string>;
}

function matchesFilters(row: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}

export function createFakeAdminClient(rows: FakeAccountRow[], authOptions: FakeAuthOptions = {}) {
  const validTokens = authOptions.validTokens ?? {};
  let nextCreatedId = 1;

  return {
    auth: {
      async getUser(token: string) {
        const userId = validTokens[token];
        if (!userId) return { data: { user: null }, error: { message: "invalid token" } };
        return { data: { user: { id: userId } }, error: null };
      },
      admin: {
        async updateUserById(userId: string, _attrs: Record<string, unknown>) {
          return { data: { user: { id: userId } }, error: null };
        },
        async createUser(_attrs: Record<string, unknown>) {
          const id = `fake-auth-user-${nextCreatedId++}`;
          return { data: { user: { id } }, error: null };
        },
      },
    },
    from(table: string) {
      if (table !== "creator_accounts") {
        throw new Error(`fake admin client: unexpected table "${table}"`);
      }
      return {
        select(_columns: string) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            async maybeSingle() {
              const row = rows.find((r) => matchesFilters(r as unknown as Record<string, unknown>, filters)) ?? null;
              return { data: row, error: null };
            },
          };
          return builder;
        },
        update(patch: Partial<FakeAccountRow>) {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            select(_columns: string) {
              return {
                async maybeSingle() {
                  const row = rows.find((r) => matchesFilters(r as unknown as Record<string, unknown>, filters));
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
