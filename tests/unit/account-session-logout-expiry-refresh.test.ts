// R1 regression (2026-09-05 review, closure batch): "testează logout,
// expirare și refresh pentru sesiunea creatorului" -- resolveAccountSession
// (src/lib/security/session.ts) already implements the expired-access-
// token -> refresh-token fallback and DELETE already implements logout,
// but neither had any test coverage before this file. The refresh/logout
// path specifically was untestable with the existing fakeSupabaseAdmin
// helper alone: refreshWithToken/signOutTokens/signInWithPhonePassword go
// through a SEPARATE, real @supabase/supabase-js client
// (createAuthOnlyClient(), anon key) rather than the mocked admin client
// -- this file mocks @supabase/supabase-js's createClient directly to
// make that path exercisable.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeAdminClient, type FakeAccountRow } from "./helpers/fakeSupabaseAdmin";
import { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME } from "@/lib/security/session";

const AUTH_UID = "auth-owner-0000-0000-000000000000";
const VALID_ACCESS_TOKEN = "valid-access-token";
const EXPIRED_ACCESS_TOKEN = "expired-access-token";
const VALID_REFRESH_TOKEN = "valid-refresh-token";
const EXPIRED_REFRESH_TOKEN = "expired-refresh-token";

const owner: FakeAccountRow = {
  id: "44444444-4444-4444-4444-444444444444",
  phone_number: "0700777888",
  pin_hash: null,
  auth_user_id: AUTH_UID,
  is_admin: false,
  display_name: "Owner",
};

let rows: FakeAccountRow[];
const signOut = vi.fn().mockResolvedValue({ error: null });
const setSession = vi.fn().mockResolvedValue({ data: {}, error: null });
const refreshSession = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeAdminClient(rows, { validTokens: { [VALID_ACCESS_TOKEN]: AUTH_UID } }),
}));

// Stands in for createAuthOnlyClient()'s real @supabase/supabase-js
// client -- the one thing NOT covered by the admin-client fake above.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      setSession,
      signOut,
      refreshSession,
    },
  }),
}));

beforeEach(() => {
  rows = [{ ...owner }];
  signOut.mockClear();
  setSession.mockClear();
  refreshSession.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://fake.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "fake-anon-key";
});

function cookieHeader(...pairs: Array<[string, string]>): string {
  return pairs.map(([k, v]) => `${k}=${v}`).join("; ");
}

const SAME_ORIGIN = { origin: "http://localhost", host: "localhost" };

describe("R1 regression: creator session logout", () => {
  it("DELETE with a valid session revokes it server-side (signOut called) and clears both cookies", async () => {
    const { DELETE } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "DELETE",
      headers: {
        ...SAME_ORIGIN,
        cookie: cookieHeader([ACCESS_COOKIE_NAME, VALID_ACCESS_TOKEN], [REFRESH_COOKIE_NAME, VALID_REFRESH_TOKEN]),
      },
    });

    const response = await DELETE(request);
    expect(response.status).toBe(200);
    expect(setSession).toHaveBeenCalledWith({
      access_token: VALID_ACCESS_TOKEN,
      refresh_token: VALID_REFRESH_TOKEN,
    });
    expect(signOut).toHaveBeenCalled();

    const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
    const clearsAccess = setCookieHeaders.some((h) => h.startsWith(`${ACCESS_COOKIE_NAME}=`) && /expires=thu, 01 jan 1970/i.test(h));
    const clearsRefresh = setCookieHeaders.some((h) => h.startsWith(`${REFRESH_COOKIE_NAME}=`) && /expires=thu, 01 jan 1970/i.test(h));
    expect(clearsAccess).toBe(true);
    expect(clearsRefresh).toBe(true);
  });

  it("DELETE with no session cookies at all still succeeds and never calls signOut (nothing to revoke)", async () => {
    const { DELETE } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "DELETE",
      headers: { ...SAME_ORIGIN },
    });

    const response = await DELETE(request);
    expect(response.status).toBe(200);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("DELETE still clears cookies even when the server-side revoke itself fails (best-effort, never fatal)", async () => {
    signOut.mockRejectedValueOnce(new Error("Supabase Auth unreachable"));
    const { DELETE } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "DELETE",
      headers: {
        ...SAME_ORIGIN,
        cookie: cookieHeader([ACCESS_COOKIE_NAME, VALID_ACCESS_TOKEN], [REFRESH_COOKIE_NAME, VALID_REFRESH_TOKEN]),
      },
    });

    const response = await DELETE(request);
    expect(response.status).toBe(200);
    const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
    expect(setCookieHeaders.some((h) => h.startsWith(`${ACCESS_COOKIE_NAME}=`) && /expires=thu, 01 jan 1970/i.test(h))).toBe(true);
  });
});

describe("R1 regression: creator session expiry and refresh", () => {
  it("GET with an expired access token but a VALID refresh token succeeds and the response carries refreshed cookies", async () => {
    refreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: "new-access-token",
          refresh_token: "new-refresh-token",
          expires_in: 3600,
          user: { id: AUTH_UID },
        },
      },
      error: null,
    });

    const { GET } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      headers: {
        cookie: cookieHeader([ACCESS_COOKIE_NAME, EXPIRED_ACCESS_TOKEN], [REFRESH_COOKIE_NAME, VALID_REFRESH_TOKEN]),
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(200);
    expect(refreshSession).toHaveBeenCalledWith({ refresh_token: VALID_REFRESH_TOKEN });

    const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
    expect(setCookieHeaders.some((h) => h.includes("new-access-token"))).toBe(true);
    expect(setCookieHeaders.some((h) => h.includes("new-refresh-token"))).toBe(true);
  });

  it("GET with an expired access token and an EXPIRED refresh token is rejected (401), not silently let through", async () => {
    refreshSession.mockResolvedValueOnce({ data: { session: null }, error: { message: "invalid refresh token" } });

    const { GET } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      headers: {
        cookie: cookieHeader([ACCESS_COOKIE_NAME, EXPIRED_ACCESS_TOKEN], [REFRESH_COOKIE_NAME, EXPIRED_REFRESH_TOKEN]),
      },
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it("GET with an expired access token and NO refresh token cookie at all is rejected (401)", async () => {
    const { GET } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      headers: { cookie: cookieHeader([ACCESS_COOKIE_NAME, EXPIRED_ACCESS_TOKEN]) },
    });

    const response = await GET(request);
    expect(response.status).toBe(401);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("PATCH after a successful refresh also carries the refreshed cookies forward on its own response", async () => {
    refreshSession.mockResolvedValueOnce({
      data: {
        session: {
          access_token: "new-access-token-2",
          refresh_token: "new-refresh-token-2",
          expires_in: 3600,
          user: { id: AUTH_UID },
        },
      },
      error: null,
    });

    const { PATCH } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "PATCH",
      headers: {
        ...SAME_ORIGIN,
        "content-type": "application/json",
        cookie: cookieHeader([ACCESS_COOKIE_NAME, EXPIRED_ACCESS_TOKEN], [REFRESH_COOKIE_NAME, VALID_REFRESH_TOKEN]),
      },
      body: JSON.stringify({ phoneNumber: "0799999999" }),
    });

    const response = await PATCH(request);
    expect(response.status).toBe(200);
    const setCookieHeaders = response.headers.getSetCookie?.() ?? [];
    expect(setCookieHeaders.some((h) => h.includes("new-access-token-2"))).toBe(true);
  });
});
