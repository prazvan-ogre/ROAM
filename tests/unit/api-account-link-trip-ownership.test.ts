// R5 regression: POST /api/account/link-trip decides trip ownership
// ONLY from created_by_auth_user_id (the caller's own bearer token,
// verified against Supabase Auth), never from a client-supplied
// deviceId/accountId, never implicitly transfers an already-linked
// trip, and sweeps up every one of the device's own unclaimed trips (a
// safe path to associate after authentication), not just the one
// tripSlug given. Runs the REAL route handler against the fake admin
// client (tests/unit/helpers/fakeSupabaseAdmin.ts).
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeAdminClient, type FakeAccountRow, type FakeTripRow } from "./helpers/fakeSupabaseAdmin";
import { ACCESS_COOKIE_NAME } from "@/lib/security/session";

const SESSION_TOKEN = "creator-session-token";
const DEVICE_TOKEN = "device-bearer-token";
const ACCOUNT_AUTH_UID = "auth-account-owner";
const DEVICE_AUTH_UID = "auth-device-verified";
const OTHER_AUTH_UID = "auth-someone-else";

const account: FakeAccountRow = {
  id: "account-1",
  phone_number: "0700000001",
  pin_hash: null,
  auth_user_id: ACCOUNT_AUTH_UID,
  is_admin: false,
  display_name: "Andrei",
};

let rows: FakeAccountRow[];
let trips: FakeTripRow[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeAdminClient(
      rows,
      { validTokens: { [SESSION_TOKEN]: ACCOUNT_AUTH_UID, [DEVICE_TOKEN]: DEVICE_AUTH_UID } },
      trips,
    ),
}));

beforeEach(() => {
  rows = [{ ...account }];
  trips = [];
});

function request(body: Record<string, unknown>, deviceToken: string | null = DEVICE_TOKEN) {
  return new Request("http://localhost/api/account/link-trip", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${ACCESS_COOKIE_NAME}=${SESSION_TOKEN}`,
      origin: "http://localhost",
      host: "localhost",
      ...(deviceToken ? { authorization: `Bearer ${deviceToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("R5 regression: /api/account/link-trip decides ownership from the verified auth user, never a client-supplied id", () => {
  it("links a trip whose created_by_auth_user_id matches the caller's OWN verified bearer token", async () => {
    trips = [{ id: "trip-1", slug: "trip-one", created_by_auth_user_id: DEVICE_AUTH_UID, created_by_account_id: null }];

    const { POST } = await import("../../app/api/account/link-trip/route");
    const response = await POST(request({ tripSlug: "trip-one", deviceId: "device-1" }));

    expect(response.status).toBe(200);
    expect(trips[0].created_by_account_id).toBe(account.id);
  });

  it("does NOT link a trip whose created_by_auth_user_id belongs to someone else, even if the client asserts a matching deviceId", async () => {
    trips = [
      {
        id: "trip-1",
        slug: "trip-one",
        created_by_auth_user_id: OTHER_AUTH_UID,
        // The client can send any deviceId string it wants -- it must be
        // irrelevant to the ownership decision.
        created_by_device_id: "device-1",
        created_by_account_id: null,
      },
    ];

    const { POST } = await import("../../app/api/account/link-trip/route");
    await POST(request({ tripSlug: "trip-one", deviceId: "device-1" }));

    expect(trips[0].created_by_account_id).toBeNull();
  });

  it("never transfers a trip already linked to a DIFFERENT account, even for the caller's own verified trip", async () => {
    trips = [
      {
        id: "trip-1",
        slug: "trip-one",
        created_by_auth_user_id: DEVICE_AUTH_UID,
        created_by_account_id: "some-other-account",
      },
    ];

    const { POST } = await import("../../app/api/account/link-trip/route");
    await POST(request({ tripSlug: "trip-one", deviceId: "device-1" }));

    expect(trips[0].created_by_account_id).toBe("some-other-account");
  });

  it("sweeps up EVERY one of the device's own unclaimed trips, not just the one tripSlug given", async () => {
    trips = [
      { id: "trip-1", slug: "trip-one", created_by_auth_user_id: DEVICE_AUTH_UID, created_by_account_id: null },
      { id: "trip-2", slug: "trip-two", created_by_auth_user_id: DEVICE_AUTH_UID, created_by_account_id: null },
    ];

    const { POST } = await import("../../app/api/account/link-trip/route");
    // The request only names trip-one -- trip-two was created earlier
    // and deferred (the "Sari peste" path) -- both must still get linked,
    // since this is meant to be the safe recovery path after
    // authentication, not dependent on remembering a specific slug.
    await POST(request({ tripSlug: "trip-one", deviceId: "device-1" }));

    expect(trips[0].created_by_account_id).toBe(account.id);
    expect(trips[1].created_by_account_id).toBe(account.id);
  });

  it("without a valid device bearer token, no trip is linked at all (best-effort, never a hard failure)", async () => {
    trips = [{ id: "trip-1", slug: "trip-one", created_by_auth_user_id: DEVICE_AUTH_UID, created_by_account_id: null }];

    const { POST } = await import("../../app/api/account/link-trip/route");
    const response = await POST(request({ tripSlug: "trip-one", deviceId: "device-1" }, null));

    expect(response.status).toBe(200);
    expect(trips[0].created_by_account_id).toBeNull();
  });
});
