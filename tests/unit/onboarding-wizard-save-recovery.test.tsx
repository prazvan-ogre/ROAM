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
  timezone: null,
  destination: "Halkidiki",
  location_info: null,
  content_status: "ready" as const,
  is_active: true,
  is_demo: false,
  created_at: "2026-01-01T00:00:00Z",
};

const prizeWithOptions = {
  options: [
    { id: "opt-1", title: "Prăjitură", description: null },
    { id: "opt-2", title: "Înghețată", description: null },
  ],
  configured: true,
  votingOpen: true,
  winner: null,
  resolutionMethod: null,
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

    castPrizeVote.mockResolvedValueOnce("recorded");
    await click(retryButton);

    // R8: a recorded vote now shows its own confirmation panel first,
    // rather than finishing immediately -- see OnboardingWizard's
    // voteRecorded state.
    await screen.findByText(/Votul tău a fost înregistrat/i);
    expect(onComplete).not.toHaveBeenCalled();
    await click(screen.getByRole("button", { name: /^Continuă/i }));

    expect(castPrizeVote).toHaveBeenCalledTimes(2);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("a vote CONFLICT (a different option already on record) is never reported as the new pick being saved", async () => {
    getOrCreateAdultParticipant.mockResolvedValue({ id: "adult-1" });
    const onComplete = await goToRoleStep();
    await click(screen.getByRole("button", { name: /Continuă/i })); // join
    await screen.findByText("Cum funcționează");
    await click(screen.getByRole("button", { name: /Continuă/i })); // how -> prize

    await screen.findByText("Prăjitură");
    await click(screen.getByRole("button", { name: /Prăjitură/i }));

    castPrizeVote.mockResolvedValueOnce("conflict");
    await click(await screen.findByRole("button", { name: /Votează și/i }));

    await screen.findByText(/Aveai deja un vot înregistrat pentru altă opțiune/i);
    // Not finished yet -- the person must see this before continuing.
    expect(onComplete).not.toHaveBeenCalled();
    // No generic "couldn't finish" error is ALSO shown -- this isn't that
    // kind of failure.
    expect(screen.queryByText(/Nu am putut finaliza/i)).toBeNull();

    // Acknowledging continues without re-attempting the vote -- it's
    // already resolved (the original pick stands either way).
    await click(screen.getByRole("button", { name: /Am înțeles, continuă/i }));

    expect(castPrizeVote).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("R4-fix5: OnboardingWizard prize load error is distinct from 'no options', with its own retry", () => {
  it("shows a retry instead of silently proceeding as if there's nothing to vote for", async () => {
    getPrizeStatus.mockReset().mockRejectedValueOnce(new Error("network down"));
    getOrCreateAdultParticipant.mockResolvedValue({ id: "adult-1" });
    await goToRoleStep();
    await click(screen.getByRole("button", { name: /Continuă/i })); // join
    await screen.findByText("Cum funcționează");
    await click(screen.getByRole("button", { name: /Continuă/i })); // how -> prize

    await screen.findByText(/Nu am putut încărca premiul/i);
    // Never silently substitutes the "no options configured" screen.
    expect(screen.queryByText("Premiul câștigătorilor")).toBeNull();
    // The finish button is disabled while in this state -- can't
    // accidentally continue past a load failure and lose the vote.
    expect((screen.getByRole("button", { name: /Hai să începem/i }) as HTMLButtonElement).disabled).toBe(true);

    getPrizeStatus.mockResolvedValueOnce(prizeWithOptions);
    await click(screen.getByRole("button", { name: /Încearcă din nou/i }));

    await screen.findByText("Prăjitură");
  });
});

describe("R4-fix4: OnboardingWizard join -- a slow/hanging analytics call never delays advancing", () => {
  it("goes to the next step even while trackEvent is still pending", async () => {
    getOrCreateAdultParticipant.mockResolvedValue({ id: "adult-1" });
    trackEvent.mockReset().mockReturnValue(new Promise(() => {})); // never resolves
    await goToRoleStep();

    await click(screen.getByRole("button", { name: /Continuă/i }));

    // The join succeeded and the wizard already moved on, despite
    // trackEvent's promise never settling.
    await screen.findByText("Cum funcționează");
  });
});
