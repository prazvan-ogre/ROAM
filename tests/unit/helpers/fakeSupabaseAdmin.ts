// A hand-rolled fake standing in for the subset of the Supabase JS query
// builder + Auth admin API app/api/account/route.ts,
// app/api/account/link-trip/route.ts, and app/api/trips/create/route.ts
// (plus src/lib/security/session.ts's resolveAccountSession/
// resolveBearerAuthUserId) actually call. Deliberately not a full
// Supabase mock and not a real database/RLS check -- it exists only to
// let the route handlers' *own* logic run against in-memory
// "creator_accounts"/"trips" tables plus a fake Auth admin surface, so
// these tests can prove what the code itself does (or doesn't) verify
// before returning/mutating a row or trusting a token. Whether Postgres
// itself would separately enforce a given constraint under real
// concurrency is a different question -- see supabase/tests/
// r5_trip_creator_ownership.test.sql (and the other supabase/tests/*.sql
// files) for that, run against a real Postgres instance.

export interface FakeAccountRow {
  id: string;
  phone_number: string;
  pin_hash: string | null;
  auth_user_id: string | null;
  is_admin: boolean;
  display_name: string | null;
}

export interface FakeTripRow {
  id: string;
  slug: string;
  created_by_device_id?: string | null;
  created_by_account_id?: string | null;
  created_by_auth_user_id?: string | null;
  client_request_id?: string | null;
  [key: string]: unknown;
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

// A thenable, chainable select() builder: supports both `await
// builder.eq(...).is(...)` (resolves to {data: array, error}), the
// `{count: "exact", head: true}` counting form app/api/trips/create/
// route.ts's own rate limits use, and a terminal `.maybeSingle()`/
// `.single()` -- matching how the real postgrest-js builder can be used
// either way.
function makeTripSelectBuilder(trips: FakeTripRow[], opts?: { count?: string; head?: boolean }) {
  const filters: Record<string, unknown> = {};
  const nullChecks: string[] = [];
  const gteChecks: Array<[string, unknown]> = [];
  function matched(): FakeTripRow[] {
    return trips.filter(
      (r) =>
        matchesFilters(r as Record<string, unknown>, filters) &&
        nullChecks.every((c) => r[c] == null) &&
        gteChecks.every(([c, v]) => (r[c] as string) >= (v as string)),
    );
  }
  const builder = {
    eq(column: string, value: unknown) {
      filters[column] = value;
      return builder;
    },
    gte(column: string, value: unknown) {
      gteChecks.push([column, value]);
      return builder;
    },
    is(column: string, _value: null) {
      nullChecks.push(column);
      return builder;
    },
    async maybeSingle() {
      return { data: matched()[0] ?? null, error: null };
    },
    async single() {
      const rows = matched();
      if (rows.length === 0) return { data: null, error: { code: "PGRST116", message: "no rows" } };
      return { data: rows[0], error: null };
    },
    then(resolve: (v: { data: unknown; error: null; count?: number }) => void) {
      if (opts?.count) {
        resolve({ data: null, error: null, count: matched().length });
      } else {
        resolve({ data: matched(), error: null });
      }
    },
  };
  return builder;
}

interface FakeLoginAttemptRow {
  phone_number: string;
  failed_count: number;
  first_failed_at: string;
  locked_until: string | null;
}

export function createFakeAdminClient(
  rows: FakeAccountRow[],
  authOptions: FakeAuthOptions = {},
  trips: FakeTripRow[] = [],
  loginAttempts: FakeLoginAttemptRow[] = [],
) {
  const validTokens = authOptions.validTokens ?? {};
  let nextCreatedId = 1;
  let nextTripId = 1;

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
      if (table === "creator_accounts") {
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
          insert(row: Omit<FakeAccountRow, "id">) {
            return {
              select(_columns: string) {
                return {
                  async single() {
                    const created = { id: `account-${nextCreatedId++}`, ...row } as FakeAccountRow;
                    rows.push(created);
                    return { data: created, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "trips") {
        return {
          select(_columns: string, opts?: { count?: string; head?: boolean }) {
            return makeTripSelectBuilder(trips, opts);
          },
          // Matches the real app's atomic-conditional-update pattern:
          // `.update(patch).eq("id", id).is("created_by_account_id",
          // null)`, awaited bare (no .select()) -- only rows matching
          // BOTH the .eq and the .is guard at the moment this runs get
          // patched, exactly like a real `UPDATE ... WHERE id = $1 AND
          // created_by_account_id IS NULL` would.
          update(patch: Partial<FakeTripRow>) {
            const filters: Record<string, unknown> = {};
            const nullChecks: string[] = [];
            function matched(): FakeTripRow[] {
              return trips.filter(
                (r) => matchesFilters(r as Record<string, unknown>, filters) && nullChecks.every((c) => r[c] == null),
              );
            }
            const builder = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return builder;
              },
              is(column: string, _value: null) {
                nullChecks.push(column);
                return builder;
              },
              then(resolve: (v: { error: null }) => void) {
                matched().forEach((r) => Object.assign(r, patch));
                resolve({ error: null });
              },
            };
            return builder;
          },
          insert(row: Partial<FakeTripRow>) {
            return {
              select(_columns: string) {
                return {
                  async single() {
                    if (row.client_request_id && trips.some((r) => r.client_request_id === row.client_request_id)) {
                      return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
                    }
                    if (row.slug && trips.some((r) => r.slug === row.slug)) {
                      return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
                    }
                    const created = { id: `trip-${nextTripId++}`, ...row } as FakeTripRow;
                    trips.push(created);
                    return { data: created, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "account_login_attempts") {
        return {
          select(_columns: string) {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return builder;
              },
              async maybeSingle() {
                const row = loginAttempts.find((r) => matchesFilters(r as unknown as Record<string, unknown>, filters));
                return { data: row ?? null, error: null };
              },
            };
            return builder;
          },
          upsert(row: FakeLoginAttemptRow) {
            return {
              then(resolve: (v: { error: null }) => void) {
                const existing = loginAttempts.find((r) => r.phone_number === row.phone_number);
                if (existing) Object.assign(existing, row);
                else loginAttempts.push({ ...row });
                resolve({ error: null });
              },
            };
          },
          delete() {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq(column: string, value: unknown) {
                filters[column] = value;
                return builder;
              },
              then(resolve: (v: { error: null }) => void) {
                const keep = loginAttempts.filter((r) => !matchesFilters(r as unknown as Record<string, unknown>, filters));
                loginAttempts.length = 0;
                loginAttempts.push(...keep);
                resolve({ error: null });
              },
            };
            return builder;
          },
        };
      }

      throw new Error(`fake admin client: unexpected table "${table}"`);
    },
  };
}
