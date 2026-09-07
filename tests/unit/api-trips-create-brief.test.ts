// Trip editorial brief: POST /api/trips/create now also validates and
// saves the initial difficulty/theme distribution/style brief, via the
// exact same validateEditorialBrief (src/lib/editorialBrief.ts) and
// save_trip_editorial_brief RPC the edit route uses. Runs the REAL route
// handler against the fake admin client (tests/unit/helpers/
// fakeSupabaseAdmin.ts), same approach as
// api-trips-create-timezone-validation.test.ts.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createFakeAdminClient, type FakeTripRow, type FakeRpcHandlers } from "./helpers/fakeSupabaseAdmin";

const AUTH_UID = "auth-creator-brief-0000-000000000000";
const TOKEN = "valid-brief-token";

let trips: FakeTripRow[];
let rpcHandlers: FakeRpcHandlers;
interface FakeSaveBriefResult {
  data: { status: string; brief: { trip_id: unknown } } | null;
  error: { message: string } | null;
}

const saveHandler = vi.fn(
  (params: Record<string, unknown>): FakeSaveBriefResult => ({
    data: { status: "saved", brief: { trip_id: params.p_trip_id } },
    error: null,
  }),
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeAdminClient([], { validTokens: { [TOKEN]: AUTH_UID } }, trips, [], rpcHandlers),
}));

beforeEach(() => {
  trips = [];
  saveHandler.mockClear();
  rpcHandlers = { save_trip_editorial_brief: saveHandler };
});

function createRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/trips/create", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  destination: "Corfu",
  startDate: "2027-06-01",
  timezone: "Europe/Athens",
  durationDays: 5,
  deviceId: "device-brief-1",
  website: "",
};

describe("POST /api/trips/create validates the editorial brief server-side", () => {
  it("rejects percentages that don't sum to 100 -- never creates a trip", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(
      createRequest({
        ...baseBody,
        requestId: "req-brief-total",
        difficulty: "medium",
        style: "fun",
        narratorCharacterName: "",
        themeHistory: 10,
        themePlaces: 10,
        themeFood: 10,
        themeCuriosities: 10,
      }),
    );

    expect(response.status).toBe(400);
    expect(trips).toHaveLength(0);
    expect(saveHandler).not.toHaveBeenCalled();
  });

  it("rejects an unknown difficulty value", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(
      createRequest({
        ...baseBody,
        requestId: "req-brief-difficulty",
        difficulty: "extreme",
        style: "fun",
        narratorCharacterName: "",
        themeHistory: 25,
        themePlaces: 25,
        themeFood: 25,
        themeCuriosities: 25,
      }),
    );

    expect(response.status).toBe(400);
    expect(trips).toHaveLength(0);
  });

  it("rejects narrated_by_character with no character name", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(
      createRequest({
        ...baseBody,
        requestId: "req-brief-narrator",
        difficulty: "medium",
        style: "narrated_by_character",
        narratorCharacterName: "",
        themeHistory: 25,
        themePlaces: 25,
        themeFood: 25,
        themeCuriosities: 25,
      }),
    );

    expect(response.status).toBe(400);
    expect(trips).toHaveLength(0);
  });

  it("a valid brief creates the trip AND saves the brief via the same RPC the edit route uses", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(
      createRequest({
        ...baseBody,
        requestId: "req-brief-valid",
        difficulty: "hard",
        style: "narrated_by_character",
        narratorCharacterName: "  Ștefan   cel  Mare ",
        themeHistory: 40,
        themePlaces: 20,
        themeFood: 20,
        themeCuriosities: 20,
      }),
    );

    expect(response.status).toBe(200);
    expect(trips).toHaveLength(1);
    expect(saveHandler).toHaveBeenCalledTimes(1);
    const call = saveHandler.mock.calls[0][0];
    expect(call.p_trip_id).toBe(trips[0].id);
    expect(call.p_difficulty).toBe("hard");
    expect(call.p_style).toBe("narrated_by_character");
    // Normalized (collapsed whitespace, trimmed) before it ever reaches the RPC.
    expect(call.p_narrator_character_name).toBe("Ștefan cel Mare");
    expect(call.p_theme_history).toBe(40);
    expect(call.p_theme_places).toBe(20);
    expect(call.p_theme_food).toBe(20);
    expect(call.p_theme_curiosities).toBe(20);
  });

  it("the default proposal (medium/fun/equal split) from the creation form is accepted as-is", async () => {
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(
      createRequest({
        ...baseBody,
        requestId: "req-brief-defaults",
        difficulty: "medium",
        style: "fun",
        narratorCharacterName: "",
        themeHistory: 25,
        themePlaces: 25,
        themeFood: 25,
        themeCuriosities: 25,
      }),
    );

    expect(response.status).toBe(200);
    expect(saveHandler).toHaveBeenCalledTimes(1);
    expect(saveHandler.mock.calls[0][0].p_narrator_character_name).toBeNull();
  });

  it("a brief-save failure (RPC error) never fails the trip creation itself", async () => {
    saveHandler.mockReturnValueOnce({ data: null, error: { message: "db down" } });
    const { POST } = await import("../../app/api/trips/create/route");
    const response = await POST(
      createRequest({
        ...baseBody,
        requestId: "req-brief-save-fails",
        difficulty: "medium",
        style: "fun",
        narratorCharacterName: "",
        themeHistory: 25,
        themePlaces: 25,
        themeFood: 25,
        themeCuriosities: 25,
      }),
    );

    expect(response.status).toBe(200);
    expect(trips).toHaveLength(1);
  });
});
