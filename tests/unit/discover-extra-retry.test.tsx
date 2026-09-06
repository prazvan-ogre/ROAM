// R4 interaction test (2026-09-06 batch): getOrAssignExtra failing must
// never hide an already-accepted answer, and must offer its own retry
// instead of folding into the page's outer error screen. Mocking pattern
// (next/navigation, @/lib/hooks, @/lib/discover) follows the existing
// tests/unit/discover-submission-status-ui.test.tsx.
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
  correct_reveal_message: "Corect",
};
const optionA = { id: "optA", question_id: "q1", order_index: 1, label: "Raspunsul A" };

const extraFixture = { id: "extra-1", extra_type: "fun_fact", title: "Fapt", description: "Un fapt interesant." };

const getMyResponse = vi.fn();
let getOrAssignExtraImpl: (...args: unknown[]) => Promise<unknown>;
const getOrAssignExtra = vi.fn((...args: unknown[]) => getOrAssignExtraImpl(...args));
let submitAnswerImpl: (...args: unknown[]) => Promise<unknown>;
const submitAnswer = vi.fn((...args: unknown[]) => submitAnswerImpl(...args));

vi.mock("@/lib/discover", () => ({
  getDiscoverQuestion: vi.fn().mockResolvedValue({ question: questionFixture, options: [optionA], exploreLinks: [] }),
  getMyResponse: (...args: unknown[]) => getMyResponse(...args),
  submitAnswer: (...args: unknown[]) => submitAnswer(...args),
  getOrAssignExtra: (...args: unknown[]) => getOrAssignExtra(...args),
}));
const trackEvent = vi.fn();
vi.mock("@/lib/analytics", () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mutate(() => true, undefined, { revalidate: false });
  submitAnswer.mockClear();
  getOrAssignExtra.mockClear();
  getMyResponse.mockReset().mockResolvedValue(null);
  trackEvent.mockReset().mockResolvedValue(undefined);
});

describe("R4: Discover -- an Extra load failure never hides the already-recorded answer, and has its own retry", () => {
  it("Extra failing on a fresh submit still reveals the answer, shows a dedicated retry, and recovers on retry", async () => {
    submitAnswerImpl = vi.fn().mockResolvedValue({
      status: "accepted",
      response: { id: "resp1", participant_id: parent.id, question_id: "q1", selected_option_id: "optA", is_correct: true },
      contributedToTeam: false,
      correctOptionId: "optA",
    });
    getOrAssignExtraImpl = async () => {
      throw new Error("network down");
    };

    const { default: DiscoverPage } = await import("../../app/trip/[slug]/discover/[slot]/page");
    render(<DiscoverPage />);
    await screen.findByText("Cine a raspuns?");
    await click(screen.getByRole("button", { name: "Raspunsul A" }));
    await click(screen.getByRole("button", { name: "RĂSPUNDE" }));

    // The answer reveals despite the Extra fetch failing -- it must never
    // be folded into the page's outer error screen.
    await screen.findByText("Corect");
    await screen.findByText(/Nu am putut încărca Extra/i);
    expect(screen.queryByText("Un fapt interesant.")).toBeNull();

    getOrAssignExtraImpl = async () => extraFixture;
    await click(screen.getByRole("button", { name: "Încearcă din nou" }));

    await screen.findByText("Un fapt interesant.");
    expect(screen.queryByText(/Nu am putut încărca Extra/i)).toBeNull();
    // The answer itself is still intact throughout.
    expect(screen.getByText("Corect")).toBeTruthy();
  });

  it("Extra failing while reopening an ALREADY-answered question still shows the recorded answer, not a page-level error", async () => {
    getMyResponse.mockResolvedValue({
      id: "resp1",
      participant_id: parent.id,
      question_id: "q1",
      selected_option_id: "optA",
      is_correct: true,
    });
    getOrAssignExtraImpl = async () => {
      throw new Error("network down");
    };

    const { default: DiscoverPage } = await import("../../app/trip/[slug]/discover/[slot]/page");
    render(<DiscoverPage />);

    await screen.findByText("Corect");
    await screen.findByText(/Nu am putut încărca Extra/i);
    expect(screen.queryByText(/Nu am putut încărca datele/i)).toBeNull();
  });
});

describe("R4-fix4: Discover -- a slow/hanging analytics call never delays showing the question", () => {
  it("shows the question even while trackEvent('question_opened') is still pending", async () => {
    trackEvent.mockReturnValue(new Promise(() => {})); // never resolves

    const { default: DiscoverPage } = await import("../../app/trip/[slug]/discover/[slot]/page");
    render(<DiscoverPage />);

    await screen.findByText("Cine a raspuns?");
  });
});
