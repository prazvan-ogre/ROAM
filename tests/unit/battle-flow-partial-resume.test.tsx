// R2 regression: individual progress and partial-Battle resumability.
// A Battle is played one participant at a time, pass-the-phone style
// (BattleFlow's own "select-profile" step, not the global ProfileMenu --
// see the 2026-09-05 review's finding that BattleFlow deliberately keeps
// its own local activeProfile rather than following a mid-battle global
// switch). handleSelectProfile (src/components/BattleFlow.tsx) looks up
// the selected participant's own existing responses and resumes at the
// first question THEY haven't answered yet -- this test proves that
// directly: a participant who already answered question 1 of 2 resumes
// at question 2, not question 1, and their own passAnswered/passCorrect
// tally on the "done" screen reflects only the newly-answered question
// (individual progress), not a double-count of the one already on record.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

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
const q2 = {
  id: "q2",
  trip_id: "trip-1",
  kind: "battle",
  day_number: 1,
  slot: null,
  order_index: 2,
  prompt: "A doua intrebare",
  question_type: "single_choice",
  points: 10,
  verified: true,
  published: true,
};
const opt1 = { id: "opt1", question_id: "q1", order_index: 1, label: "Opt 1A" };
const opt2 = { id: "opt2", question_id: "q2", order_index: 1, label: "Opt 2A" };

const content = {
  battle,
  questions: [
    { question: q1, options: [opt1], exploreLinks: [] },
    { question: q2, options: [opt2], exploreLinks: [] },
  ],
};

// Participant already has a response on record for q1 only -- simulates
// a Battle interrupted after the first question.
vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: async () => ({
            data: [{ id: "resp-q1", participant_id: "p1", question_id: "q1", selected_option_id: "opt1", is_correct: true }],
            error: null,
          }),
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
  response: { id: "resp-q2", participant_id: "p1", question_id: "q2", selected_option_id: "opt2", is_correct: true },
  contributedToTeam: true,
  correctOptionId: "opt2",
});
vi.mock("@/lib/discover", () => ({
  submitAnswer: (...args: unknown[]) => submitAnswer(...args),
  getOrAssignExtra: vi.fn().mockResolvedValue(null),
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
});

describe("R2 regression: a partial Battle resumes at the first unanswered question", () => {
  it("a participant who already answered Q1 is taken straight to Q2, not asked to redo Q1", async () => {
    const { BattleFlow } = await import("@/components/BattleFlow");

    render(<BattleFlow content={content as never} tripId="trip-1" slug="trip-1" isFinal={false} profiles={[participant as never]} />);

    await click(screen.getByRole("button", { name: "HAI LA BATTLE" }));

    // Resumed straight at Q2 -- Q1's prompt never shows as an active
    // question to answer again.
    await screen.findByText("A doua intrebare");
    expect(screen.queryByText("Prima intrebare")).toBeNull();
  });

  it("finishing the resumed Battle reports only the individually-answered question, not a double count", async () => {
    const { BattleFlow } = await import("@/components/BattleFlow");

    render(<BattleFlow content={content as never} tripId="trip-1" slug="trip-1" isFinal={true} profiles={[participant as never]} />);

    await click(screen.getByRole("button", { name: "HAI LA BATTLE" }));
    await screen.findByText("A doua intrebare");

    await click(screen.getByRole("button", { name: "Opt 2A" }));
    await click(screen.getByRole("button", { name: "RĂSPUNDE" }));
    await waitFor(() => expect(submitAnswer).toHaveBeenCalledWith("p1", "q2", "opt2"));

    await click(screen.getByRole("button", { name: "GATA" }));

    // Individual progress for this pass: exactly 1 answered, 1 correct --
    // the already-on-record Q1 answer is not re-counted into this pass's
    // own tally (it belongs to the earlier, interrupted pass).
    await screen.findByText("Racer · 1/1 corecte");
  });
});
