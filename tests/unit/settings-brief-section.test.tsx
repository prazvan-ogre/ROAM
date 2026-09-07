// Trip editorial brief: Setări > "Brief editorial" tab (BriefSection in
// app/trip/[slug]/settings/page.tsx). Renders the real SettingsPage
// component; only network-backed lib functions and useTrip/useProfiles
// are mocked -- same pattern as settings-publish-section.test.tsx.
// getTripEditorialBrief/saveTripEditorialBrief are mocked (they're plain
// fetch wrappers); validateEditorialBrief is kept real (importOriginal)
// so the same validation logic the API re-runs actually gates the save
// button here too.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import type { EditorialBrief, SaveEditorialBriefResult } from "@/lib/editorialBrief";

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

vi.mock("@/lib/adminContent", () => ({
  validateTripContent: vi.fn().mockResolvedValue({ contentStatus: "pending", issues: [] }),
  publishTrip: vi.fn(),
}));

const getTripEditorialBrief = vi.fn();
const saveTripEditorialBrief = vi.fn<[string, unknown], Promise<SaveEditorialBriefResult>>();

vi.mock("@/lib/editorialBrief", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editorialBrief")>();
  return {
    ...actual,
    getTripEditorialBrief: (...args: [string]) => getTripEditorialBrief(...args),
    saveTripEditorialBrief: (...args: [string, unknown]) => saveTripEditorialBrief(...args),
  };
});

function brief(overrides: Partial<EditorialBrief> = {}): EditorialBrief {
  return {
    difficulty: "hard",
    style: "narrated_by_character",
    narratorCharacterName: "Ștefan cel Mare",
    theme: { history: 40, places: 20, food: 20, curiosities: 20 },
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
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
  getTripsForCurrentAccount.mockReset().mockResolvedValue({ isAdmin: false, trips: [trip] });
  updateAccountDetails.mockReset();
  getTripEditorialBrief.mockReset();
  saveTripEditorialBrief.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Trip editorial brief: Setări > Brief editorial tab visibility", () => {
  it("is hidden for an account that neither created this trip nor is admin", async () => {
    getTripsForCurrentAccount.mockResolvedValue({ isAdmin: false, trips: [] });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await waitFor(() => expect(getTripsForCurrentAccount).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Brief editorial" })).toBeNull();
    expect(getTripEditorialBrief).not.toHaveBeenCalled();
  });

  it("is shown for the trip's own creator (not just admins) and loads the brief on open", async () => {
    getTripEditorialBrief.mockResolvedValue({ brief: null, readOnly: false });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    const briefTab = await screen.findByRole("button", { name: "Brief editorial" });
    await click(briefTab);

    await waitFor(() => expect(getTripEditorialBrief).toHaveBeenCalledWith("trip-1"));
  });

  it("is shown for an admin account even when it didn't create the trip", async () => {
    // getTripsForCurrentAccount's own server-side filter (app/api/account/
    // trips/route.ts) returns EVERY trip for an admin, not just ones it
    // created -- that's the real signal isCreatorOrAdmin reads.
    getTripsForCurrentAccount.mockResolvedValue({ isAdmin: true, trips: [trip] });
    getTripEditorialBrief.mockResolvedValue({ brief: null, readOnly: false });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    expect(await screen.findByRole("button", { name: "Brief editorial" })).toBeTruthy();
  });
});

describe("Trip editorial brief: read-only summary after publication", () => {
  it("shows a readable summary of the saved brief, and never claims content was generated", async () => {
    getTripEditorialBrief.mockResolvedValue({ brief: brief(), readOnly: true });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));

    expect(await screen.findByText("Dificil")).toBeTruthy();
    expect(screen.getByText("Narat de un personaj istoric")).toBeTruthy();
    expect(screen.getByText("Ștefan cel Mare")).toBeTruthy();
    expect(screen.getByText(/Istorie 40% .+ Locuri de vizitat 20%/)).toBeTruthy();
    expect(screen.getByText(/disponibil doar pentru citire/i)).toBeTruthy();
    // Never suggests questions were generated or adapted from this brief.
    expect(screen.queryByText(/generat/i)).toBeNull();
    expect(screen.queryByText(/adaptat/i)).toBeNull();
    // Read-only: no editable inputs, no save button.
    expect(screen.queryByRole("button", { name: /Salvează/i })).toBeNull();
  });

  it("shows 'Preferințe nespecificate' for a published legacy trip with no brief, without inventing data", async () => {
    getTripEditorialBrief.mockResolvedValue({ brief: null, readOnly: true });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));

    expect(await screen.findByText("Preferințe nespecificate")).toBeTruthy();
    expect(screen.queryByText("Dificil")).toBeNull();
    expect(screen.queryByRole("button", { name: /Salvează/i })).toBeNull();
  });
});

describe("Trip editorial brief: editable form before publication", () => {
  it("pre-fills the form from an existing brief (not the form's own defaults)", async () => {
    getTripEditorialBrief.mockResolvedValue({ brief: brief(), readOnly: false });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));

    await screen.findByLabelText("Numele personajului istoric");
    expect((screen.getByLabelText("Istorie") as HTMLInputElement).value).toBe("40");
    expect((screen.getByLabelText("Locuri de vizitat") as HTMLInputElement).value).toBe("20");
    expect((screen.getByLabelText("Numele personajului istoric") as HTMLInputElement).value).toBe("Ștefan cel Mare");
    expect(screen.getByRole("button", { name: "Salvează brief-ul" })).toBeTruthy();
  });

  it("shows the form's own visible/editable defaults when the trip has no brief yet", async () => {
    getTripEditorialBrief.mockResolvedValue({ brief: null, readOnly: false });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));

    await screen.findByRole("button", { name: "Salvează brief-ul" });
    expect((screen.getByLabelText("Istorie") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("Locuri de vizitat") as HTMLInputElement).value).toBe("25");
    expect(screen.getByRole("button", { name: "Mediu" })).toBeTruthy();
    expect(screen.getByText(/propuneri inițiale, editabile/i)).toBeTruthy();
  });

  it("shows the static caution note about reviewing already-prepared content", async () => {
    getTripEditorialBrief.mockResolvedValue({ brief: brief(), readOnly: false });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));

    expect(await screen.findByText(/verifică-le -- ele nu se\s*actualizează automat/i)).toBeTruthy();
  });

  it("a failed load shows a retry that re-fetches", async () => {
    getTripEditorialBrief.mockRejectedValueOnce(new Error("network down"));

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));

    await screen.findByText(/Nu am putut încărca brief-ul/i);

    getTripEditorialBrief.mockResolvedValue({ brief: null, readOnly: false });
    await click(screen.getByRole("button", { name: /Încearcă din nou/i }));

    await waitFor(() => expect(getTripEditorialBrief).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "Salvează brief-ul" })).toBeTruthy();
  });
});

describe("Trip editorial brief: save, reload, retry", () => {
  it("a successful save shows confirmation", async () => {
    getTripEditorialBrief.mockResolvedValue({ brief: null, readOnly: false });
    saveTripEditorialBrief.mockResolvedValue({ status: "saved", brief: brief({ difficulty: "medium" }) });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));
    await screen.findByRole("button", { name: "Salvează brief-ul" });

    await click(screen.getByRole("button", { name: "Salvează brief-ul" }));

    await waitFor(() => expect(saveTripEditorialBrief).toHaveBeenCalledTimes(1));
    expect(saveTripEditorialBrief).toHaveBeenCalledWith("trip-1", expect.objectContaining({ difficulty: "medium" }));
    expect(await screen.findByText("Brief-ul a fost salvat.")).toBeTruthy();
  });

  it("after reload (a fresh mount), the values reflect exactly what was saved", async () => {
    getTripEditorialBrief.mockResolvedValueOnce({ brief: null, readOnly: false });
    const saved = brief({ difficulty: "easy", theme: { history: 10, places: 10, food: 10, curiosities: 70 } });
    saveTripEditorialBrief.mockResolvedValue({ status: "saved", brief: saved });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    const { unmount } = render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));
    await click(await screen.findByRole("button", { name: "Salvează brief-ul" }));
    await waitFor(() => expect(saveTripEditorialBrief).toHaveBeenCalledTimes(1));
    unmount();

    // A fresh mount re-fetches from the server (not local state) -- this
    // is what "identical after reload" actually depends on.
    getTripEditorialBrief.mockResolvedValueOnce({ brief: saved, readOnly: false });
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));

    await screen.findByRole("button", { name: "Ușor" });
    expect((screen.getByLabelText("Istorie") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Curiozități locale") as HTMLInputElement).value).toBe("70");
  });

  it("a save failure preserves the typed values, and retry (same values) succeeds", async () => {
    getTripEditorialBrief.mockResolvedValue({ brief: null, readOnly: false });
    saveTripEditorialBrief.mockRejectedValueOnce(new Error("db down"));

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));
    await screen.findByRole("button", { name: "Salvează brief-ul" });
    fireEvent.change(screen.getByLabelText("Istorie"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Locuri de vizitat"), { target: { value: "40" } });

    await click(screen.getByRole("button", { name: "Salvează brief-ul" }));

    expect(await screen.findByText(/db down|Nu am putut salva/i)).toBeTruthy();
    // No data loss -- the typed values are still there for a retry.
    expect((screen.getByLabelText("Istorie") as HTMLInputElement).value).toBe("10");
    expect((screen.getByLabelText("Locuri de vizitat") as HTMLInputElement).value).toBe("40");

    saveTripEditorialBrief.mockResolvedValueOnce({ status: "saved", brief: brief() });
    await click(screen.getByRole("button", { name: "Salvează brief-ul" }));

    await waitFor(() => expect(saveTripEditorialBrief).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Brief-ul a fost salvat.")).toBeTruthy();
  });

  it("a save rejected because the trip was published meanwhile shows the reason, then reloads to the read-only view", async () => {
    getTripEditorialBrief.mockResolvedValueOnce({ brief: null, readOnly: false });
    saveTripEditorialBrief.mockResolvedValue({ status: "rejected_published", brief: null });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));
    await screen.findByRole("button", { name: "Salvează brief-ul" });

    // Controlled by hand (instead of mockResolvedValueOnce) so the
    // rejection message's own render is observed BEFORE the background
    // refresh completes -- with an instantly-resolving mock, both
    // updates land in the same microtask flush and the message would
    // never be observably on screen, masking the exact bug this test
    // exists to catch (see BriefSection's own applyBrief/load split).
    let resolveRefresh!: (value: { brief: EditorialBrief | null; readOnly: boolean }) => void;
    const refreshPromise = new Promise<{ brief: EditorialBrief | null; readOnly: boolean }>((resolve) => {
      resolveRefresh = resolve;
    });
    getTripEditorialBrief.mockReturnValueOnce(refreshPromise);

    await click(screen.getByRole("button", { name: "Salvează brief-ul" }));

    expect(await screen.findByText(/publicată între timp/i)).toBeTruthy();
    // Still the editable form at this point -- the refresh hasn't landed yet.
    expect(screen.getByRole("button", { name: "Salvează brief-ul" })).toBeTruthy();

    await act(async () => {
      resolveRefresh({ brief: brief(), readOnly: true });
      await refreshPromise;
    });

    expect(await screen.findByText(/disponibil doar pentru citire/i)).toBeTruthy();
  });

  it("invalid percentages (total != 100) are blocked client-side, without calling save", async () => {
    getTripEditorialBrief.mockResolvedValue({ brief: null, readOnly: false });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));
    await screen.findByRole("button", { name: "Salvează brief-ul" });
    fireEvent.change(screen.getByLabelText("Istorie"), { target: { value: "50" } });

    await click(screen.getByRole("button", { name: "Salvează brief-ul" }));

    expect(saveTripEditorialBrief).not.toHaveBeenCalled();
    expect(await screen.findByText(/Suma procentelor trebuie să fie exact 100%/i)).toBeTruthy();
  });

  it("narrated_by_character with no character name is blocked client-side, without calling save", async () => {
    getTripEditorialBrief.mockResolvedValue({ brief: null, readOnly: false });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);
    await click(await screen.findByRole("button", { name: "Brief editorial" }));
    await click(await screen.findByRole("button", { name: "Narat de un personaj istoric" }));

    await click(screen.getByRole("button", { name: "Salvează brief-ul" }));

    expect(saveTripEditorialBrief).not.toHaveBeenCalled();
    expect(await screen.findByText(/Introdu numele personajului istoric/i)).toBeTruthy();
  });
});
