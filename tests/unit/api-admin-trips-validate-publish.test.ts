// R7: /api/admin/trips/[slug]/validate and .../publish are gated by the
// SAME server-verified admin session as every other admin write in this
// codebase (src/lib/security/adminAuth.ts's requireAdminSession) -- never
// a client-supplied isAdmin flag, accountId, or deviceId. These tests run
// the real route handlers against a fake admin client (see
// helpers/fakeSupabaseAdmin.ts, extended with a minimal .rpc() for this
// batch) so they prove what the routes themselves check before calling
// validate_trip_content()/publish_trip() -- not permission mocks standing
// in for the routes. The SQL functions' own behavior is covered
// separately by supabase/tests/r7_content_publishing.test.sql against a
// real Postgres instance.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createFakeAdminClient,
  type FakeAccountRow,
  type FakeTripRow,
  type FakeRpcHandlers,
} from "./helpers/fakeSupabaseAdmin";
import { ACCESS_COOKIE_NAME } from "@/lib/security/session";

const ADMIN_AUTH_UID = "auth-admin-0000-0000-000000000000";
const CREATOR_AUTH_UID = "auth-creator-000-0000-000000000000";
const ADMIN_TOKEN = "valid-token-for-admin";
const CREATOR_TOKEN = "valid-token-for-creator";

const adminAccount: FakeAccountRow = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  phone_number: "0700111222",
  pin_hash: null,
  auth_user_id: ADMIN_AUTH_UID,
  is_admin: true,
  display_name: "Admin",
};
// A creator account that is NOT an admin -- covers both "user without
// admin rights" and "creator from a different account" in one fixture:
// authorization here is purely is_admin-based, never ownership-based, so
// a non-admin creator is rejected the same way regardless of whose trip
// they're targeting.
const creatorAccount: FakeAccountRow = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  phone_number: "0700333444",
  pin_hash: null,
  auth_user_id: CREATOR_AUTH_UID,
  is_admin: false,
  display_name: "Creator",
};

const trip: FakeTripRow = {
  id: "trip-1111-1111-1111-111111111111",
  slug: "kassandra-2026",
  content_status: "pending",
};

let rows: FakeAccountRow[];
let trips: FakeTripRow[];
let rpcHandlers: FakeRpcHandlers;

const validateHandler = vi.fn((params: Record<string, unknown>) => ({
  data: [
    { check_key: "discover.missing", severity: "error", message: "Lipsește Discover.", day_number: 1, entity_id: null },
    { check_key: "prize.not_configured", severity: "warning", message: "Premiul nu e configurat.", day_number: null, entity_id: null },
  ],
  error: null,
  __params: params,
}));

const publishHandler = vi.fn((_params: Record<string, unknown>) => ({
  data: { status: "published", error_count: 0, warning_count: 1, issues: [] },
  error: null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeAdminClient(
      rows,
      { validTokens: { [ADMIN_TOKEN]: ADMIN_AUTH_UID, [CREATOR_TOKEN]: CREATOR_AUTH_UID } },
      trips,
      [],
      rpcHandlers,
    ),
}));

beforeEach(() => {
  rows = [{ ...adminAccount }, { ...creatorAccount }];
  trips = [{ ...trip }];
  validateHandler.mockClear();
  publishHandler.mockClear();
  rpcHandlers = { validate_trip_content: validateHandler, publish_trip: publishHandler };
});

function cookieHeader(token: string): string {
  return `${ACCESS_COOKIE_NAME}=${token}`;
}

describe("R7: GET /api/admin/trips/[slug]/validate", () => {
  it("with no session cookie is rejected and never calls validate_trip_content", async () => {
    const { GET } = await import("../../app/api/admin/trips/[slug]/validate/route");
    const request = new Request("http://localhost/api/admin/trips/kassandra-2026/validate");

    const response = await GET(request, { params: { slug: "kassandra-2026" } });
    expect(response.status).toBe(401);
    expect(validateHandler).not.toHaveBeenCalled();
  });

  it("with a non-admin creator's own valid session is rejected with 403", async () => {
    const { GET } = await import("../../app/api/admin/trips/[slug]/validate/route");
    const request = new Request("http://localhost/api/admin/trips/kassandra-2026/validate", {
      headers: { cookie: cookieHeader(CREATOR_TOKEN) },
    });

    const response = await GET(request, { params: { slug: "kassandra-2026" } });
    expect(response.status).toBe(403);
    expect(validateHandler).not.toHaveBeenCalled();
  });

  it("with a forged/unrecognized access token is rejected with 401", async () => {
    const { GET } = await import("../../app/api/admin/trips/[slug]/validate/route");
    const request = new Request("http://localhost/api/admin/trips/kassandra-2026/validate", {
      headers: { cookie: cookieHeader("this-token-was-never-issued") },
    });

    const response = await GET(request, { params: { slug: "kassandra-2026" } });
    expect(response.status).toBe(401);
    expect(validateHandler).not.toHaveBeenCalled();
  });

  it("for a slug that doesn't exist returns 404 and never calls validate_trip_content", async () => {
    const { GET } = await import("../../app/api/admin/trips/[slug]/validate/route");
    const request = new Request("http://localhost/api/admin/trips/does-not-exist/validate", {
      headers: { cookie: cookieHeader(ADMIN_TOKEN) },
    });

    const response = await GET(request, { params: { slug: "does-not-exist" } });
    expect(response.status).toBe(404);
    expect(validateHandler).not.toHaveBeenCalled();
  });

  it("with a real admin session calls validate_trip_content for the resolved trip id and returns its issues", async () => {
    const { GET } = await import("../../app/api/admin/trips/[slug]/validate/route");
    const request = new Request("http://localhost/api/admin/trips/kassandra-2026/validate", {
      headers: { cookie: cookieHeader(ADMIN_TOKEN) },
    });

    const response = await GET(request, { params: { slug: "kassandra-2026" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(validateHandler).toHaveBeenCalledTimes(1);
    expect(validateHandler.mock.calls[0][0]).toEqual({ p_trip_id: trip.id });
    expect(body.contentStatus).toBe("pending");
    expect(body.issues).toHaveLength(2);
    expect(body.issues[0].check_key).toBe("discover.missing");
  });
});

describe("R7: POST /api/admin/trips/[slug]/publish", () => {
  it("with no session cookie is rejected and never calls publish_trip", async () => {
    const { POST } = await import("../../app/api/admin/trips/[slug]/publish/route");
    const request = new Request("http://localhost/api/admin/trips/kassandra-2026/publish", { method: "POST" });

    const response = await POST(request, { params: { slug: "kassandra-2026" } });
    expect(response.status).toBe(401);
    expect(publishHandler).not.toHaveBeenCalled();
  });

  it("with a non-admin creator's own valid session is rejected with 403 and never publishes", async () => {
    const { POST } = await import("../../app/api/admin/trips/[slug]/publish/route");
    const request = new Request("http://localhost/api/admin/trips/kassandra-2026/publish", {
      method: "POST",
      headers: { cookie: cookieHeader(CREATOR_TOKEN) },
    });

    const response = await POST(request, { params: { slug: "kassandra-2026" } });
    expect(response.status).toBe(403);
    expect(publishHandler).not.toHaveBeenCalled();
  });

  it("for a slug that doesn't exist returns 404 and never calls publish_trip", async () => {
    const { POST } = await import("../../app/api/admin/trips/[slug]/publish/route");
    const request = new Request("http://localhost/api/admin/trips/does-not-exist/publish", {
      method: "POST",
      headers: { cookie: cookieHeader(ADMIN_TOKEN) },
    });

    const response = await POST(request, { params: { slug: "does-not-exist" } });
    expect(response.status).toBe(404);
    expect(publishHandler).not.toHaveBeenCalled();
  });

  it("with a real admin session calls publish_trip for the resolved trip id and returns its result", async () => {
    const { POST } = await import("../../app/api/admin/trips/[slug]/publish/route");
    const request = new Request("http://localhost/api/admin/trips/kassandra-2026/publish", {
      method: "POST",
      headers: { cookie: cookieHeader(ADMIN_TOKEN) },
    });

    const response = await POST(request, { params: { slug: "kassandra-2026" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(publishHandler).toHaveBeenCalledTimes(1);
    expect(publishHandler.mock.calls[0][0]).toEqual({ p_trip_id: trip.id });
    expect(body.status).toBe("published");
    expect(body.errorCount).toBe(0);
    expect(body.warningCount).toBe(1);
  });
});
