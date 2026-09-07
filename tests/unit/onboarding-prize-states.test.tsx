// R8 (20260908090000_r8_prize_voting_rules.sql): OnboardingWizard's prize
// step now has four distinct states per the product rules -- voting
// available, vote recorded, voting closed (winner shown directly, e.g. to
// a late joiner), and "not configured" (fewer than 2 real options). This
// file covers the three not already exercised by
// onboarding-wizard-save-recovery.test.tsx (available -> recorded, and
// the conflict acknowledgment): not_configured, voting_closed on submit,
// and closed-with-winner for someone who never got to vote at all.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { OnboardingWizard } from "@/components/OnboardingWizard";

const getOrCreateAdultParticipant = vi.fn();
const addChildProfile = vi.fn();

vi.mock("@/lib/participant", () => ({
  getOrCreateAdultParticipant: (...args: unknown[]) => getOrCreateAdultParticipant(...args),
  addChildProfile: (...args: unknown[]) => addChildProfile(...args),
}));

const getPrizeStatus = vi.fn();
const castPrizeVote = vi.fn();

vi.mock("@/lib/prize", () => ({
  getPrizeStatus: (...args: unknown[]) => getPrizeStatus(...args),
  castPrizeVote: (...args: unknown[]) => castPrizeVote(...args),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

const trip = {
  id: "trip-1",
  slug: "trip-1",
  name: "Halkidiki",
  language: "ro",
  duration_days: 5,
  start_date: null,
  timezone: null,
  destination: "Halkidiki",
  location_info: null,
  content_status: "ready" as const,
  is_active: true,
  is_demo: false,
  created_at: "2026-01-01T00:00:00Z",
};

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

async function goToPrizeStep(onComplete = vi.fn().mockResolvedValue(undefined)) {
  render(<OnboardingWizard trip={trip} onComplete={onComplete} />);
  await click(screen.getByRole("button", { name: /Continuă/i })); // intro -> name
  fireEvent.change(screen.getByPlaceholderText("Numele tău"), { target: { value: "Maria" } });
  await click(screen.getByRole("button", { name: /Continuă/i })); // name -> role
  await click(screen.getByRole("button", { name: "Adulți" }));
  await click(screen.getByRole("button", { name: /Continuă/i })); // role -> join
  await screen.findByText("Cum funcționează");
  await click(screen.getByRole("button", { name: /Continuă/i })); // how -> prize
  return onComplete;
}

afterEach(() => {
  cleanup();
});

describe("R8: OnboardingWizard prize step -- not configured", () => {
  it("fewer than 2 options shows the generic 'not established yet' panel, never a single-option picker", async () => {
    getOrCreateAdultParticipant.mockResolvedValue({ id: "adult-1" });
    getPrizeStatus.mockResolvedValue({
      options: [{ id: "opt-1", title: "Only one", description: null }],
      configured: false,
      votingOpen: false,
      winner: null,
      resolutionMethod: null,
      closesAt: null,
    });

    const onComplete = await goToPrizeStep();

    expect(await screen.findByText("Premiul câștigătorilor")).toBeTruthy();
    expect(screen.getByText(/va fi anunțat în curând/i)).toBeTruthy();
    expect(screen.queryByText("Only one")).toBeNull();

    // Finishing from here never attempts to vote.
    await click(screen.getByRole("button", { name: /Hai să începem/i }));
    expect(castPrizeVote).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("R8: OnboardingWizard prize step -- voting already closed", () => {
  it("a participant who never got to vote sees the winner directly, not the picker", async () => {
    getOrCreateAdultParticipant.mockResolvedValue({ id: "adult-1" });
    getPrizeStatus.mockResolvedValue({
      options: [
        { id: "opt-1", title: "Prăjitură", description: null },
        { id: "opt-2", title: "Înghețată", description: null },
      ],
      configured: true,
      votingOpen: false,
      winner: { id: "opt-1", title: "Prăjitură", description: "Ceva dulce." },
      resolutionMethod: "plurality",
      closesAt: null,
    });

    const onComplete = await goToPrizeStep();

    expect(await screen.findByText("🏆 Prăjitură")).toBeTruthy();
    expect(screen.getByText("Ceva dulce.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Înghețată/i })).toBeNull();

    await click(screen.getByRole("button", { name: /Hai să începem/i }));
    expect(castPrizeVote).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("submitting right as voting closes (race) refreshes to the real state instead of a false success", async () => {
    getOrCreateAdultParticipant.mockResolvedValue({ id: "adult-1" });
    getPrizeStatus.mockResolvedValueOnce({
      options: [
        { id: "opt-1", title: "Prăjitură", description: null },
        { id: "opt-2", title: "Înghețată", description: null },
      ],
      configured: true,
      votingOpen: true,
      winner: null,
      resolutionMethod: null,
      closesAt: null,
    });

    const onComplete = await goToPrizeStep();
    await click(await screen.findByRole("button", { name: /Prăjitură/i }));

    castPrizeVote.mockResolvedValueOnce("voting_closed");
    getPrizeStatus.mockResolvedValueOnce({
      options: [
        { id: "opt-1", title: "Prăjitură", description: null },
        { id: "opt-2", title: "Înghețată", description: null },
      ],
      configured: true,
      votingOpen: false,
      winner: { id: "opt-2", title: "Înghețată", description: null },
      resolutionMethod: "no_votes_default",
      closesAt: null,
    });
    await click(screen.getByRole("button", { name: /Votează și/i }));

    expect(await screen.findByText("🏆 Înghețată")).toBeTruthy();
    // Never silently treated as if the vote had been saved.
    expect(onComplete).not.toHaveBeenCalled();
  });
});
