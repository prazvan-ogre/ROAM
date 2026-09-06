// Regression tests for the two R2 defects confirmed during the 2026-09-05
// review's independent-reviewer pass (closure batch): switching the
// device's active profile (top-right ProfileMenu) while a Discover
// question is open used to (a) leave a not-yet-submitted selection
// visually applied to the newly active profile, and could then submit it
// under that profile's identity, and (b) let a request already in flight
// for the PREVIOUS profile paint its result onto whichever profile's
// screen happens to be showing once it resolves.
//
// Both are fixed in app/trip/[slug]/discover/[slot]/page.tsx:
//   (a) the data-loading effect now resets selectedOption/submitError/
//       myResponse/extra every time activeProfile changes, not just at
//       first mount;
//   (b) handleSubmitAnswer captures the submitting profile's id up front
//       and re-checks it (via activeProfileIdRef, updated every render)
//       before applying the server's response to component state -- a
//       switch made while the request was in flight makes that
//       continuation a no-op instead of overwriting the new profile's
//       screen with the old profile's answer.
//
// Same rendering pattern as active-profile-switch-submission-identity.test.tsx:
// the real ProfileMenu + the real DiscoverPage, wired to the same jsdom
// localStorage and the same real (unmocked) useActiveProfileId/
// useActiveProfile + SWR global cache. Only the Supabase-touching lib
// functions and the network-backed halves of @/lib/hooks/@/lib/trip are
// mocked at the module boundary.
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
const child = {
  id: "child-1",
  trip_id: "trip-1",
  device_id: "dev-shared",
  display_name: "Copilul",
  role: "child",
  created_at: "2026-01-01T00:00:01Z",
};
const trip = { id: "trip-1", slug: "trip-1", duration_days: 5, start_date: null };
const profiles = [parent, child];

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useTrip: () => ({ data: trip, error: undefined }),
    useProfiles: () => ({ data: profiles, error: undefined }),
  };
});
vi.mock("@/lib/trip", () => ({
  currentTripDay: () => 1,
  getTripTemporalState: () => ({ status: "active", day: 1, daysUntilStart: null }),
  getTripTimezone: () => "Europe/Bucharest",
}));
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

async function switchToProfile(name: string) {
  await click(screen.getByRole("button", { name: /profil/i }));
  await click(screen.getByRole("button", { name: /schimb.* profilul/i }));
  await click(screen.getByRole("button", { name }));
  await screen.findByText(name);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mutate(() => true, undefined, { revalidate: false });
  submitAnswer.mockClear();
  getMyResponse.mockReset().mockResolvedValue(null);
  getOrAssignExtra.mockReset().mockResolvedValue(null);
});

describe("R2 regression: Discover selection does not leak across a profile switch", () => {
  it("a selection made as Parent is cleared (not shown pre-selected) after switching to Child, before Child clicks anything", async () => {
    submitAnswerImpl = vi.fn().mockResolvedValue({
      status: "accepted",
      response: { id: "resp1", participant_id: "unset", question_id: "q1", selected_option_id: "optA", is_correct: true },
      contributedToTeam: false,
      correctOptionId: "optA",
    });

    const { ProfileMenu } = await import("@/components/ProfileMenu");
    const { default: DiscoverPage } = await import("../../app/trip/[slug]/discover/[slot]/page");

    render(
      <>
        <ProfileMenu slug="trip-1" />
        <DiscoverPage />
      </>,
    );

    await screen.findByText("Cine a raspuns?");
    await click(screen.getByRole("button", { name: "Raspunsul A" }));

    await switchToProfile("Copilul");

    const optAButton = screen.getByRole("button", { name: "Raspunsul A" });
    expect(optAButton.className).not.toContain("border-primary");

    // Submitting now (as Child, without picking anything) must not be
    // possible with Parent's stale choice -- the button stays disabled.
    expect((screen.getByRole("button", { name: "RĂSPUNDE" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("submitting as Child after a Parent-then-Child switch attributes Child's own freshly-clicked option, not Parent's earlier one", async () => {
    submitAnswerImpl = vi.fn().mockResolvedValue({
      status: "accepted",
      response: { id: "resp1", participant_id: "unset", question_id: "q1", selected_option_id: "optB", is_correct: false },
      contributedToTeam: false,
      correctOptionId: "optA",
    });

    const { ProfileMenu } = await import("@/components/ProfileMenu");
    const { default: DiscoverPage } = await import("../../app/trip/[slug]/discover/[slot]/page");

    render(
      <>
        <ProfileMenu slug="trip-1" />
        <DiscoverPage />
      </>,
    );

    await screen.findByText("Cine a raspuns?");
    await click(screen.getByRole("button", { name: "Raspunsul A" }));
    await switchToProfile("Copilul");

    await click(screen.getByRole("button", { name: "Raspunsul B" }));
    await click(screen.getByRole("button", { name: "RĂSPUNDE" }));
    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());

    expect(submitAnswer).toHaveBeenCalledWith(child.id, "q1", optionB.id);
  });
});

describe("R2 regression: a request in flight for one profile never paints its result on another profile's screen", () => {
  it("Parent's submit resolves AFTER switching to Child -- Child's screen stays on the question, not Parent's reveal", async () => {
    let resolveParentSubmit!: (value: unknown) => void;
    submitAnswerImpl = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveParentSubmit = resolve;
        }),
    );

    const { ProfileMenu } = await import("@/components/ProfileMenu");
    const { default: DiscoverPage } = await import("../../app/trip/[slug]/discover/[slot]/page");

    render(
      <>
        <ProfileMenu slug="trip-1" />
        <DiscoverPage />
      </>,
    );

    await screen.findByText("Cine a raspuns?");

    // Parent answers and submits -- the request is deliberately left
    // pending (never resolved yet).
    await click(screen.getByRole("button", { name: "Raspunsul A" }));
    await click(screen.getByRole("button", { name: "RĂSPUNDE" }));
    await waitFor(() => expect(submitAnswer).toHaveBeenCalledWith(parent.id, "q1", optionA.id));

    // Switch to Child WHILE Parent's request is still unresolved. Child
    // has never answered (getMyResponse resolves null for everyone).
    await switchToProfile("Copilul");
    await screen.findByText("Cine a raspuns?"); // Child's own fresh question screen.

    // NOW let Parent's long-pending request resolve.
    await act(async () => {
      resolveParentSubmit({
        status: "accepted",
        response: { id: "resp-parent", participant_id: parent.id, question_id: "q1", selected_option_id: "optA", is_correct: true },
        contributedToTeam: false,
        correctOptionId: "optA",
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Child's screen must still be the question (their own, unanswered
    // state) -- Parent's stale resolution must never have flipped it to
    // "reveal" showing Parent's response.
    expect(screen.getByText("Cine a raspuns?")).toBeTruthy();
    expect(screen.queryByText("Corect")).toBeNull();
  });
});
