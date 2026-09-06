// R5 round 2: explicit association contract for POST /api/account/link-trip
// (src/lib/security/tripOwnership.ts's resolveTripLinkOutcome). Runs the
// REAL route handler against the fake admin client, proving each of the
// six states the spec calls for rather than just the two ("worked" /
// "didn't") the earlier R5 round distinguished.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeAdminClient, type FakeAccountRow, type FakeTripRow } from "./helpers/fakeSupabaseAdmin";

let rows: FakeAccountRow[];
let trips: FakeTripRow[];
const validTokens: Record<string, string> = { "device-token": "auth-user-device-1" };

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeAdminClient(rows, { validTokens }, trips, []),
}));

vi.mock("@/lib/security/csrf", () => ({ isSameOriginRequest: () => true }));

// resolveAccountSession is exercised for real everywhere else in this
// suite (api-account-link-trip-ownership.test.ts) -- stubbed here purely
// to isolate this file's assertions to the tripLink contract itself,
// which only depends on the DEVICE bearer token, not the account session
// cookie's own internals.
vi.mock("@/lib/security/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/security/session")>();
  return {
    ...actual,
    resolveAccountSession: vi.fn().mockResolvedValue({ accountId: "account-mine", refreshed: null }),
  };
});

beforeEach(() => {
  rows = [{ id: "account-mine", phone_number: "0700000000", pin_hash: null, auth_user_id: "auth-account-mine", is_admin: false, display_name: "Ana" }];
  trips = [];
});

function linkRequest(body: Record<string, unknown>, token?: string) {
  return new Request("http://localhost/api/account/link-trip", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost",
      host: "localhost",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("R5 round 2: the association contract's six states", () => {
  it("not_found: a slug with no matching trip", async () => {
    const { POST } = await import("../../app/api/account/link-trip/route");
    const response = await POST(linkRequest({ tripSlug: "no-such-trip", deviceId: "dev-1" }, "device-token"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tripLink).toBe("not_found");
  });

  it("device_session_missing: no valid bearer token at all", async () => {
    trips = [{ id: "trip-1", slug: "corfu-2027", created_by_auth_user_id: "auth-user-device-1", created_by_account_id: null }];
    const { POST } = await import("../../app/api/account/link-trip/route");
    const response = await POST(linkRequest({ tripSlug: "corfu-2027", deviceId: "dev-1" }, "not-a-real-token"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tripLink).toBe("device_session_missing");
    expect(trips[0].created_by_account_id).toBeNull(); // untouched
  });

  it("not_owned_by_device: this device didn't create the trip (nor any legacy trip with no verified creator)", async () => {
    trips = [{ id: "trip-1", slug: "corfu-2027", created_by_auth_user_id: "someone-elses-auth-id", created_by_account_id: null }];
    const { POST } = await import("../../app/api/account/link-trip/route");
    const response = await POST(linkRequest({ tripSlug: "corfu-2027", deviceId: "dev-1" }, "device-token"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tripLink).toBe("not_owned_by_device");
    expect(trips[0].created_by_account_id).toBeNull(); // never claimed via slug knowledge alone
  });

  it("not_owned_by_device: a legacy trip with no created_by_auth_user_id at all is never auto-claimed", async () => {
    trips = [{ id: "trip-1", slug: "old-trip-2025", created_by_auth_user_id: null, created_by_account_id: null }];
    const { POST } = await import("../../app/api/account/link-trip/route");
    const response = await POST(linkRequest({ tripSlug: "old-trip-2025", deviceId: "dev-1" }, "device-token"));
    const body = await response.json();

    expect(body.tripLink).toBe("not_owned_by_device");
    expect(trips[0].created_by_account_id).toBeNull();
  });

  it("linked: a first-time successful claim by the trip's real, verified creator", async () => {
    trips = [{ id: "trip-1", slug: "corfu-2027", created_by_auth_user_id: "auth-user-device-1", created_by_account_id: null }];
    const { POST } = await import("../../app/api/account/link-trip/route");
    const response = await POST(linkRequest({ tripSlug: "corfu-2027", deviceId: "dev-1" }, "device-token"));
    const body = await response.json();

    expect(body.tripLink).toBe("linked");
    expect(trips[0].created_by_account_id).toBe("account-mine");
  });

  it("already_linked: retrying after a lost confirmation is idempotent, not an error", async () => {
    trips = [{ id: "trip-1", slug: "corfu-2027", created_by_auth_user_id: "auth-user-device-1", created_by_account_id: "account-mine" }];
    const { POST } = await import("../../app/api/account/link-trip/route");
    const response = await POST(linkRequest({ tripSlug: "corfu-2027", deviceId: "dev-1" }, "device-token"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tripLink).toBe("already_linked");
    expect(trips[0].created_by_account_id).toBe("account-mine"); // unchanged
  });

  it("linked_to_other: this device created it, but it's already claimed by a DIFFERENT account -- never transferred", async () => {
    trips = [{ id: "trip-1", slug: "corfu-2027", created_by_auth_user_id: "auth-user-device-1", created_by_account_id: "someone-elses-account" }];
    const { POST } = await import("../../app/api/account/link-trip/route");
    const response = await POST(linkRequest({ tripSlug: "corfu-2027", deviceId: "dev-1" }, "device-token"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.tripLink).toBe("linked_to_other");
    expect(trips[0].created_by_account_id).toBe("someone-elses-account"); // ownership never transferred
  });

  it("two concurrent claims for the same unclaimed trip from two different accounts: exactly one wins, the other sees linked_to_other", async () => {
    trips = [{ id: "trip-1", slug: "corfu-2027", created_by_auth_user_id: "auth-user-device-1", created_by_account_id: null }];
    rows.push({ id: "account-other", phone_number: "0711111111", pin_hash: null, auth_user_id: "auth-account-other", is_admin: false, display_name: "Bogdan" });

    const { resolveTripLinkOutcome } = await import("@/lib/security/tripOwnership");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const admin = createAdminClient();

    const [resultA, resultB] = await Promise.all([
      resolveTripLinkOutcome(admin, { tripSlug: "corfu-2027", authUserId: "auth-user-device-1", accountId: "account-mine" }),
      resolveTripLinkOutcome(admin, { tripSlug: "corfu-2027", authUserId: "auth-user-device-1", accountId: "account-other" }),
    ]);

    const outcomes = [resultA, resultB].sort();
    expect(outcomes).toEqual(["linked", "linked_to_other"]);
    // Whichever won, the trip has exactly one owner, matching the "linked" result.
    const winner = resultA === "linked" ? "account-mine" : "account-other";
    expect(trips[0].created_by_account_id).toBe(winner);
  });
});
