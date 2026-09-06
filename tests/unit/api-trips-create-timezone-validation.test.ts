// R6 follow-up: POST /api/trips/create requires an explicit, server-
// validated destination timezone -- never a hardcoded default, never a
// value silently derived from the client (no browser-Intl fallback, no
// request header, nothing read from localStorage at this layer). Runs
// the REAL route handler against the fake admin client (tests/unit/
// helpers/fakeSupabaseAdmin.ts), same approach as
// tests/unit/api-trips-create-ownership.test.ts, so this proves what the
// route itself actually checks.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeAdminClient, type FakeTripRow } from "./helpers/fakeSupabaseAdmin";

const AUTH_UID = "auth-creator-tz-0000-000000000000";
const TOKEN = "valid-tz-token";

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

const baseBody = {
  destination: "Tokyo",
  startDate: "2027-06-01",
  durationDays: 5,
  deviceId: "device-tz-1",
  website: "",
};

describe("R6 follow-up: POST /api/trips/create validates timezone server-side", () => {
  it("rejects a request with no timezone field at all -- never creates a trip", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(createRequest({ ...baseBody, requestId: "req-tz-missing" }));

    expect(response.status).toBe(400);
    expect(trips).toHaveLength(0);
  });

  it("rejects an empty-string timezone", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(createRequest({ ...baseBody, requestId: "req-tz-empty", timezone: "" }));

    expect(response.status).toBe(400);
    expect(trips).toHaveLength(0);
  });

  it("rejects a string that isn't a real IANA zone identifier", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(
      createRequest({ ...baseBody, requestId: "req-tz-invalid", timezone: "Definitely/Not_A_Real_Zone" }),
    );

    expect(response.status).toBe(400);
    expect(trips).toHaveLength(0);
  });

  it("rejects a non-string timezone value -- never coerced into one", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(
      createRequest({ ...baseBody, requestId: "req-tz-object", timezone: { tz: "Asia/Tokyo" } }),
    );

    expect(response.status).toBe(400);
    expect(trips).toHaveLength(0);
  });

  it("accepts a valid IANA timezone and stores exactly that value -- no hardcoded default", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(createRequest({ ...baseBody, requestId: "req-tz-tokyo", timezone: "Asia/Tokyo" }));

    expect(response.status).toBe(200);
    expect(trips).toHaveLength(1);
    expect(trips[0].timezone).toBe("Asia/Tokyo");
  });

  it("Europe/Athens and America/New_York are both accepted and stored verbatim, independent of each other", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    await POST(createRequest({ ...baseBody, requestId: "req-tz-athens", timezone: "Europe/Athens" }));
    await POST(createRequest({ ...baseBody, requestId: "req-tz-nyc", timezone: "America/New_York" }));

    expect(trips.map((t) => t.timezone).sort()).toEqual(["America/New_York", "Europe/Athens"]);
  });

  it("a retry of the SAME request id (idempotency) returns the original trip, doesn't re-validate or change its timezone", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const first = await POST(createRequest({ ...baseBody, requestId: "req-tz-retry", timezone: "Asia/Tokyo" }));
    const firstBody = await first.json();

    const retry = await POST(createRequest({ ...baseBody, requestId: "req-tz-retry", timezone: "Asia/Tokyo" }));
    const retryBody = await retry.json();

    expect(retry.status).toBe(200);
    expect(retryBody.slug).toBe(firstBody.slug);
    expect(trips).toHaveLength(1);
    expect(trips[0].timezone).toBe("Asia/Tokyo");
  });
});
