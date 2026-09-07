// R8 (20260908090000_r8_prize_voting_rules.sql): Setări > Configurare's
// prize row now reflects the server-resolved contract (configured/
// votingOpen/winner/closesAt) instead of the old "options.length === 0"
// check, and labels the closing instant as the destination's own time
// when voting is still open. Renders the real SettingsPage component;
// only the network-backed lib functions and useTrip/useProfiles are
// mocked, same pattern as settings-save-recovery.test.tsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "trip-1" }),
  usePathname: () => "/trip/trip-1/settings",
}));

const trip = {
  id: "trip-1",
  slug: "trip-1",
  name: "Test Trip",
  duration_days: 5,
  start_date: "2026-06-01",
  timezone: "Europe/Athens",
  content_status: "ready" as const,
  destination: "Halkidiki",
};

const adult = {
  id: "adult-1",
  trip_id: "trip-1",
  device_id: "dev-1",
  display_name: "Parintele",
  role: "adult" as const,
  age: null,
  account_id: null,
  created_at: "2026-01-01T00:00:00Z",
};

let profiles: (typeof adult)[];
const mutateProfiles = vi.fn(async () => profiles);

vi.mock("@/lib/hooks", () => ({
  useTrip: () => ({ data: trip, error: undefined }),
  useProfiles: () => ({ data: profiles, error: undefined, mutate: mutateProfiles }),
}));

vi.mock("@/lib/creatorAccount", () => ({
  getStoredAccountId: () => null,
  getAccountDetails: vi.fn(),
  getTripsForCurrentAccount: vi.fn().mockResolvedValue({ isAdmin: false, trips: [] }),
  updateAccountDetails: vi.fn(),
}));

vi.mock("@/lib/participant", () => ({
  addChildProfile: vi.fn(),
  updateParticipant: vi.fn(),
  deleteParticipant: vi.fn(),
}));

const getPrizeStatus = vi.fn();

vi.mock("@/lib/prize", () => ({
  getPrizeStatus: (...args: unknown[]) => getPrizeStatus(...args),
}));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

async function openConfigTab() {
  const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
  render(<SettingsPage />);
  await click(await screen.findByRole("button", { name: "Configurare" }));
}

beforeEach(() => {
  profiles = [{ ...adult }];
  mutateProfiles.mockClear();
  getPrizeStatus.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("R8: Setări > Configurare -- prize states", () => {
  it("fewer than 2 configured options shows 'not established yet'", async () => {
    getPrizeStatus.mockResolvedValue({
      options: [],
      configured: false,
      votingOpen: false,
      winner: null,
      resolutionMethod: null,
      closesAt: null,
    });

    await openConfigTab();

    expect(await screen.findByText("Nu a fost stabilit încă")).toBeTruthy();
  });

  it("voting open shows the closing instant labeled as destination time", async () => {
    getPrizeStatus.mockResolvedValue({
      options: [
        { id: "opt-1", title: "A", description: null },
        { id: "opt-2", title: "B", description: null },
      ],
      configured: true,
      votingOpen: true,
      winner: null,
      resolutionMethod: null,
      closesAt: new Date("2026-06-02T00:00:00Z"),
    });

    await openConfigTab();

    const row = await screen.findByText(/Se stabilește prin vot/i);
    expect(row.textContent).toMatch(/închide/i);
    expect(row.textContent).toMatch(/ora destinației/i);
  });

  it("voting closed shows the winner's title", async () => {
    getPrizeStatus.mockResolvedValue({
      options: [
        { id: "opt-1", title: "Prăjitură", description: null },
        { id: "opt-2", title: "Înghețată", description: null },
      ],
      configured: true,
      votingOpen: false,
      winner: { id: "opt-1", title: "Prăjitură", description: null },
      resolutionMethod: "plurality",
      closesAt: null,
    });

    await openConfigTab();

    expect(await screen.findByText("Prăjitură")).toBeTruthy();
  });

  it("a failed prize status fetch shows a retry, distinct from every other state", async () => {
    getPrizeStatus.mockRejectedValueOnce(new Error("network down"));

    await openConfigTab();

    await screen.findByText("Nu am putut încărca");
    const retry = screen.getByRole("button", { name: /Încearcă din nou/i });

    getPrizeStatus.mockResolvedValueOnce({
      options: [],
      configured: false,
      votingOpen: false,
      winner: null,
      resolutionMethod: null,
      closesAt: null,
    });
    await click(retry);

    expect(await screen.findByText("Nu a fost stabilit încă")).toBeTruthy();
  });
});
