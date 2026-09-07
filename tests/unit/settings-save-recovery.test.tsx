// R4 interaction tests (2026-09-06 batch): Setări > Utilizatori's save/
// recovery behavior. Renders the real SettingsPage component; only the
// network-backed lib functions and useTrip/useProfiles are mocked.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "trip-1" }),
  usePathname: () => "/trip/trip-1/settings",
}));

const trip = {
  id: "trip-1",
  slug: "trip-1",
  name: "Test Trip",
  duration_days: 5,
  start_date: null,
  content_status: "ready" as const,
  destination: "Halkidiki",
};

type TestParticipant = {
  id: string;
  trip_id: string;
  device_id: string;
  display_name: string;
  role: "adult" | "child";
  age: number | null;
  account_id: string | null;
  created_at: string;
};

const adult: TestParticipant = {
  id: "adult-1",
  trip_id: "trip-1",
  device_id: "dev-1",
  display_name: "Parintele",
  role: "adult",
  age: null,
  account_id: null,
  created_at: "2026-01-01T00:00:00Z",
};

let profiles: TestParticipant[];
const mutateProfiles = vi.fn(async () => profiles);

vi.mock("@/lib/hooks", () => ({
  useTrip: () => ({ data: trip, error: undefined }),
  useProfiles: () => ({ data: profiles, error: undefined, mutate: mutateProfiles }),
}));

const getStoredAccountId = vi.fn<[], string | null>(() => null);
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
  getPrizeStatus: vi
    .fn()
    .mockResolvedValue({ options: [], configured: false, votingOpen: false, winner: null, resolutionMethod: null, closesAt: null }),
}));

let addChildImpl: (...args: unknown[]) => Promise<unknown>;
const addChildProfile = vi.fn((...args: unknown[]) => addChildImpl(...args));
const updateParticipant = vi.fn();
const deleteParticipant = vi.fn();

vi.mock("@/lib/participant", () => ({
  addChildProfile: (...args: unknown[]) => addChildProfile(...args),
  updateParticipant: (...args: unknown[]) => updateParticipant(...args),
  deleteParticipant: (...args: unknown[]) => deleteParticipant(...args),
}));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  profiles = [{ ...adult }];
  addChildProfile.mockClear();
  updateParticipant.mockReset().mockResolvedValue(undefined);
  deleteParticipant.mockReset();
  mutateProfiles.mockClear();
  getStoredAccountId.mockReset().mockReturnValue(null);
  getAccountDetails.mockReset().mockResolvedValue({ phoneNumber: "", displayName: null, isAdmin: false });
  getTripsForCurrentAccount.mockReset().mockResolvedValue({ isAdmin: false, trips: [] });
  updateAccountDetails.mockReset();
});

// This vitest.config.ts doesn't set test.globals, so @testing-library/react's
// own automatic afterEach(cleanup) never runs -- without this, each test
// after the first leaves the previous one's DOM behind, causing
// "multiple elements" query failures.
afterEach(() => {
  cleanup();
});

describe("R4: Setări > Adaugă profil copil -- slow request, double-click, error preserves values", () => {
  it("a slow add-child request disables the form and a double-click only submits once", async () => {
    let resolveAdd!: (value: unknown) => void;
    addChildImpl = () =>
      new Promise((resolve) => {
        resolveAdd = resolve;
      });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: /Adaugă profil copil/i }));
    const nameInput = screen.getByPlaceholderText("Numele copilului");
    fireEvent.change(nameInput, { target: { value: "Ana" } });

    const submitButton = screen.getByRole("button", { name: "Adaugă" });
    await click(submitButton);
    // Still pending -- a second click while submitting must not fire a
    // second call.
    await click(submitButton);

    expect(addChildProfile).toHaveBeenCalledTimes(1);
    expect((nameInput as HTMLInputElement).disabled).toBe(true);

    await act(async () => {
      resolveAdd({ id: "child-1", display_name: "Ana", role: "child", age: null });
      await Promise.resolve();
    });
  });

  it("a failed add-child request shows an error and keeps the typed name in the form", async () => {
    addChildImpl = async () => {
      throw new Error("network down");
    };

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: /Adaugă profil copil/i }));
    const nameInput = screen.getByPlaceholderText("Numele copilului");
    fireEvent.change(nameInput, { target: { value: "Ana" } });
    await click(screen.getByRole("button", { name: "Adaugă" }));

    await screen.findByText(/Nu am putut adăuga profilul/i);
    expect((nameInput as HTMLInputElement).value).toBe("Ana");
  });
});

describe("R4-fix1: Setări > Adaugă profil copil -- request id stable across a bare retry, fresh after an edit", () => {
  it("retrying without changing the name reuses the same request id", async () => {
    addChildImpl = async () => {
      throw new Error("network down");
    };

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: /Adaugă profil copil/i }));
    fireEvent.change(screen.getByPlaceholderText("Numele copilului"), { target: { value: "Ana" } });
    await click(screen.getByRole("button", { name: "Adaugă" }));
    await screen.findByText(/Nu am putut adăuga profilul/i);

    addChildImpl = async () => ({ id: "child-1", display_name: "Ana", role: "child", age: null });
    await click(screen.getByRole("button", { name: "Adaugă" }));

    expect(addChildProfile).toHaveBeenCalledTimes(2);
    const firstRequestId = addChildProfile.mock.calls[0][3];
    const secondRequestId = addChildProfile.mock.calls[1][3];
    expect(secondRequestId).toBe(firstRequestId);
  });

  it("changing the name before retrying gets a NEW request id", async () => {
    addChildImpl = async () => {
      throw new Error("network down");
    };

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: /Adaugă profil copil/i }));
    const nameInput = screen.getByPlaceholderText("Numele copilului");
    fireEvent.change(nameInput, { target: { value: "Ana" } });
    await click(screen.getByRole("button", { name: "Adaugă" }));
    await screen.findByText(/Nu am putut adăuga profilul/i);

    fireEvent.change(nameInput, { target: { value: "Ana-Maria" } });
    addChildImpl = async () => ({ id: "child-1", display_name: "Ana-Maria", role: "child", age: null });
    await click(screen.getByRole("button", { name: "Adaugă" }));

    expect(addChildProfile).toHaveBeenCalledTimes(2);
    const firstRequestId = addChildProfile.mock.calls[0][3];
    const secondRequestId = addChildProfile.mock.calls[1][3];
    expect(secondRequestId).not.toBe(firstRequestId);
  });
});

describe("R4: Setări > Editează profil -- partial success (profile saved, account details not) keeps the form open", () => {
  it("when updateParticipant succeeds but updateAccountDetails fails, the form stays open with a message naming which half failed", async () => {
    getStoredAccountId.mockReturnValue("account-1");
    getAccountDetails.mockResolvedValue({ phoneNumber: "0700000000", displayName: "Parintele", isAdmin: false });
    updateAccountDetails.mockRejectedValue(new Error("Acest număr de telefon este deja folosit de alt cont."));
    profiles = [{ ...adult, account_id: "account-1" }];

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: "Editează" }));
    // Let the phone-number pre-fill effect settle before saving.
    await waitFor(() => expect(getAccountDetails).toHaveBeenCalled());
    await click(screen.getByRole("button", { name: "Salvează" }));
    await waitFor(() => expect(updateParticipant).toHaveBeenCalled());
    await waitFor(() => expect(updateAccountDetails).toHaveBeenCalled());

    await waitFor(
      () => expect(screen.getByText(/Profilul a fost salvat, dar detaliile contului nu/i)).toBeTruthy(),
      { timeout: 3000 },
    );
    // Still open -- Salvează is still in the document.
    expect(screen.getByRole("button", { name: /Salvează/i })).toBeTruthy();
    expect(updateParticipant).toHaveBeenCalledTimes(1);

    // Retry: only the account-details half should run again -- the
    // profile save that already succeeded must not repeat.
    updateAccountDetails.mockResolvedValue({ phoneNumber: "0799999999", displayName: "Parintele", isAdmin: false });
    await click(screen.getByRole("button", { name: "Salvează" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Salvează" })).toBeNull());
    expect(updateParticipant).toHaveBeenCalledTimes(1);
    expect(updateAccountDetails).toHaveBeenCalledTimes(2);
  });
});

describe("R4-fix6: Setări -- editing profile B while profile A's save is still in flight", () => {
  it("shows B's own form, and A's later result/error never paints onto it", async () => {
    const child = { ...adult, id: "child-1", display_name: "Copilul", role: "child" as const, age: 7 };
    profiles = [{ ...adult }, child];

    let resolveAdultSave!: (value: unknown) => void;
    updateParticipant.mockReset().mockImplementation((id: string) => {
      if (id === adult.id) {
        return new Promise((resolve) => {
          resolveAdultSave = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    const editButtons = await screen.findAllByRole("button", { name: "Editează" });
    await click(editButtons[0]); // adult (profile A)
    await screen.findByDisplayValue("Parintele");

    await click(screen.getByRole("button", { name: "Salvează" }));
    await waitFor(() => expect(updateParticipant).toHaveBeenCalledWith(adult.id, "Parintele", "adult", null));
    // A's save is deliberately left pending (resolveAdultSave not called
    // yet) -- switch to editing B (only B's own "Editează" button is
    // rendered right now, A's row shows its form instead).
    await click(screen.getByRole("button", { name: "Editează" }));
    await screen.findByDisplayValue("Copilul");
    expect(screen.queryByText(/Nu s-a putut salva/i)).toBeNull();
    expect(screen.queryByText(/Profilul a fost salvat, dar/i)).toBeNull();

    // A's long-pending save resolves now, while B's form is open -- React
    // unmounted A's EditProfileForm instance when editingId changed, so
    // its setState calls are no-ops; this must never surface on B's
    // screen.
    await act(async () => {
      resolveAdultSave(undefined);
      await Promise.resolve();
    });
    expect(screen.getByDisplayValue("Copilul")).toBeTruthy();
    expect(screen.queryByText(/Nu s-a putut salva/i)).toBeNull();
    expect(screen.queryByText(/Profilul a fost salvat, dar/i)).toBeNull();
  });
});

describe("R4: Setări -- distinct load-error vs. empty-list states", () => {
  it("a failed getTripsForCurrentAccount shows a retry, not an empty list", async () => {
    getStoredAccountId.mockReturnValue("account-1");
    getAccountDetails.mockResolvedValue({ phoneNumber: "0700000000", displayName: null, isAdmin: false });
    getTripsForCurrentAccount.mockRejectedValue(new Error("network down"));

    const { default: SettingsPage } = await import("../../app/trip/[slug]/settings/page");
    render(<SettingsPage />);

    await click(await screen.findByRole("button", { name: "Toate călătoriile" }));
    await screen.findByText(/Nu am putut încărca lista de călătorii/i);
    expect(screen.queryByText("Nicio călătorie încă.")).toBeNull();

    // Retry succeeds.
    getTripsForCurrentAccount.mockResolvedValue({ isAdmin: false, trips: [] });
    await click(screen.getByRole("button", { name: "Încearcă din nou" }));
    await screen.findByText("Nicio călătorie încă.");
  });
});
