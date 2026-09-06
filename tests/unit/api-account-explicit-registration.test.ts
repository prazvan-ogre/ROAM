// R5-fix4 regression: an unrecognized phone+PIN at the PLAIN "Călătoriile
// mele" login (app/trips/page.tsx, no ?link=) must not silently create a
// brand-new account -- expectExisting: true now rejects it, the same
// guard that already existed for the "linking a new trip" path but used
// to be skipped entirely here. Runs the REAL route handler against the
// fake admin client.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeAdminClient, type FakeAccountRow } from "./helpers/fakeSupabaseAdmin";

let rows: FakeAccountRow[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeAdminClient(rows, {}, [], []),
}));

// The actual phone+password sign-in goes through a separate, real
// Supabase Auth client (createAuthOnlyClient in src/lib/security/
// session.ts), not the admin client above -- stubbed here so a
// successful "create a brand-new account" run can reach the response
// this test actually checks (the account row + status code), without
// needing a real Supabase project. resolveAccountSession/
// resolveBearerAuthUserId etc. stay real, backed by the fake admin
// client's auth.getUser.
vi.mock("@/lib/security/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/session")>();
  return {
    ...actual,
    signInWithPhonePassword: vi.fn().mockResolvedValue({
      error: null,
      data: { session: { access_token: "fake-access", refresh_token: "fake-refresh", expires_in: 3600 } },
    }),
  };
});

beforeEach(() => {
  rows = [];
});

function loginRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/account", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
    body: JSON.stringify(body),
  });
}

describe("R5-fix4: an unrecognized identifier at login never implicitly creates an account", () => {
  it("expectExisting: true with no matching phone number is rejected, no account created (plain login, no linkTripSlug)", async () => {
    const { POST } = await import("../../app/api/account/route");
    const response = await POST(loginRequest({ phoneNumber: "0799999999", pin: "1234", expectExisting: true }));

    expect(response.status).toBe(401);
    expect(rows).toHaveLength(0);
  });

  it("expectExisting: false (explicit 'Nu, e prima dată') with no matching phone creates a new account", async () => {
    const { POST } = await import("../../app/api/account/route");
    const response = await POST(loginRequest({ phoneNumber: "0799999999", pin: "1234", expectExisting: false }));

    expect(response.status).toBe(200);
    expect(rows).toHaveLength(1);
  });
});
