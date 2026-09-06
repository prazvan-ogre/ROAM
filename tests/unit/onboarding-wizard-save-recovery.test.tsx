// R4 interaction tests (2026-09-06 batch): OnboardingWizard's join and
// finish/vote steps. The wizard is forward-only (no back nav, by design --
// see the component's own top comment), so "data preserved on error" is
// verified by retrying the SAME step without retyping anything and
// confirming it still works, not by navigating back to inspect the field.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
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

const trackEvent = vi.fn();

vi.mock("@/lib/analytics", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

const trip = {
  id: "trip-1",
  slug: "trip-1",
  name: "Halkidiki",
  language: "ro",
  duration_days: 5,
  start_date: null,
  destination: "Halkidiki",
  location_info: null,
  content_status: "ready" as const,
  is_active: true,
  is_demo: false,
  created_at: "2026-01-01T00:00:00Z",
};

const prizeWithOptions = {
  options: [{ id: "opt-1", title: "Prăjitură", description: null }],
  votingOpen: true,
  winner: null,
  closesAt: null,
};

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  getOrCreateAdultParticipant.mockReset();
  addChildProfile.mockReset();
  getPrizeStatus.mockReset().mockResolvedValue(prizeWithOptions);
  castPrizeVote.mockReset();
  trackEvent.mockReset().mockResolvedValue(undefined);
});

// This project's vitest.config.ts doesn't set test.globals, so
// @testing-library/react's automatic afterEach(cleanup) never runs.
afterEach(() => {
  cleanup();
});

async function goToRoleStep() {
  const onComplete = vi.fn().mockResolvedValue(undefined);
  render(<OnboardingWizard trip={trip} onComplete={onComplete} />);

  await click(screen.getByRole("button", { name: /Continuă/i }));
  fireEvent.change(screen.getByPlaceholderText("Numele tău"), { target: { value: "Maria" } });
  await click(screen.getByRole("button", { name: /Continuă/i }));
  await click(screen.getByRole("button", { name: "Adulți" }));
  return onComplete;
}

describe("R4: OnboardingWizard join -- error before save preserves the entered name/role", () => {
  it("a failed join shows an error, keeps the wizard on the same step, and a retry succeeds without retyping", async () => {
    getOrCreateAdultParticipant.mockRejectedValueOnce(new Error("network down"));
    await goToRoleStep();

    await click(screen.getByRole("button", { name: /Continuă/i }));
    await screen.findByText(/Nu s-a putut salva/i);
    // Still on the role step -- the "Adulți"/"Copii" choice is still shown.
    expect(screen.getByRole("button", { name: "Adulți" })).toBeTruthy();

    // Retry, with no re-entry of name/role needed -- confirms the state was
    // preserved across the failed attempt.
    getOrCreateAdultParticipant.mockResolvedValueOnce({ id: "adult-1" });
    await click(screen.getByRole("button", { name: /Continuă/i }));

    expect(getOrCreateAdultParticipant).toHaveBeenCalledTimes(2);
    expect(getOrCreateAdultParticipant).toHaveBeenLastCalledWith("trip-1", "Maria");
    // Advanced past the role step -- the join succeeded.
    await screen.findByText("Cum funcționează");
  });

  it("a slow join disables the button so a double-click only submits once", async () => {
    let resolveJoin!: (value: unknown) => void;
    getOrCreateAdultParticipant.mockReturnValue(
      new Promise((resolve) => {
        resolveJoin = resolve;
      }),
    );
    await goToRoleStep();

    const continueButton = screen.getByRole("button", { name: /Continuă/i });
    await click(continueButton);
    await click(continueButton);

    expect(getOrCreateAdultParticipant).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveJoin({ id: "adult-1" });
      await Promise.resolve();
    });
  });
});

describe("R4: OnboardingWizard finish/vote -- a failed vote doesn't leave the button looking broken, and retry doesn't duplicate", () => {
  it("shows an error and re-enables the button on failure, then a retry succeeds", async () => {
    getOrCreateAdultParticipant.mockResolvedValue({ id: "adult-1" });
    const onComplete = await goToRoleStep();
    await click(screen.getByRole("button", { name: /Continuă/i })); // join
    await screen.findByText("Cum funcționează");
    await click(screen.getByRole("button", { name: /Continuă/i })); // how -> prize

    await screen.findByText("Prăjitură");
    await click(screen.getByRole("button", { name: /Prăjitură/i }));

    castPrizeVote.mockRejectedValueOnce(new Error("network down"));
    const finishButton = await screen.findByRole("button", { name: /Votează și/i });
    await click(finishButton);

    await screen.findByText(/Nu am putut finaliza/i);
    // The button is enabled again -- not stuck in "..." forever.
    const retryButton = screen.getByRole("button", { name: /Votează și/i });
    expect((retryButton as HTMLButtonElement).disabled).toBe(false);
    expect(onComplete).not.toHaveBeenCalled();

    castPrizeVote.mockResolvedValueOnce(undefined);
    await click(retryButton);

    expect(castPrizeVote).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
