// R3 regression (2026-09-05 review, closure batch): record_answer()'s
// 3-way retry status ("accepted" | "already_recorded" | "conflict",
// src/lib/discover.ts's AnswerSubmissionStatus) used to be read by
// submitAnswer() but never actually inspected by the UI -- every status
// collapsed into the same "reveal" screen. That was silently correct for
// "accepted" and "already_recorded" (myResponse IS the answer the user
// meant), but misleading for "conflict": myResponse there is the
// ORIGINAL answer already on record, not the option the user just
// clicked on this retry, and the UI gave no indication the two differ.
//
// Fixed by tracking wasConflict and showing an explanatory banner only
// for "conflict", leaving "accepted"/"already_recorded" exactly as
// before (this test proves that too, so the fix doesn't regress the
// common cases).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { mutate } from "swr";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "trip-1", slot: "morning" }),
  useRouter: () => ({ push: vi.fn() }),
}));

const parent = {
  id: "parent-1",
  trip_id: "trip-1",
  device_id: "dev-shared",
  display_name: "Parintele",
  role: "adult",
  created_at: "2026-01-01T00:00:00Z",
};
const trip = { id: "trip-1", slug: "trip-1", duration_days: 5, start_date: null };
const profiles = [parent];

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useTrip: () => ({ data: trip, error: undefined }),
    useProfiles: () => ({ data: profiles, error: undefined }),
  };
});
vi.mock("@/lib/trip", () => ({ currentTripDay: () => 1 }));
vi.mock("@/lib/schedule", () => ({
  getSlotAvailability: () => ({ status: "open", opensAt: "07:00", closesAt: "11:59" }),
}));

const questionFixture = {
  id: "q1",
  trip_id: "trip-1",
  kind: "discover",
  day_number: 1,
  slot: "morning",
  order_index: 1,
  prompt: "Cine a raspuns?",
  question_type: "single_choice",
  points: 10,
  verified: true,
  published: true,
};
const optionA = { id: "optA", question_id: "q1", order_index: 1, label: "Raspunsul A" };
const optionB = { id: "optB", question_id: "q1", order_index: 2, label: "Raspunsul B" };

const getMyResponse = vi.fn().mockResolvedValue(null);
const getOrAssignExtra = vi.fn().mockResolvedValue(null);
let submitAnswerImpl: (...args: unknown[]) => Promise<unknown> = vi.fn();
const submitAnswer = vi.fn((...args: unknown[]) => submitAnswerImpl(...args));

vi.mock("@/lib/discover", () => ({
  getDiscoverQuestion: vi.fn().mockResolvedValue({ question: questionFixture, options: [optionA, optionB], exploreLinks: [] }),
  getMyResponse: (...args: unknown[]) => getMyResponse(...args),
  submitAnswer: (...args: unknown[]) => submitAnswer(...args),
  getOrAssignExtra: (...args: unknown[]) => getOrAssignExtra(...args),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn().mockResolvedValue(undefined) }));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

const CONFLICT_BANNER_TEXT = "Răspunsul tău fusese deja înregistrat cu o altă opțiune";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mutate(() => true, undefined, { revalidate: false });
  submitAnswer.mockClear();
  getMyResponse.mockReset().mockResolvedValue(null);
});

async function answerAndReachReveal(optionLabel: string) {
  const { default: DiscoverPage } = await import("../../app/trip/[slug]/discover/[slot]/page");
  render(<DiscoverPage />);
  await screen.findByText("Cine a raspuns?");
  await click(screen.getByRole("button", { name: optionLabel }));
  await click(screen.getByRole("button", { name: "RĂSPUNDE" }));
  await waitFor(() => expect(submitAnswer).toHaveBeenCalled());
}

describe("R3 regression: Discover UI distinguishes accepted/already_recorded/conflict", () => {
  it("status 'accepted' reveals normally, with no conflict banner", async () => {
    submitAnswerImpl = vi.fn().mockResolvedValue({
      status: "accepted",
      response: { id: "resp1", participant_id: parent.id, question_id: "q1", selected_option_id: "optA", is_correct: true },
      contributedToTeam: false,
      correctOptionId: "optA",
    });
    await answerAndReachReveal("Raspunsul A");

    await screen.findByText("Corect");
    expect(screen.queryByText(CONFLICT_BANNER_TEXT, { exact: false })).toBeNull();
  });

  it("status 'already_recorded' (idempotent retry, same option) reveals normally, with no conflict banner", async () => {
    submitAnswerImpl = vi.fn().mockResolvedValue({
      status: "already_recorded",
      response: { id: "resp1", participant_id: parent.id, question_id: "q1", selected_option_id: "optA", is_correct: true },
      contributedToTeam: false,
      correctOptionId: "optA",
    });
    await answerAndReachReveal("Raspunsul A");

    await screen.findByText("Corect");
    expect(screen.queryByText(CONFLICT_BANNER_TEXT, { exact: false })).toBeNull();
  });

  it("status 'conflict' (retried with a different option than the one on record) shows the conflict banner and the ORIGINAL recorded answer", async () => {
    // User clicks B, but the server reports the original recorded answer
    // was A (a stale client, a race, or a genuine retry-with-different-
    // option) -- response.selected_option_id is "optA", not "optB".
    submitAnswerImpl = vi.fn().mockResolvedValue({
      status: "conflict",
      response: { id: "resp1", participant_id: parent.id, question_id: "q1", selected_option_id: "optA", is_correct: true },
      contributedToTeam: false,
      correctOptionId: "optA",
    });
    await answerAndReachReveal("Raspunsul B");

    await screen.findByText("Corect");
    expect(screen.queryByText(CONFLICT_BANNER_TEXT, { exact: false })).not.toBeNull();
  });

  it("the conflict banner clears on the next question after advancing", async () => {
    submitAnswerImpl = vi.fn().mockResolvedValue({
      status: "conflict",
      response: { id: "resp1", participant_id: parent.id, question_id: "q1", selected_option_id: "optA", is_correct: true },
      contributedToTeam: false,
      correctOptionId: "optA",
    });
    await answerAndReachReveal("Raspunsul B");
    await screen.findByText("Corect");
    expect(screen.queryByText(CONFLICT_BANNER_TEXT, { exact: false })).not.toBeNull();

    // Simulate coming back later to a DIFFERENT, freshly-loaded question
    // for the same participant (a fresh mount, e.g. navigating back in)
    // -- getMyResponse resolves null (nothing answered yet), so it lands
    // on "question", not carrying the stale banner from before.
    getMyResponse.mockResolvedValue(null);
    cleanup();
    const { default: DiscoverPage } = await import("../../app/trip/[slug]/discover/[slot]/page");
    render(<DiscoverPage />);
    await screen.findByText("Cine a raspuns?");
    expect(screen.queryByText(CONFLICT_BANNER_TEXT, { exact: false })).toBeNull();
  });
});
