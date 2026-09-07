// Trip editorial brief: /api/trips/[slug]/brief is gated by "the trip's
// own authorized creator, or an admin" (src/lib/security/
// tripAuthorAccess.ts's requireTripCreatorOrAdmin) -- broader than R7's
// admin-only routes, since an ordinary (non-admin) creator account may
// edit its OWN trip's brief but never another account's. These tests run
// the real route handlers against a fake admin client (helpers/
// fakeSupabaseAdmin.ts, extended with a minimal trip_editorial_briefs
// select + reusing its existing .rpc() support for this batch) -- not
// permission mocks standing in for the routes. save_trip_editorial_
// brief()'s own behavior (constraints, atomicity, the publish race) is
// covered separately by supabase/tests/trip_editorial_brief.test.sql
// against a real Postgres instance.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createFakeAdminClient,
  type FakeAccountRow,
  type FakeTripRow,
  type FakeRpcHandlers,
  type FakeBriefRow,
} from "./helpers/fakeSupabaseAdmin";
import { ACCESS_COOKIE_NAME } from "@/lib/security/session";

const ADMIN_AUTH_UID = "auth-admin-0000-0000-000000000000";
const OWNER_AUTH_UID = "auth-owner-0000-0000-000000000000";
const OTHER_AUTH_UID = "auth-other-0000-0000-000000000000";
const ADMIN_TOKEN = "valid-token-for-admin";
const OWNER_TOKEN = "valid-token-for-owner";
const OTHER_TOKEN = "valid-token-for-other";

const adminAccount: FakeAccountRow = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  phone_number: "0700000001",
  pin_hash: null,
  auth_user_id: ADMIN_AUTH_UID,
  is_admin: true,
  display_name: "Admin",
};
// Owns trip-a -- the creator this batch's rules are meant to let edit
// its own trip's brief.
const ownerAccount: FakeAccountRow = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  phone_number: "0700000002",
  pin_hash: null,
  auth_user_id: OWNER_AUTH_UID,
  is_admin: false,
  display_name: "Owner",
};
// Owns a DIFFERENT trip (trip-b) -- not admin, not trip-a's creator --
// covers both "a non-admin, non-creator account" and "creator from a
// different account" in one fixture, exactly like R7's own precedent.
const otherAccount: FakeAccountRow = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  phone_number: "0700000003",
  pin_hash: null,
  auth_user_id: OTHER_AUTH_UID,
  is_admin: false,
  display_name: "Other",
};

const tripA: FakeTripRow = {
  id: "trip-a-1111-1111-1111-111111111111",
  slug: "trip-a",
  content_status: "pending",
  created_by_account_id: ownerAccount.id,
};
const tripB: FakeTripRow = {
  id: "trip-b-2222-2222-2222-222222222222",
  slug: "trip-b",
  content_status: "pending",
  created_by_account_id: otherAccount.id,
};
const tripReady: FakeTripRow = {
  id: "trip-ready-333-3333-3333-333333333333",
  slug: "trip-ready",
  content_status: "ready",
  created_by_account_id: ownerAccount.id,
};

let rows: FakeAccountRow[];
let trips: FakeTripRow[];
let briefs: FakeBriefRow[];
let rpcHandlers: FakeRpcHandlers;

interface FakeSaveBriefResult {
  data: {
    status: string;
    brief: {
      trip_id: unknown;
      difficulty: unknown;
      style: unknown;
      narrator_character_name: unknown;
      theme_history: unknown;
      theme_places: unknown;
      theme_food: unknown;
      theme_curiosities: unknown;
      created_at: string;
      updated_at: string;
    } | null;
  } | null;
  error: { message: string } | null;
}

const saveHandler = vi.fn(
  (params: Record<string, unknown>): FakeSaveBriefResult => ({
    data: {
      status: "saved",
      brief: {
        trip_id: params.p_trip_id,
        difficulty: params.p_difficulty,
        style: params.p_style,
        narrator_character_name: params.p_narrator_character_name,
        theme_history: params.p_theme_history,
        theme_places: params.p_theme_places,
        theme_food: params.p_theme_food,
        theme_curiosities: params.p_theme_curiosities,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    },
    error: null,
  }),
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeAdminClient(
      rows,
      { validTokens: { [ADMIN_TOKEN]: ADMIN_AUTH_UID, [OWNER_TOKEN]: OWNER_AUTH_UID, [OTHER_TOKEN]: OTHER_AUTH_UID } },
      trips,
      [],
      rpcHandlers,
      briefs,
    ),
}));

beforeEach(() => {
  rows = [{ ...adminAccount }, { ...ownerAccount }, { ...otherAccount }];
  trips = [{ ...tripA }, { ...tripB }, { ...tripReady }];
  briefs = [];
  saveHandler.mockClear();
  rpcHandlers = { save_trip_editorial_brief: saveHandler };
});

function cookieHeader(token: string): string {
  return `${ACCESS_COOKIE_NAME}=${token}`;
}

const validBody = {
  difficulty: "medium",
  style: "fun",
  narratorCharacterName: "",
  themeHistory: 25,
  themePlaces: 25,
  themeFood: 25,
  themeCuriosities: 25,
};

describe("GET /api/trips/[slug]/brief", () => {
  it("with no session cookie is rejected", async () => {
    const { GET } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-a/brief");

    const response = await GET(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(401);
  });

  it("with a forged/unrecognized token is rejected", async () => {
    const { GET } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-a/brief", {
      headers: { cookie: cookieHeader("never-issued") },
    });

    const response = await GET(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(401);
  });

  it("the trip's own creator can read its brief (null when none saved yet)", async () => {
    const { GET } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-a/brief", {
      headers: { cookie: cookieHeader(OWNER_TOKEN) },
    });

    const response = await GET(request, { params: { slug: "trip-a" } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.brief).toBeNull();
    expect(body.readOnly).toBe(false);
  });

  it("a different creator (owns trip-b, not trip-a) is rejected with 403", async () => {
    const { GET } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-a/brief", {
      headers: { cookie: cookieHeader(OTHER_TOKEN) },
    });

    const response = await GET(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(403);
  });

  it("an admin can read any trip's brief, even one it didn't create", async () => {
    const { GET } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-a/brief", {
      headers: { cookie: cookieHeader(ADMIN_TOKEN) },
    });

    const response = await GET(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(200);
  });

  it("a published trip reports readOnly: true", async () => {
    const { GET } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-ready/brief", {
      headers: { cookie: cookieHeader(OWNER_TOKEN) },
    });

    const response = await GET(request, { params: { slug: "trip-ready" } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.readOnly).toBe(true);
  });

  it("a slug that doesn't exist returns 404", async () => {
    const { GET } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/does-not-exist/brief", {
      headers: { cookie: cookieHeader(ADMIN_TOKEN) },
    });

    const response = await GET(request, { params: { slug: "does-not-exist" } });
    expect(response.status).toBe(404);
  });
});

describe("PUT /api/trips/[slug]/brief", () => {
  it("with no session cookie is rejected and never calls the RPC", async () => {
    const { PUT } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-a/brief", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });

    const response = await PUT(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(401);
    expect(saveHandler).not.toHaveBeenCalled();
  });

  it("the trip's own creator can save a valid brief, passing only the 7 validated fields to the RPC", async () => {
    const { PUT } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-a/brief", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      // Extra, unrecognized fields (e.g. an attempt to smuggle a
      // different content_status or trip_id) must never reach the RPC.
      body: JSON.stringify({ ...validBody, contentStatus: "ready", tripId: "some-other-trip", isAdmin: true }),
    });

    const response = await PUT(request, { params: { slug: "trip-a" } });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("saved");
    expect(saveHandler).toHaveBeenCalledTimes(1);
    expect(saveHandler.mock.calls[0][0]).toEqual({
      p_trip_id: tripA.id,
      p_difficulty: "medium",
      p_style: "fun",
      p_narrator_character_name: null,
      p_theme_history: 25,
      p_theme_places: 25,
      p_theme_food: 25,
      p_theme_curiosities: 25,
    });
  });

  it("a different creator (owns trip-b, not trip-a) is rejected with 403 and never calls the RPC", async () => {
    const { PUT } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-a/brief", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieHeader(OTHER_TOKEN) },
      body: JSON.stringify(validBody),
    });

    const response = await PUT(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(403);
    expect(saveHandler).not.toHaveBeenCalled();
  });

  it("an admin can save a brief for a trip it didn't create", async () => {
    const { PUT } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-b/brief", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieHeader(ADMIN_TOKEN) },
      body: JSON.stringify(validBody),
    });

    const response = await PUT(request, { params: { slug: "trip-b" } });
    expect(response.status).toBe(200);
    expect(saveHandler).toHaveBeenCalledTimes(1);
  });

  it("an invalid body (percentages not summing to 100) is rejected with field errors and never calls the RPC", async () => {
    const { PUT } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-a/brief", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ ...validBody, themeHistory: 10, themePlaces: 10, themeFood: 10, themeCuriosities: 10 }),
    });

    const response = await PUT(request, { params: { slug: "trip-a" } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.fieldErrors.themeTotal).toBeTruthy();
    expect(saveHandler).not.toHaveBeenCalled();
  });

  it("narrated_by_character with no character name is rejected before the RPC is ever called", async () => {
    const { PUT } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-a/brief", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ ...validBody, style: "narrated_by_character", narratorCharacterName: "" }),
    });

    const response = await PUT(request, { params: { slug: "trip-a" } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.fieldErrors.narratorCharacterName).toBeTruthy();
    expect(saveHandler).not.toHaveBeenCalled();
  });

  it("a save attempt on an already-published trip is rejected with 409, even though the caller is its own creator", async () => {
    saveHandler.mockReturnValueOnce({ data: { status: "rejected_published", brief: null }, error: null });
    const { PUT } = await import("../../app/api/trips/[slug]/brief/route");
    const request = new Request("http://localhost/api/trips/trip-ready/brief", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify(validBody),
    });

    const response = await PUT(request, { params: { slug: "trip-ready" } });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.status).toBe("rejected_published");
    expect(saveHandler).toHaveBeenCalledTimes(1);
  });
});
