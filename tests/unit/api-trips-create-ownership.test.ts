// R5 regression: POST /api/trips/create now requires a server-verified
// bearer token (never a client-supplied deviceId) to stamp
// created_by_auth_user_id, and is idempotent on client_request_id. Runs
// the REAL route handler against the fake admin client (tests/unit/
// helpers/fakeSupabaseAdmin.ts) -- not a fully mocked route -- so this
// proves what app/api/trips/create/route.ts's own code actually checks,
// not a reimplementation of it. Real concurrency/constraint enforcement
// is covered separately against a real Postgres instance in
// supabase/tests/r5_trip_creator_ownership.test.sql.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeAdminClient, type FakeTripRow } from "./helpers/fakeSupabaseAdmin";

const AUTH_UID = "auth-creator-0000-0000-000000000000";
const TOKEN = "valid-device-token";

let trips: FakeTripRow[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeAdminClient([], { validTokens: { [TOKEN]: AUTH_UID } }, trips),
}));

beforeEach(() => {
  trips = [];
});

function createRequest(body: Record<string, unknown>, token: string | null = TOKEN) {
  return new Request("http://localhost/api/trips/create", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const validBody = {
  destination: "Corfu",
  startDate: "2027-06-01",
  durationDays: 5,
  deviceId: "device-1",
  requestId: "req-1",
  website: "",
};

describe("R5 regression: POST /api/trips/create requires a verified identity, not a client-supplied one", () => {
  it("rejects a request with no bearer token at all -- never creates a trip", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(createRequest(validBody, null));

    expect(response.status).toBe(401);
    expect(trips).toHaveLength(0);
  });

  it("rejects a request with an invalid/expired bearer token", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(createRequest(validBody, "forged-or-expired-token"));

    expect(response.status).toBe(401);
    expect(trips).toHaveLength(0);
  });

  it("a valid request stamps created_by_auth_user_id from the VERIFIED token, never from the client-supplied deviceId", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(createRequest(validBody));

    expect(response.status).toBe(200);
    expect(trips).toHaveLength(1);
    expect(trips[0].created_by_auth_user_id).toBe(AUTH_UID);
    expect(trips[0].created_by_device_id).toBe("device-1");
    expect(trips[0].created_by_account_id ?? null).toBeNull();
  });
});

describe("R5 regression: trip creation is idempotent on requestId", () => {
  it("a retry with the SAME requestId returns the original trip's slug, never a second trip", async () => {
    const { POST } = await import("../../app/api/trips/create/route");

    const first = await POST(createRequest(validBody));
    const firstBody = await first.json();
    expect(trips).toHaveLength(1);

    const retry = await POST(createRequest(validBody));
    const retryBody = await retry.json();

    expect(retry.status).toBe(200);
    expect(retryBody.slug).toBe(firstBody.slug);
    expect(trips).toHaveLength(1);
  });

  it("a DIFFERENT requestId with the same destination/dates is a genuinely separate trip", async () => {
    const { POST } = await import("../../app/api/trips/create/route");

    await POST(createRequest(validBody));
    const second = await POST(createRequest({ ...validBody, requestId: "req-2" }));

    expect(second.status).toBe(200);
    expect(trips).toHaveLength(2);
  });
});
