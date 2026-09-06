// R4 interaction test (2026-09-06 batch): ProfileMenu's account
// disconnect/logout affordance. Before this batch the menu always showed
// "Creează cont" even for a device that already had one -- there was no
// way to log out from here at all.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { ProfileMenu } from "@/components/ProfileMenu";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const trip = { id: "trip-1", slug: "trip-1" };
const adult = { id: "adult-1", display_name: "Parintele", role: "adult" as const };

vi.mock("@/lib/hooks", () => ({
  useTrip: () => ({ data: trip }),
  useProfiles: () => ({ data: [adult] }),
  useActiveProfile: () => adult,
}));

const setStoredActiveProfileId = vi.fn();
vi.mock("@/lib/participant", () => ({
  setStoredActiveProfileId: (...args: unknown[]) => setStoredActiveProfileId(...args),
}));

const getStoredAccountId = vi.fn<[], string | null>(() => null);
const clearStoredAccountId = vi.fn();
vi.mock("@/lib/creatorAccount", () => ({
  getStoredAccountId: (...args: unknown[]) => getStoredAccountId(...(args as [])),
  clearStoredAccountId: (...args: unknown[]) => clearStoredAccountId(...args),
}));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  push.mockReset();
  setStoredActiveProfileId.mockReset();
  getStoredAccountId.mockReset().mockReturnValue(null);
  clearStoredAccountId.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("R4: ProfileMenu -- account disconnect only appears once a device has an account, and logs out on confirm", () => {
  it("shows 'Creează cont' (not 'Deconectare cont') when no account exists on this device", async () => {
    render(<ProfileMenu slug="trip-1" />);
    await click(screen.getByRole("button", { name: "Profil" }));

    expect(screen.getByRole("button", { name: /Creează cont/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Deconectare cont/i })).toBeNull();
  });

  it("shows 'Deconectare cont' (not 'Creează cont') when an account already exists, and logs out on confirm", async () => {
    getStoredAccountId.mockReturnValue("account-1");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<ProfileMenu slug="trip-1" />);
    await click(screen.getByRole("button", { name: "Profil" }));

    expect(screen.queryByRole("button", { name: /Creează cont/i })).toBeNull();
    const logoutButton = screen.getByRole("button", { name: /Deconectare cont/i });
    await click(logoutButton);

    expect(window.confirm).toHaveBeenCalled();
    expect(clearStoredAccountId).toHaveBeenCalledTimes(1);
    // Menu closed after logout, and profiles/answers are untouched --
    // setStoredActiveProfileId (the profile-switch mechanism) was never
    // called by logging out.
    expect(screen.queryByRole("button", { name: /Deconectare cont/i })).toBeNull();
    expect(setStoredActiveProfileId).not.toHaveBeenCalled();

    // Reopen: the menu now reflects the logged-out state.
    await click(screen.getByRole("button", { name: "Profil" }));
    expect(screen.getByRole("button", { name: /Creează cont/i })).toBeTruthy();
  });

  it("declining the confirm dialog does not log out", async () => {
    getStoredAccountId.mockReturnValue("account-1");
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<ProfileMenu slug="trip-1" />);
    await click(screen.getByRole("button", { name: "Profil" }));
    await click(screen.getByRole("button", { name: /Deconectare cont/i }));

    expect(clearStoredAccountId).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Deconectare cont/i })).toBeTruthy();
  });
});
