// R5 regression: /trips must show the account's actual trip list
// (reusing TripsList, src/components/TripsList.tsx) instead of always
// redirecting into a trip's own Setări the moment the account has at
// least one -- and a load failure must be distinct from "not logged in"
// (previously fell back to the auth screen) and from a genuinely empty
// list. Logging out (or switching accounts without a full page reload)
// must never show a stale, previously-loaded account's trips.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";

const push = vi.fn();
const searchParamsGet = vi.fn(() => null); // no ?link= for any of these tests
// Stable object identities across renders -- real Next.js memoizes
// useRouter()/useSearchParams() internally; a mock returning a fresh
// object literal per call would make any useCallback/useEffect that
// depends on them (e.g. this page's own linkNewTripThenRedirect)
// recompute/re-fire every render, which is exactly the kind of
// mock-induced instability this file's own assertions would otherwise
// need to tolerate.
const routerMock = { push };
const searchParamsMock = { get: searchParamsGet };

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => searchParamsMock,
}));

const getStoredAccountId = vi.fn<[], string | null>(() => null);
const getTripsForCurrentAccount = vi.fn();
const authenticateCreatorAccount = vi.fn();
const clearStoredAccountId = vi.fn();
const linkTripToCurrentAccount = vi.fn();

vi.mock("@/lib/creatorAccount", () => ({
  getStoredAccountId: (...args: unknown[]) => getStoredAccountId(...(args as [])),
  getTripsForCurrentAccount: (...args: unknown[]) => getTripsForCurrentAccount(...args),
  authenticateCreatorAccount: (...args: unknown[]) => authenticateCreatorAccount(...args),
  clearStoredAccountId: (...args: unknown[]) => clearStoredAccountId(...args),
  linkTripToCurrentAccount: (...args: unknown[]) => linkTripToCurrentAccount(...args),
}));

const tripA = {
  id: "trip-a",
  slug: "trip-a",
  name: "Trip A",
  language: "ro",
  start_date: "2027-06-01",
  duration_days: 5,
  destination: "Corfu",
  location_info: null,
  content_status: "ready" as const,
  is_active: true,
  is_demo: false,
  created_at: "2027-01-01T00:00:00Z",
};
const tripB = { ...tripA, id: "trip-b", slug: "trip-b", name: "Trip B" };

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  push.mockClear();
  searchParamsGet.mockClear().mockReturnValue(null);
  getStoredAccountId.mockReset().mockReturnValue("account-1");
  getTripsForCurrentAccount.mockReset();
  authenticateCreatorAccount.mockReset();
  clearStoredAccountId.mockReset();
  linkTripToCurrentAccount.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("R5: /trips shows the real list instead of always redirecting into a trip's Setări", () => {
  it("an account with zero trips sees the empty state, not a redirect", async () => {
    getTripsForCurrentAccount.mockResolvedValue({ isAdmin: false, trips: [] });

    const { default: TripsPage } = await import("../../app/trips/page");
    render(<TripsPage />);

    await screen.findByText("Nicio călătorie încă.");
    expect(push).not.toHaveBeenCalled();
  });

  it("an account with two trips sees BOTH of them listed, not a redirect into the first one's Setări", async () => {
    getTripsForCurrentAccount.mockResolvedValue({ isAdmin: false, trips: [tripA, tripB] });

    const { default: TripsPage } = await import("../../app/trips/page");
    render(<TripsPage />);

    await screen.findByText("Trip A");
    expect(screen.getByText("Trip B")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("a load failure shows a distinct error+retry, never the empty state and never the login screen", async () => {
    getTripsForCurrentAccount.mockRejectedValueOnce(new Error("network down"));

    const { default: TripsPage } = await import("../../app/trips/page");
    render(<TripsPage />);

    await screen.findByText("Nu am putut încărca lista de călătorii.");
    expect(screen.queryByText("Nicio călătorie încă.")).toBeNull();
    // Not silently dropped back to the phone/PIN login form either.
    expect(screen.queryByLabelText("Număr de telefon")).toBeNull();

    getTripsForCurrentAccount.mockResolvedValueOnce({ isAdmin: false, trips: [] });
    await click(screen.getByRole("button", { name: "Încearcă din nou" }));
    await screen.findByText("Nicio călătorie încă.");
  });
});

describe("R5: logging out and back in as a different account never shows the previous account's list", () => {
  it("shows only the new account's trip after logout + a fresh login, never the old one", async () => {
    getStoredAccountId.mockReturnValue("account-a");
    getTripsForCurrentAccount.mockResolvedValueOnce({ isAdmin: false, trips: [tripA] });

    const { default: TripsPage } = await import("../../app/trips/page");
    render(<TripsPage />);
    await screen.findByText("Trip A");

    await click(screen.getByRole("button", { name: "Ieși din cont" }));
    expect(clearStoredAccountId).toHaveBeenCalledTimes(1);
    // Back to the login form (the "Ai deja cont?" chooser, R5-fix4, comes
    // first) -- trip A's card is gone entirely either way.
    await screen.findByText("Ai deja un cont?");
    expect(screen.queryByText("Trip A")).toBeNull();

    // Pick existing, then log in as account B.
    await click(screen.getByRole("button", { name: "Da, am cont" }));
    fireEvent.change(screen.getByLabelText("Număr de telefon"), { target: { value: "0711111111" } });
    fireEvent.change(screen.getByLabelText("PIN (4-6 cifre)"), { target: { value: "4321" } });

    authenticateCreatorAccount.mockResolvedValue({ accountId: "account-b", isAdmin: false, displayName: "B" });
    getTripsForCurrentAccount.mockResolvedValueOnce({ isAdmin: false, trips: [tripB] });
    await click(screen.getByRole("button", { name: "Intră" }));

    await screen.findByText("Trip B");
    expect(screen.queryByText("Trip A")).toBeNull();
  });
});
