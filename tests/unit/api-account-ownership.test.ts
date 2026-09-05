// Batch 2 regression test (2026-09-05 review, R1 continued): GET/PATCH
// /api/account used to derive the acting account from a custom
// HMAC-signed cookie (R1's own first pass, see git history). That cookie
// is real hardening over a bare client-supplied accountId, but it's
// still a hand-rolled token scheme -- this batch replaces it with a real
// Supabase Auth session (src/lib/security/session.ts's
// resolveAccountSession): the access-token cookie is verified against a
// fake standing in for Supabase's own admin.auth.getUser(token), never
// just parsed. Runs the route handlers' real code against a fake admin
// client (see helpers/fakeSupabaseAdmin.ts) -- no network, no real
// database, no real Supabase Auth server.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeAdminClient, type FakeAccountRow } from "./helpers/fakeSupabaseAdmin";
import { ACCESS_COOKIE_NAME } from "@/lib/security/session";

const VICTIM_AUTH_UID = "auth-victim-0000-0000-000000000000";
const ATTACKER_AUTH_UID = "auth-attacker-000-0000-000000000000";
const VICTIM_TOKEN = "valid-token-for-victim";
const ATTACKER_TOKEN = "valid-token-for-attacker";

const victim: FakeAccountRow = {
  id: "11111111-1111-1111-1111-111111111111",
  phone_number: "0700111222",
  pin_hash: null,
  auth_user_id: VICTIM_AUTH_UID,
  is_admin: false,
  display_name: "Victim",
};
const attacker: FakeAccountRow = {
  id: "22222222-2222-2222-2222-222222222222",
  phone_number: "0700333444",
  pin_hash: null,
  auth_user_id: ATTACKER_AUTH_UID,
  is_admin: false,
  display_name: "Attacker",
};

let rows: FakeAccountRow[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeAdminClient(rows, {
      validTokens: { [VICTIM_TOKEN]: VICTIM_AUTH_UID, [ATTACKER_TOKEN]: ATTACKER_AUTH_UID },
    }),
}));

beforeEach(() => {
  // Fresh rows per test -- PATCH mutates in place.
  rows = [{ ...victim }, { ...attacker }];
});

function cookieHeader(token: string): string {
  return `${ACCESS_COOKIE_NAME}=${token}`;
}

describe("batch 2: /api/account session ownership", () => {
  it("GET with no session cookie at all is rejected", async () => {
    const { GET } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account");

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("GET with a forged accountId query param (no cookie) is still rejected -- the query param is never read", async () => {
    const { GET } = await import("../../app/api/account/route");
    const request = new Request(`http://localhost/api/account?accountId=${victim.id}`);

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("GET with the legitimate owner's own verified session token returns that account's own data", async () => {
    const { GET } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      headers: { cookie: cookieHeader(VICTIM_TOKEN) },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.phoneNumber).toBe(victim.phone_number);
  });

  it("GET with a forged/unrecognized access token is rejected, not treated as a valid identity", async () => {
    const { GET } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      headers: { cookie: cookieHeader("this-token-was-never-issued") },
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("PATCH with attacker's own session token, targeting victim's id in the body, updates the ATTACKER's row, not the victim's", async () => {
    const { PATCH } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: cookieHeader(ATTACKER_TOKEN) },
      // An attacker who has learned/guessed the victim's id can no longer
      // aim a PATCH at it -- the route never reads accountId from the
      // body at all, only the session-resolved identity.
      body: JSON.stringify({ accountId: victim.id, phoneNumber: "0799999999", pin: "9999" }),
    });

    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    // The attacker's own row was updated (a legitimate self-service
    // edit)...
    expect(body.phoneNumber).toBe("0799999999");
    expect(rows.find((r) => r.id === attacker.id)?.phone_number).toBe("0799999999");
    // ...and the victim's row was left completely untouched.
    expect(rows.find((r) => r.id === victim.id)?.phone_number).toBe(victim.phone_number);
  });

  it("PATCH with no session cookie is rejected and mutates nothing", async () => {
    const { PATCH } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: victim.id, phoneNumber: "0799999999" }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(401);
    expect(rows.find((r) => r.id === victim.id)?.phone_number).toBe(victim.phone_number);
  });
});
