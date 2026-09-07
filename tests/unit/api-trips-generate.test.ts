// R9: /api/trips/[slug]/generate and its drafts/[draftId]/{accept,
// reject,regenerate} sub-routes -- gated by the exact same "trip's own
// creator, or an admin" check as the brief routes (src/lib/security/
// tripAuthorAccess.ts), covering creator/admin/other-creator/participant
// (no session) authorization, request validation, and the RPC status ->
// HTTP status mapping. src/lib/ai/generationService.ts (the provider
// call + validation + draft-persisting orchestration) is mocked here --
// it's covered end-to-end by the SQL regression suite (supabase/tests/
// trip_question_generation.test.sql), the provider tests, and the pure
// planning-function tests instead; these tests exist to prove what the
// ROUTE itself checks before/after calling it.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createFakeAdminClient,
  type FakeAccountRow,
  type FakeTripRow,
  type FakeRpcHandlers,
  type FakeBriefRow,
  type FakeGeneratedDraftRow,
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
const ownerAccount: FakeAccountRow = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  phone_number: "0700000002",
  pin_hash: null,
  auth_user_id: OWNER_AUTH_UID,
  is_admin: false,
  display_name: "Owner",
};
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

let rows: FakeAccountRow[];
let trips: FakeTripRow[];
let briefs: FakeBriefRow[];
let drafts: FakeGeneratedDraftRow[];
let rpcHandlers: FakeRpcHandlers;

interface FakeRun {
  id: string;
  trip_id: unknown;
  requested_by_account_id: unknown;
  brief_version: string;
  requested_count: unknown;
  status: string;
  error_message: string | null;
  draft_count: number;
  rejected_count: number;
  started_at: string;
  finished_at: string | null;
}
interface FakeStartResult {
  data: { status: string; run: FakeRun | null } | null;
  error: { message: string } | null;
}
interface FakeAcceptResult {
  data: { status: string; draft: { id: unknown; status: string } | null; question_id: string | null } | null;
  error: { message: string } | null;
}
interface FakeRejectResult {
  data: { id: unknown; status: string } | null;
  error: { message: string } | null;
}

const startHandler = vi.fn(
  (params: Record<string, unknown>): FakeStartResult => ({
    data: {
      status: "started",
      run: {
        id: "run-1",
        trip_id: params.p_trip_id,
        requested_by_account_id: params.p_account_id,
        brief_version: "2026-01-01T00:00:00Z",
        requested_count: params.p_requested_count,
        status: "generating",
        error_message: null,
        draft_count: 0,
        rejected_count: 0,
        started_at: "2026-01-01T00:00:00Z",
        finished_at: null,
      },
    },
    error: null,
  }),
);
const acceptHandler = vi.fn(
  (params: Record<string, unknown>): FakeAcceptResult => ({
    data: {
      status: "accepted",
      draft: { id: params.p_draft_id, status: "accepted" },
      question_id: "question-1",
    },
    error: null,
  }),
);
const rejectHandler = vi.fn(
  (params: Record<string, unknown>): FakeRejectResult => ({
    data: { id: params.p_draft_id, status: "rejected" },
    error: null,
  }),
);

const runGeneration = vi.fn().mockResolvedValue({ status: "succeeded", draftCount: 3, rejectedCount: 0 });
const runSingleSlotRegeneration = vi.fn().mockResolvedValue({ status: "succeeded", draftCount: 1, rejectedCount: 0 });

vi.mock("@/lib/ai/generationService", () => ({
  runGeneration: (...args: unknown[]) => runGeneration(...args),
  runSingleSlotRegeneration: (...args: unknown[]) => runSingleSlotRegeneration(...args),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () =>
    createFakeAdminClient(
      rows,
      { validTokens: { [ADMIN_TOKEN]: ADMIN_AUTH_UID, [OWNER_TOKEN]: OWNER_AUTH_UID, [OTHER_TOKEN]: OTHER_AUTH_UID } },
      trips,
      [],
      rpcHandlers,
      briefs,
      [],
      drafts,
    ),
}));

beforeEach(() => {
  rows = [{ ...adminAccount }, { ...ownerAccount }, { ...otherAccount }];
  trips = [{ ...tripA }, { ...tripB }];
  briefs = [{ trip_id: tripA.id, difficulty: "medium", style: "fun", narrator_character_name: null, theme_history: 25, theme_places: 25, theme_food: 25, theme_curiosities: 25 }];
  drafts = [];
  startHandler.mockClear();
  acceptHandler.mockClear();
  rejectHandler.mockClear();
  runGeneration.mockClear().mockResolvedValue({ status: "succeeded", draftCount: 3, rejectedCount: 0 });
  runSingleSlotRegeneration.mockClear().mockResolvedValue({ status: "succeeded", draftCount: 1, rejectedCount: 0 });
  rpcHandlers = {
    start_trip_question_generation: startHandler,
    accept_generated_question_draft: acceptHandler,
    reject_generated_question_draft: rejectHandler,
  };
});

function cookieHeader(token: string): string {
  return `${ACCESS_COOKIE_NAME}=${token}`;
}

describe("POST /api/trips/[slug]/generate -- authorization", () => {
  it("with no session (a participant device never has one) is rejected", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ count: 3 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(401);
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("a different creator (owns trip-b, not trip-a) is rejected with 403", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OTHER_TOKEN) },
      body: JSON.stringify({ count: 3 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(403);
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("the trip's own creator can start generation", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ count: 3 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(200);
    expect(startHandler).toHaveBeenCalledWith(expect.objectContaining({ p_trip_id: tripA.id, p_account_id: ownerAccount.id, p_requested_count: 3 }));
    expect(runGeneration).toHaveBeenCalledWith(tripA.id, "run-1", 3);
  });

  it("an admin can start generation on a trip it didn't create", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(ADMIN_TOKEN) },
      body: JSON.stringify({ count: 3 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(200);
  });
});

describe("POST /api/trips/[slug]/generate -- request validation and RPC status mapping", () => {
  it("rejects a count of 0", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ count: 0 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(400);
    expect(startHandler).not.toHaveBeenCalled();
  });

  it("rejects a count above the maximum", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ count: 11 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(400);
    expect(startHandler).not.toHaveBeenCalled();
  });

  it("a concurrent request (already_running) returns 200 with the existing run, never starting a duplicate job", async () => {
    startHandler.mockReturnValueOnce({
      data: {
        status: "already_running",
        run: {
          id: "existing-run",
          trip_id: tripA.id,
          requested_by_account_id: ownerAccount.id,
          brief_version: "2026-01-01T00:00:00Z",
          requested_count: 3,
          status: "generating",
          error_message: null,
          draft_count: 0,
          rejected_count: 0,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: null,
        },
      },
      error: null,
    });
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ count: 3 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(200);
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("no_brief is reported as 409, without calling runGeneration", async () => {
    startHandler.mockReturnValueOnce({ data: { status: "no_brief", run: null }, error: null });
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ count: 3 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(409);
    expect(runGeneration).not.toHaveBeenCalled();
  });

  it("already_published is reported as 409", async () => {
    startHandler.mockReturnValueOnce({ data: { status: "already_published", run: null }, error: null });
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ count: 3 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(409);
  });

  it("rate_limited is reported as 409", async () => {
    startHandler.mockReturnValueOnce({ data: { status: "rate_limited", run: null }, error: null });
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ count: 3 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(409);
  });

  it("a failed generation outcome is still a 200 (a real, reported failure -- not a route error)", async () => {
    runGeneration.mockResolvedValueOnce({ status: "failed", reason: "Furnizorul AI a returnat o eroare." });
    const { POST } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ count: 3 }),
    });
    const response = await POST(request, { params: { slug: "trip-a" } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status).toBe("failed");
  });
});

describe("GET /api/trips/[slug]/generate", () => {
  it("returns contentStatus, brief, drafts, and lastRun", async () => {
    drafts = [
      {
        id: "draft-1",
        trip_id: tripA.id,
        generation_run_id: "run-1",
        brief_version: "2026-01-01T00:00:00Z",
        day_number: 1,
        slot: "morning",
        theme_category: "history",
        difficulty: "medium",
        prompt: "Q?",
        explanation: "E.",
        options: [{ label: "A", is_correct: true }, { label: "B", is_correct: false }],
        status: "pending_review",
        edited: false,
        resulting_question_id: null,
        accepted_by_account_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const { GET } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate", { headers: { cookie: cookieHeader(OWNER_TOKEN) } });
    const response = await GET(request, { params: { slug: "trip-a" } });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.contentStatus).toBe("pending");
    expect(body.brief.difficulty).toBe("medium");
    expect(body.drafts).toHaveLength(1);
  });

  it("a participant (no session) is rejected", async () => {
    const { GET } = await import("../../app/api/trips/[slug]/generate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate");
    const response = await GET(request, { params: { slug: "trip-a" } });
    expect(response.status).toBe(401);
  });
});

describe("POST /api/trips/[slug]/generate/drafts/[draftId]/accept", () => {
  beforeEach(() => {
    drafts = [
      {
        id: "draft-1",
        trip_id: tripA.id,
        generation_run_id: "run-1",
        brief_version: "2026-01-01T00:00:00Z",
        day_number: 1,
        slot: "morning",
        theme_category: "history",
        difficulty: "medium",
        prompt: "Original prompt?",
        explanation: "Original explanation.",
        options: [{ label: "A", is_correct: true }, { label: "B", is_correct: false }],
        status: "pending_review",
        edited: false,
        resulting_question_id: null,
        accepted_by_account_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
  });

  it("a plain accept (empty body) uses the draft's own stored values, with edited=false", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/accept/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate/drafts/draft-1/accept", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: { slug: "trip-a", draftId: "draft-1" } });
    expect(response.status).toBe(200);
    expect(acceptHandler).toHaveBeenCalledWith(
      expect.objectContaining({ p_prompt: "Original prompt?", p_explanation: "Original explanation.", p_edited: false }),
    );
  });

  it("an accept with a changed prompt is sent with edited=true", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/accept/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate/drafts/draft-1/accept", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ prompt: "Edited prompt?" }),
    });
    const response = await POST(request, { params: { slug: "trip-a", draftId: "draft-1" } });
    expect(response.status).toBe(200);
    expect(acceptHandler).toHaveBeenCalledWith(expect.objectContaining({ p_prompt: "Edited prompt?", p_edited: true }));
  });

  it("invalid content (duplicate option labels) is rejected before calling the RPC", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/accept/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate/drafts/draft-1/accept", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({ options: [{ label: "A", is_correct: true }, { label: "A", is_correct: false }] }),
    });
    const response = await POST(request, { params: { slug: "trip-a", draftId: "draft-1" } });
    expect(response.status).toBe(400);
    expect(acceptHandler).not.toHaveBeenCalled();
  });

  it("a draft belonging to a different trip is not found", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/accept/route");
    const request = new Request("http://localhost/api/trips/trip-b/generate/drafts/draft-1/accept", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OTHER_TOKEN) },
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: { slug: "trip-b", draftId: "draft-1" } });
    expect(response.status).toBe(404);
  });

  it("a participant (no session) is rejected", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/accept/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate/drafts/draft-1/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: { slug: "trip-a", draftId: "draft-1" } });
    expect(response.status).toBe(401);
    expect(acceptHandler).not.toHaveBeenCalled();
  });

  it("a rejected RPC status (stale_brief) is reported as 409", async () => {
    acceptHandler.mockReturnValueOnce({ data: { status: "stale_brief", draft: null, question_id: null }, error: null });
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/accept/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate/drafts/draft-1/accept", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader(OWNER_TOKEN) },
      body: JSON.stringify({}),
    });
    const response = await POST(request, { params: { slug: "trip-a", draftId: "draft-1" } });
    expect(response.status).toBe(409);
  });
});

describe("POST /api/trips/[slug]/generate/drafts/[draftId]/reject", () => {
  beforeEach(() => {
    drafts = [
      {
        id: "draft-1",
        trip_id: tripA.id,
        generation_run_id: "run-1",
        brief_version: "2026-01-01T00:00:00Z",
        day_number: 1,
        slot: "morning",
        theme_category: "history",
        difficulty: "medium",
        prompt: "Q?",
        explanation: "E.",
        options: [{ label: "A", is_correct: true }, { label: "B", is_correct: false }],
        status: "pending_review",
        edited: false,
        resulting_question_id: null,
        accepted_by_account_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
  });

  it("the trip's own creator can reject a draft", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/reject/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate/drafts/draft-1/reject", {
      method: "POST",
      headers: { cookie: cookieHeader(OWNER_TOKEN) },
    });
    const response = await POST(request, { params: { slug: "trip-a", draftId: "draft-1" } });
    expect(response.status).toBe(200);
    expect(rejectHandler).toHaveBeenCalledWith({ p_draft_id: "draft-1" });
  });

  it("a different creator is rejected with 403", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/reject/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate/drafts/draft-1/reject", {
      method: "POST",
      headers: { cookie: cookieHeader(OTHER_TOKEN) },
    });
    const response = await POST(request, { params: { slug: "trip-a", draftId: "draft-1" } });
    expect(response.status).toBe(403);
    expect(rejectHandler).not.toHaveBeenCalled();
  });
});

describe("POST /api/trips/[slug]/generate/drafts/[draftId]/regenerate", () => {
  beforeEach(() => {
    drafts = [
      {
        id: "draft-1",
        trip_id: tripA.id,
        generation_run_id: "run-1",
        brief_version: "2026-01-01T00:00:00Z",
        day_number: 1,
        slot: "morning",
        theme_category: "history",
        difficulty: "medium",
        prompt: "Q?",
        explanation: "E.",
        options: [{ label: "A", is_correct: true }, { label: "B", is_correct: false }],
        status: "pending_review",
        edited: false,
        resulting_question_id: null,
        accepted_by_account_id: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
  });

  it("rejects the old draft and starts a fresh single-slot generation, preserving other drafts implicitly (only this draft is touched)", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/regenerate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate/drafts/draft-1/regenerate", {
      method: "POST",
      headers: { cookie: cookieHeader(OWNER_TOKEN) },
    });
    const response = await POST(request, { params: { slug: "trip-a", draftId: "draft-1" } });
    expect(response.status).toBe(200);
    expect(rejectHandler).toHaveBeenCalledWith({ p_draft_id: "draft-1" });
    expect(startHandler).toHaveBeenCalledWith(expect.objectContaining({ p_trip_id: tripA.id, p_requested_count: 1 }));
    expect(runSingleSlotRegeneration).toHaveBeenCalledWith(
      tripA.id,
      "run-1",
      expect.objectContaining({ dayNumber: 1, slot: "morning", themeCategory: "history", difficulty: "medium" }),
    );
  });

  it("an already-processed draft cannot be regenerated again", async () => {
    drafts[0].status = "accepted";
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/regenerate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate/drafts/draft-1/regenerate", {
      method: "POST",
      headers: { cookie: cookieHeader(OWNER_TOKEN) },
    });
    const response = await POST(request, { params: { slug: "trip-a", draftId: "draft-1" } });
    expect(response.status).toBe(409);
    expect(rejectHandler).not.toHaveBeenCalled();
  });

  it("a different creator is rejected with 403", async () => {
    const { POST } = await import("../../app/api/trips/[slug]/generate/drafts/[draftId]/regenerate/route");
    const request = new Request("http://localhost/api/trips/trip-a/generate/drafts/draft-1/regenerate", {
      method: "POST",
      headers: { cookie: cookieHeader(OTHER_TOKEN) },
    });
    const response = await POST(request, { params: { slug: "trip-a", draftId: "draft-1" } });
    expect(response.status).toBe(403);
    expect(rejectHandler).not.toHaveBeenCalled();
  });
});
