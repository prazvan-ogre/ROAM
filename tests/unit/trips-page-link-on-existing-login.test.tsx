// Verifies the fix for hypothesis E from the 2026-09-05 review: an
// already logged-in creator ("Călătoriile mele" account id already in
// localStorage, valid session cookie) who is redirected to
// /trips?link=<newSlug> right after creating a second trip now gets that
// trip linked to their account, the same way a fresh phone+PIN login's
// handleAuthSubmit already did -- app/trips/page.tsx's mount effect now
// calls linkTripToCurrentAccount() (src/lib/creatorAccount.ts, backed by
// the new app/api/account/link-trip/route.ts, session-cookie-gated) and
// the same getOrCreateAdultParticipant auto-join, instead of skipping
// straight to loadTrips() with linkSlug never consulted.
//
// Renders the real page component with next/navigation and the trip/
// account/participant helpers mocked -- no real Supabase, no real router.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

const push = vi.fn();
const searchParamsGet = vi.fn((key: string) => (key === "link" ? "kassandra-2027" : null));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: searchParamsGet }),
}));

const getOrCreateAdultParticipant = vi.fn();
vi.mock("@/lib/participant", () => ({ getOrCreateAdultParticipant }));

const getTripBySlug = vi.fn();
vi.mock("@/lib/trip", () => ({
  getTripBySlug: (...args: unknown[]) => getTripBySlug(...args),
}));

const getTripsForCurrentAccount = vi.fn();
const linkTripToCurrentAccount = vi.fn();
vi.mock("@/lib/creatorAccount", () => ({
  authenticateCreatorAccount: vi.fn(),
  clearStoredAccountId: vi.fn(),
  getStoredAccountId: () => "existing-account-id",
  getTripsForCurrentAccount: (...args: unknown[]) => getTripsForCurrentAccount(...args),
  linkTripToCurrentAccount: (...args: unknown[]) => linkTripToCurrentAccount(...args),
}));

beforeEach(() => {
  push.mockClear();
  searchParamsGet.mockClear();
  getOrCreateAdultParticipant.mockClear();
  getTripBySlug.mockClear();
  getTripsForCurrentAccount.mockClear();
  linkTripToCurrentAccount.mockClear();
});

// This vitest.config.ts doesn't set test.globals, so @testing-library/react's
// own automatic afterEach(cleanup) never registers -- without this, a
// second render() in the same file (this file now has two) leaves the
// first test's DOM/effects behind.
afterEach(() => {
  cleanup();
});

describe("hypothesis E (fixed): returning creator's new trip linking", () => {
  it("links the newly created trip to the account and redirects into it, instead of ignoring linkSlug", async () => {
    linkTripToCurrentAccount.mockResolvedValue({ displayName: "Andrei" });
    getTripBySlug.mockResolvedValue({ id: "new-trip-id", slug: "kassandra-2027" });
    getOrCreateAdultParticipant.mockResolvedValue({ id: "participant-id" });

    const { default: TripsPage } = await import("../../app/trips/page");
    render(<TripsPage />);

    await waitFor(() => expect(push).toHaveBeenCalled());

    // Fixed: the already-logged-in path now links the trip the same way
    // a fresh login would, using the session-cookie-gated endpoint (no
    // phone/PIN re-entry) instead of never consulting linkSlug at all.
    expect(linkTripToCurrentAccount).toHaveBeenCalledWith("kassandra-2027");
    expect(getTripBySlug).toHaveBeenCalledWith("kassandra-2027");
    expect(getOrCreateAdultParticipant).toHaveBeenCalledWith("new-trip-id", "Andrei", "existing-account-id");

    // Lands inside the trip just created/linked, not some previously-
    // linked one -- getTripsForCurrentAccount (the loadTrips() path) is
    // never even consulted on this branch.
    expect(push).toHaveBeenCalledWith("/trip/kassandra-2027/settings");
    expect(getTripsForCurrentAccount).not.toHaveBeenCalled();
  });

  it("still redirects into the trip even if linking fails (best-effort, matches handleAuthSubmit's own linking)", async () => {
    linkTripToCurrentAccount.mockRejectedValue(new Error("simulated network failure"));

    const { default: TripsPage } = await import("../../app/trips/page");
    render(<TripsPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/trip/kassandra-2027/settings"));

    expect(getTripBySlug).not.toHaveBeenCalled();
    expect(getOrCreateAdultParticipant).not.toHaveBeenCalled();
  });
});
