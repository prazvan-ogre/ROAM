// R4 interaction test (2026-09-06 batch): CatchUpPage's Extra-load-failure
// isolation, mirroring the Discover page's same fix (see
// tests/unit/discover-extra-retry.test.tsx). CatchUp only ever fetches
// Extra right after a fresh submit (getCatchUpQuestions only returns
// pending/unanswered questions, so there's no "reopening an already-
// answered question" case here the way Discover has).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { mutate } from "swr";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "trip-1" }),
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

const questionFixture = {
  question: {
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
  },
  options: [{ id: "optA", question_id: "q1", order_index: 1, label: "Raspunsul A" }],
  exploreLinks: [],
};

const extraFixture = { id: "extra-1", extra_type: "fun_fact", title: "Fapt", description: "Un fapt interesant." };

let getOrAssignExtraImpl: (...args: unknown[]) => Promise<unknown>;
const getOrAssignExtra = vi.fn((...args: unknown[]) => getOrAssignExtraImpl(...args));

vi.mock("@/lib/discover", () => ({
  getCatchUpQuestions: vi.fn().mockResolvedValue([questionFixture]),
  submitAnswer: vi.fn().mockResolvedValue({
    status: "accepted",
    response: { id: "resp1", participant_id: "parent-1", question_id: "q1", selected_option_id: "optA", is_correct: true },
    contributedToTeam: false,
    correctOptionId: "optA",
  }),
  getOrAssignExtra: (...args: unknown[]) => getOrAssignExtra(...args),
}));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mutate(() => true, undefined, { revalidate: false });
  getOrAssignExtra.mockClear();
});

describe("R4: CatchUp -- an Extra load failure never hides the already-recorded answer, and has its own retry", () => {
  it("shows the answer and a dedicated Extra retry on failure, then recovers", async () => {
    getOrAssignExtraImpl = async () => {
      throw new Error("network down");
    };

    const { default: CatchUpPage } = await import("../../app/trip/[slug]/catchup/page");
    render(<CatchUpPage />);
    await screen.findByText("Cine a raspuns?");
    await click(screen.getByRole("button", { name: "Raspunsul A" }));
    await click(screen.getByRole("button", { name: "RĂSPUNDE" }));

    await screen.findByText("Corect");
    await screen.findByText(/Nu am putut încărca Extra/i);
    expect(screen.queryByText("Un fapt interesant.")).toBeNull();

    getOrAssignExtraImpl = async () => extraFixture;
    await click(screen.getByRole("button", { name: "Încearcă din nou" }));

    await screen.findByText("Un fapt interesant.");
    expect(screen.queryByText(/Nu am putut încărca Extra/i)).toBeNull();
    expect(screen.getByText("Corect")).toBeTruthy();
  });
});
