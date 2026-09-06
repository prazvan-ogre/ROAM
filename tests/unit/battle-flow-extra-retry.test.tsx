// R4 interaction test (2026-09-06 batch): BattleFlow's Extra-load-failure
// isolation, mirroring Discover/CatchUp's same fix. Mocking pattern
// follows the existing tests/unit/battle-flow-partial-resume.test.tsx.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const participant = {
  id: "p1",
  trip_id: "trip-1",
  device_id: "dev-1",
  display_name: "Racer",
  role: "adult" as const,
  age: null,
  created_at: "2026-01-01T00:00:00Z",
};

const battle = { id: "battle-1", trip_id: "trip-1", day_number: 1, title: "Battle", is_final: false };
const q1 = {
  id: "q1",
  trip_id: "trip-1",
  kind: "battle",
  day_number: 1,
  slot: null,
  order_index: 1,
  prompt: "Prima intrebare",
  question_type: "single_choice",
  points: 10,
  verified: true,
  published: true,
};
const opt1 = { id: "opt1", question_id: "q1", order_index: 1, label: "Opt 1A" };
const content = { battle, questions: [{ question: q1, options: [opt1], exploreLinks: [] }] };
const extraFixture = { id: "extra-1", extra_type: "fun_fact", title: "Fapt", description: "Un fapt interesant." };

// No prior responses -- a fresh pass through Q1.
vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/schedule", () => ({
  getSlotAvailability: () => ({ status: "open", opensAt: "07:00", closesAt: "23:59" }),
}));

const submitAnswer = vi.fn().mockResolvedValue({
  status: "accepted",
  response: { id: "resp-q1", participant_id: "p1", question_id: "q1", selected_option_id: "opt1", is_correct: true },
  contributedToTeam: true,
  correctOptionId: "opt1",
});
let getOrAssignExtraImpl: (...args: unknown[]) => Promise<unknown>;
const getOrAssignExtra = vi.fn((...args: unknown[]) => getOrAssignExtraImpl(...args));

vi.mock("@/lib/discover", () => ({
  submitAnswer: (...args: unknown[]) => submitAnswer(...args),
  getOrAssignExtra: (...args: unknown[]) => getOrAssignExtra(...args),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/battle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/battle")>();
  return {
    ...actual,
    getBattleWindowStatus: vi.fn().mockResolvedValue({ visible: false }),
    getBattleResult: vi.fn().mockResolvedValue({ adults: 0, kids: 0 }),
  };
});
vi.mock("@/lib/participant", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/participant")>();
  return {
    ...actual,
    getStoredActiveProfileId: () => "p1",
  };
});

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

afterEach(() => {
  cleanup();
  submitAnswer.mockClear();
  getOrAssignExtra.mockClear();
});

describe("R4: BattleFlow -- an Extra load failure never hides the already-recorded answer, and has its own retry", () => {
  it("shows the answer reveal and a dedicated Extra retry on failure, then recovers", async () => {
    getOrAssignExtraImpl = async () => {
      throw new Error("network down");
    };

    const { BattleFlow } = await import("@/components/BattleFlow");
    render(<BattleFlow content={content as never} tripId="trip-1" slug="trip-1" isFinal={false} profiles={[participant as never]} />);

    await click(screen.getByRole("button", { name: "HAI LA BATTLE" }));
    await screen.findByText("Prima intrebare");
    await click(screen.getByRole("button", { name: "Opt 1A" }));
    await click(screen.getByRole("button", { name: "RĂSPUNDE" }));

    // The reveal (correct-answer banner) shows despite the Extra fetch
    // failing.
    await screen.findByText("Răspuns: Opt 1A");
    await screen.findByText(/Nu am putut încărca Extra/i);
    expect(screen.queryByText("Un fapt interesant.")).toBeNull();

    getOrAssignExtraImpl = async () => extraFixture;
    await click(screen.getByRole("button", { name: "Încearcă din nou" }));

    await screen.findByText("Un fapt interesant.");
    expect(screen.queryByText(/Nu am putut încărca Extra/i)).toBeNull();
    expect(screen.getByText("Răspuns: Opt 1A")).toBeTruthy();
  });
});
