// R7: Setări > Publicare tab (PublishSection in app/trip/[slug]/settings/
// page.tsx). Renders the real SettingsPage component; only network-backed
// lib functions and useTrip/useProfiles are mocked -- same pattern as
// settings-save-recovery.test.tsx. Proves the UI actually calls
// validateTripContent/publishTrip and reacts to their real result shapes
// (loading, issue list, clean/dirty publish-button gating, success vs.
// rejection messaging), not just that the tab renders.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import type { ContentValidationIssue, PublishTripResult } from "@/lib/adminContent";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "trip-1" }),
  usePathname: () => "/trip/trip-1/settings",
}));

let trip: {
  id: string;
  slug: string;
  name: string;
  duration_days: number;
  start_date: string | null;
  content_status: "pending" | "ready" | "generating" | "failed";
  destination: string;
};

let profiles: unknown[];
const mutateProfiles = vi.fn(async () => profiles);

vi.mock("@/lib/hooks", () => ({
  useTrip: () => ({ data: trip, error: undefined }),
  useProfiles: () => ({ data: profiles, error: undefined, mutate: mutateProfiles }),
}));

const getStoredAccountId = vi.fn<[], string | null>(() => "account-1");
const getAccountDetails = vi.fn();
const getTripsForCurrentAccount = vi.fn();
const updateAccountDetails = vi.fn();

vi.mock("@/lib/creatorAccount", () => ({
  getStoredAccountId: (...args: unknown[]) => getStoredAccountId(...(args as [])),
  getAccountDetails: (...args: unknown[]) => getAccountDetails(...args),
  getTripsForCurrentAccount: (...args: unknown[]) => getTripsForCurrentAccount(...args),
  updateAccountDetails: (...args: unknown[]) => updateAccountDetails(...args),
}));

vi.mock("@/lib/prize", () => ({
  getPrizeStatus: vi.fn().mockResolvedValue({ options: [], votingOpen: false, winner: null, closesAt: null }),
}));

vi.mock("@/lib/participant", () => ({
  addChildProfile: vi.fn(),
  updateParticipant: vi.fn(),
  deleteParticipant: vi.fn(),
}));

const validateTripContent = vi.fn<[string], Promise<{ contentStatus: string; issues: ContentValidationIssue[] }>>();
const publishTrip = vi.fn<[string], Promise<PublishTripResult>>();

vi.mock("@/lib/adminContent", () => ({
  validateTripContent: (...args: [string]) => validateTripContent(...args),
  publishTrip: (...args: [string]) => publishTrip(...args),
}));

function issue(overrides: Partial<ContentValidationIssue> = {}): ContentValidationIssue {
  return {
    check_key: "discover.missing",
    severity: "error",
    message: "Lipsește Discover pentru ziua 1.",
    day_number: 1,
    entity_id: null,
    ...overrides,
  } as ContentValidationIssue;
}

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  trip = {
    id: "trip-1",
    slug: "trip-1",
    name: "Test Trip",
    duration_days: 5,
    start_date: null,
    content_status: "pending",
    destination: "Halkidiki",
  };
  profiles = [];
  mutateProfiles.mockClear();
  getStoredAccountId.mockReset().mockReturnValue("account-1");
  getAccountDetails.mockReset().mockResolvedValue({ phoneNumber: "", displayName: null, isAdmin: false });
  getTripsForCurrentAccount.mockReset().mockResolvedValue({ isAdmin: true, trips: [] });
  updateAccountDetails.mockReset();
  validateTripContent.mockReset();
  publishTrip.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("R7: Setări > Publicare tab visibility", () => {
  it("is hidden entirely for a non-admin account", async () => {
    getTripsForCurrentAccount.mockResolvedValue({ isAdmin: false, trips: [] });
    validateTripContent.mockResolvedValue({ contentStatus: "pending", issues: [] });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await waitFor(() => expect(getTripsForCurrentAccount).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Publicare" })).toBeNull();
    expect(validateTripContent).not.toHaveBeenCalled();
  });

  it("is shown for an admin account and loads validation on open", async () => {
    validateTripContent.mockResolvedValue({ contentStatus: "pending", issues: [issue()] });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    const publishTab = await screen.findByRole("button", { name: "Publicare" });
    await click(publishTab);

    await waitFor(() => expect(validateTripContent).toHaveBeenCalledWith("trip-1"));
    expect(await screen.findByText(/Lipsește o întrebare Discover/i)).toBeTruthy();
  });
});

describe("R7: Setări > Publicare -- issue list and publish gating", () => {
  it("shows every error issue with its Romanian label and day number, and disables Publică", async () => {
    validateTripContent.mockResolvedValue({
      contentStatus: "pending",
      issues: [
        issue({ check_key: "discover.missing", day_number: 2 }),
        issue({ check_key: "battle.final_missing", day_number: null, message: "Lipsește Battle-ul Final." }),
      ],
    });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: "Publicare" }));

    expect(await screen.findByText(/Lipsește o întrebare Discover/i)).toBeTruthy();
    expect(screen.getByText(/Ziua 2/i)).toBeTruthy();
    expect(screen.getAllByText(/Lipsește Battle-ul Final/i).length).toBeGreaterThan(0);

    const publishButton = screen.getByRole("button", { name: /Publică/i });
    expect((publishButton as HTMLButtonElement).disabled).toBe(true);
    expect(publishTrip).not.toHaveBeenCalled();
  });

  it("enables Publică once validation comes back clean, and publishing shows success", async () => {
    validateTripContent.mockResolvedValue({ contentStatus: "pending", issues: [] });
    publishTrip.mockResolvedValue({ status: "published", errorCount: 0, warningCount: 0, issues: [] });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: "Publicare" }));
    const publishButton = await screen.findByRole("button", { name: "Publică" });
    expect((publishButton as HTMLButtonElement).disabled).toBe(false);

    await click(publishButton);

    await waitFor(() => expect(publishTrip).toHaveBeenCalledWith("trip-1"));
    expect(await screen.findByText(/Publicat cu succes/i)).toBeTruthy();
  });

  it("a rejected publish (server found new errors) shows the rejection message and doesn't flip the status label", async () => {
    validateTripContent.mockResolvedValue({ contentStatus: "pending", issues: [] });
    publishTrip.mockResolvedValue({
      status: "rejected",
      errorCount: 1,
      warningCount: 0,
      issues: [issue({ check_key: "battle.daily_missing", day_number: 3, message: "Lipsește Battle-ul zilei 3." })],
    });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: "Publicare" }));
    await click(await screen.findByRole("button", { name: "Publică" }));

    await waitFor(() => expect(publishTrip).toHaveBeenCalledWith("trip-1"));
    expect(await screen.findByText(/Publicarea a fost respinsă/i)).toBeTruthy();
    expect(screen.getByText(/Lipsește Battle-ul zilei 3/i)).toBeTruthy();
    expect(screen.getByText("În pregătire")).toBeTruthy();
  });

  it("an already-published trip republishes idempotently and shows the 'already published' message", async () => {
    trip.content_status = "ready";
    validateTripContent.mockResolvedValue({ contentStatus: "ready", issues: [] });
    publishTrip.mockResolvedValue({ status: "already_published", errorCount: 0, warningCount: 0, issues: [] });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: "Publicare" }));
    await click(await screen.findByRole("button", { name: "Republică" }));

    await waitFor(() => expect(publishTrip).toHaveBeenCalledWith("trip-1"));
    expect(await screen.findByText(/Era deja publicată/i)).toBeTruthy();
  });

  it("a failed validate fetch shows a retry, and retrying re-fetches", async () => {
    validateTripContent.mockRejectedValueOnce(new Error("network down"));

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: "Publicare" }));
    await screen.findByText(/Nu am putut verifica conținutul/i);

    validateTripContent.mockResolvedValue({ contentStatus: "pending", issues: [] });
    await click(screen.getByRole("button", { name: /Încearcă din nou/i }));

    await waitFor(() => expect(validateTripContent).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/Toate verificările au trecut/i)).toBeTruthy();
  });
});
