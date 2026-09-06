// R1 regression (2026-09-05 review, closure batch): /api/account's
// POST/PATCH/DELETE and /api/account/link-trip's POST authenticate off an
// httpOnly session cookie (sameSite: "lax") -- which a browser still
// attaches to a cross-site <form> POST/PATCH/DELETE (SameSite=Lax only
// blocks cross-site GET navigations and cross-site XHR/fetch, not a
// top-level form submission) and to a cross-origin fetch using
// mode:"no-cors" with a text/plain body (bypasses CORS preflight; this
// app's route handlers parse the body with request.json(), which does
// not check Content-Type). SameSite=Lax alone was not a complete CSRF
// defense for these routes. src/lib/security/csrf.ts's
// isSameOriginRequest() closes that gap by requiring the request's own
// Origin (or Referer) to match its Host -- this file proves both the
// same-origin-allowed and cross-origin-rejected halves of that check,
// for every route it was added to.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeAdminClient, type FakeAccountRow } from "./helpers/fakeSupabaseAdmin";
import { ACCESS_COOKIE_NAME } from "@/lib/security/session";

const AUTH_UID = "auth-owner-0000-0000-000000000000";
const TOKEN = "valid-token-for-owner";

const owner: FakeAccountRow = {
  id: "33333333-3333-3333-3333-333333333333",
  phone_number: "0700555666",
  pin_hash: null,
  auth_user_id: AUTH_UID,
  is_admin: false,
  display_name: "Owner",
};

let rows: FakeAccountRow[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeAdminClient(rows, { validTokens: { [TOKEN]: AUTH_UID } }),
}));

beforeEach(() => {
  rows = [{ ...owner }];
});

function cookieHeader(): string {
  return `${ACCESS_COOKIE_NAME}=${TOKEN}`;
}

describe("R1 regression: CSRF protection on cookie-authenticated /api/account routes", () => {
  it("PATCH from the same origin (matching Origin and Host) is allowed", async () => {
    const { PATCH } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(),
        origin: "http://localhost",
        host: "localhost",
      },
      body: JSON.stringify({ phoneNumber: "0799999999" }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);
    expect(rows.find((r) => r.id === owner.id)?.phone_number).toBe("0799999999");
  });

  it("PATCH from a cross-origin Origin header is rejected before touching any data", async () => {
    const { PATCH } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(),
        origin: "https://attacker.example",
        host: "localhost",
      },
      body: JSON.stringify({ phoneNumber: "0799999999" }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(403);
    // The victim's own valid session cookie was present -- only the
    // origin mismatch is what blocked this, and it must block BEFORE any
    // mutation, not just report failure after the fact.
    expect(rows.find((r) => r.id === owner.id)?.phone_number).toBe(owner.phone_number);
  });

  it("PATCH with a cross-origin Referer (no Origin header) is also rejected", async () => {
    const { PATCH } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(),
        referer: "https://attacker.example/evil-form.html",
        host: "localhost",
      },
      body: JSON.stringify({ phoneNumber: "0799999999" }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(403);
    expect(rows.find((r) => r.id === owner.id)?.phone_number).toBe(owner.phone_number);
  });

  it("PATCH with neither Origin nor Referer at all is rejected (fails closed, not open)", async () => {
    const { PATCH } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: cookieHeader(), host: "localhost" },
      body: JSON.stringify({ phoneNumber: "0799999999" }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(403);
  });

  it("DELETE (logout) from a cross-origin Origin is rejected", async () => {
    const { DELETE } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "DELETE",
      headers: { cookie: cookieHeader(), origin: "https://attacker.example", host: "localhost" },
    });

    const response = await DELETE(request);
    expect(response.status).toBe(403);
  });

  it("DELETE (logout) from the same origin is allowed", async () => {
    const { DELETE } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "DELETE",
      headers: { cookie: cookieHeader(), origin: "http://localhost", host: "localhost" },
    });

    const response = await DELETE(request);
    expect(response.status).toBe(200);
  });

  it("POST /api/account/link-trip from a cross-origin Origin is rejected", async () => {
    const { POST } = await import("../../app/api/account/link-trip/route");
    const request = new Request("http://localhost/api/account/link-trip", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: cookieHeader(),
        origin: "https://attacker.example",
        host: "localhost",
      },
      body: JSON.stringify({ tripSlug: "some-trip", deviceId: "dev-1" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("POST /api/account (login) from a cross-origin Origin is rejected before any account lookup", async () => {
    const { POST } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://attacker.example", host: "localhost" },
      body: JSON.stringify({ phoneNumber: owner.phone_number, pin: "1234" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
  });
});
