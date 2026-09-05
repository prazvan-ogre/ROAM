// R1 regression test: GET/PATCH /api/account used to read/mutate a
// creator_accounts row given only its id (accountId query param / body
// field), with no proof the caller was that account's own holder (the
// 2026-09-05 review's hypothesis, confirmed by this file's previous
// version). Both routes now derive the acting account solely from a
// server-verified, HMAC-signed session cookie
// (src/lib/security/session.ts) set on a successful phone+PIN login --
// any accountId the client supplies is ignored entirely. Runs the route
// handlers' real code against a fake admin client (see
// helpers/fakeSupabaseAdmin.ts) -- no network, no real database.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeAdminClient, type FakeAccountRow } from "./helpers/fakeSupabaseAdmin";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/security/session";

process.env.ACCOUNT_SESSION_SECRET ??= "test-only-secret-not-used-in-production";

const victim: FakeAccountRow = {
  id: "11111111-1111-1111-1111-111111111111",
  phone_number: "0700111222",
  pin_hash: "victim-hash",
  is_admin: false,
  display_name: "Victim",
};
const attacker: FakeAccountRow = {
  id: "22222222-2222-2222-2222-222222222222",
  phone_number: "0700333444",
  pin_hash: "attacker-hash",
  is_admin: false,
  display_name: "Attacker",
};

let rows: FakeAccountRow[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeAdminClient(rows),
}));

beforeEach(() => {
  // Fresh rows per test -- PATCH mutates in place.
  rows = [{ ...victim }, { ...attacker }];
});

function cookieHeader(accountId: string): string {
  return `${SESSION_COOKIE_NAME}=${createSessionToken(accountId)}`;
}

describe("R1: /api/account ownership", () => {
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

  it("GET with the legitimate owner's own session cookie returns that account's own data", async () => {
    const { GET } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      headers: { cookie: cookieHeader(victim.id) },
    });

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.phoneNumber).toBe(victim.phone_number);
  });

  it("GET with a forged/tampered session cookie value is rejected, not treated as a valid identity", async () => {
    const { GET } = await import("../../app/api/account/route");
    const forged = createSessionToken(victim.id).replace(/.$/, (c) => (c === "a" ? "b" : "a"));
    const request = new Request("http://localhost/api/account", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${forged}` },
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("PATCH with attacker's own session cookie, targeting victim's id in the body, updates the ATTACKER's row, not the victim's", async () => {
    const { PATCH } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: cookieHeader(attacker.id) },
      // An attacker who has learned/guessed the victim's id can no longer
      // aim a PATCH at it -- the route never reads accountId from the
      // body any more, only from the session cookie.
      body: JSON.stringify({ accountId: victim.id, phoneNumber: "0799999999", pin: "999999" }),
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
    expect(rows.find((r) => r.id === victim.id)?.pin_hash).toBe(victim.pin_hash);
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
