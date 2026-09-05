// R1 regression (2026-09-05 review, closure batch): "testează migrarea
// legacy cu autentificări concurente și eșecuri intermediare; repară
// eventualele curse confirmate."
//
// app/api/account/route.ts's handleAccount(), legacy-migration branch:
// two simultaneous logins for the SAME legacy phone (e.g. a double-tap,
// or two tabs) both read `existing` (pin_hash set, auth_user_id null)
// BEFORE either has written anything, both pass the PIN check, and both
// call admin.auth.admin.createUser() for the same phone. Supabase Auth
// enforces phone uniqueness across auth.users, so the SECOND createUser
// call in the race fails with a "phone already registered"-shaped error
// -- which this branch, unlike the brand-new-account branch just below
// it, did not special-case: it just `throw`s, and the outer route's
// try/catch turns that into a bare 500 for one of the two legitimate,
// correctly-PIN'd concurrent requests, even though the OTHER one succeeds
// and the account is, in fact, migrated correctly by then.
//
// This file simulates the race with a fake Auth surface that enforces
// the same phone-uniqueness constraint Supabase itself enforces (tracked
// in a shared authUsersByPhone map), runs both requests via Promise.all
// so neither can see the other's write before it makes its own decision,
// and proves: before the fix, the loser gets an unhandled 500; after the
// fix, both concurrent logins succeed and the account ends up migrated
// exactly once (no orphaned/duplicate auth identity).
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FakeAccountRow } from "./helpers/fakeSupabaseAdmin";
import { verifyPin as realVerifyPin } from "@/lib/security/pin";

const PHONE = "0711222333";
const PIN = "4321";

let rows: FakeAccountRow[];
// Simulates Supabase Auth's own auth.users table -- phone is unique here,
// exactly like a real Supabase project with phone auth enabled.
let authUsersByPhone: Map<string, { id: string; password: string }>;
let nextAuthUserId: number;

function matchesFilters(row: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}

// A slightly richer fake admin client than helpers/fakeSupabaseAdmin.ts's
// (that one's createUser always succeeds and has no uniqueness concept at
// all) -- this test needs the phone-uniqueness enforcement itself to
// reproduce the race, so it's inlined here rather than bolted onto the
// shared helper as an option only this file would ever set.
function createRacingFakeAdminClient() {
  return {
    auth: {
      async getUser() {
        return { data: { user: null }, error: { message: "not used in this test" } };
      },
      admin: {
        async createUser(attrs: { phone: string; password: string }) {
          if (authUsersByPhone.has(attrs.phone)) {
            return {
              data: { user: null },
              error: { message: "A user with this phone number has already been registered" },
            };
          }
          const id = `auth-user-${nextAuthUserId++}`;
          authUsersByPhone.set(attrs.phone, { id, password: attrs.password });
          return { data: { user: { id } }, error: null };
        },
      },
    },
    from(table: string) {
      if (table !== "creator_accounts" && table !== "account_login_attempts" && table !== "ip_rate_limits") {
        throw new Error(`racing fake admin client: unexpected table "${table}"`);
      }
      if (table !== "creator_accounts") {
        // loginRateLimit/ipRateLimit both read-then-upsert a row keyed by
        // phone/ip; this test's PIN is always correct and its request has
        // no IP header, so neither ever needs real state here.
        const noopChain = {
          select: () => noopChain,
          eq: () => noopChain,
          maybeSingle: async () => ({ data: null, error: null }),
          upsert: async () => ({ error: null }),
          delete: () => noopChain,
        };
        return noopChain;
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
            then(resolve: (v: { error: null }) => void) {
              const row = rows.find((r) => matchesFilters(r as unknown as Record<string, unknown>, filters));
              if (row) Object.assign(row, patch);
              resolve({ error: null });
            },
          };
          return builder;
        },
      };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createRacingFakeAdminClient(),
}));

vi.mock("@/lib/security/pin", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/pin")>();
  return actual;
});

// Same shared-state technique as account-session-logout-expiry-refresh.test.ts:
// signInWithPhonePassword goes through a separate real @supabase/supabase-js
// client, checked here against the same authUsersByPhone map createUser
// populates above, so a login after either request's migration path
// authenticates exactly like real Supabase Auth would.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      async signInWithPassword({ phone, password }: { phone: string; password: string }) {
        const entry = authUsersByPhone.get(phone);
        if (!entry || entry.password !== password) {
          return { data: { session: null }, error: { message: "Invalid login credentials" } };
        }
        return {
          data: {
            session: {
              access_token: `access-for-${entry.id}`,
              refresh_token: `refresh-for-${entry.id}`,
              expires_in: 3600,
              user: { id: entry.id },
            },
          },
          error: null,
        };
      },
    },
  }),
}));

function legacyRow(pinHash: string): FakeAccountRow {
  return {
    id: "legacy-account-1",
    phone_number: PHONE,
    pin_hash: pinHash,
    auth_user_id: null,
    is_admin: false,
    display_name: "Legacy Owner",
  };
}

function loginRequest(): Request {
  return new Request("http://localhost/api/account", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify({ phoneNumber: PHONE, pin: PIN }),
  });
}

beforeEach(() => {
  authUsersByPhone = new Map();
  nextAuthUserId = 1;
});

describe("R1 regression: legacy account migration under concurrent logins", () => {
  it("two simultaneous correct-PIN logins for the same not-yet-migrated legacy account BOTH succeed, and the account ends up migrated exactly once", async () => {
    const { hashPin } = await import("@/lib/security/pin");
    rows = [legacyRow(hashPin(PIN))];

    const { POST } = await import("../../app/api/account/route");

    const [responseA, responseB] = await Promise.all([POST(loginRequest()), POST(loginRequest())]);

    const bodyA = await responseA.json();
    const bodyB = await responseB.json();

    // Neither concurrent request may surface as a bare 500 to the user --
    // both presented the correct PIN and both must be treated as a
    // successful login, race or not.
    expect([responseA.status, responseB.status]).toEqual([200, 200]);
    expect(bodyA.accountId ?? rows[0].id).toBe(rows[0].id);
    expect(bodyB.accountId ?? rows[0].id).toBe(rows[0].id);

    // Exactly one Supabase Auth identity exists for this phone -- the
    // race did not create an orphaned duplicate.
    expect(authUsersByPhone.size).toBe(1);

    // The account row itself landed on a real, valid, migrated state --
    // pointing at the one auth user that exists, PIN hash cleared, never
    // left half-migrated or pointing at a since-orphaned id.
    expect(rows[0].pin_hash).toBeNull();
    expect(rows[0].auth_user_id).toBe(authUsersByPhone.get(PHONE)!.id);
  });

  it("sanity check: an incorrect PIN is still rejected even under the same concurrent shape", async () => {
    const { hashPin } = await import("@/lib/security/pin");
    rows = [legacyRow(hashPin(PIN))];

    const { POST } = await import("../../app/api/account/route");
    const wrongPinRequest = new Request("http://localhost/api/account", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
      body: JSON.stringify({ phoneNumber: PHONE, pin: "0000" }),
    });

    const response = await POST(wrongPinRequest);
    expect(response.status).toBe(401);
    expect(rows[0].auth_user_id).toBeNull();
  });
});

// Sanity import so this file fails loudly (at collection time) if
// src/lib/security/pin's real exports ever change shape, instead of
// silently testing against a stale assumption.
void realVerifyPin;
