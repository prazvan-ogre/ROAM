// Verifies the fix for hypothesis E from the 2026-09-05 review: an
// already logged-in creator ("Călătoriile mele" account already looks
// logged in, valid Supabase Auth session cookie) who is redirected to
// /trips?link=<newSlug> right after creating a second trip now gets that
// trip linked to their account, the same way a fresh phone+PIN login's
// handleAccount already does -- app/trips/page.tsx's mount effect calls
// linkTripToCurrentAccount() (src/lib/creatorAccount.ts, backed by
// app/api/account/link-trip/route.ts, session-cookie-gated).
//
// Batch 2 update (2026-09-05 review, R1 continued): the auto-join itself
// (creating/linking this device's adult participant) moved entirely
// server-side, inside that same route, using the device's own verified
// anonymous session instead of a client-supplied accountId
// (src/lib/security/participantLink.ts) -- so this client no longer
// calls getOrCreateAdultParticipant() at all for this flow. What this
// test now verifies is narrower and more direct: the page calls
// linkTripToCurrentAccount() with the right slug and redirects into the
// trip either way (success or failure, best-effort) -- and does NOT
// import/call any participant-creation helper itself.
//
// Renders the real page component with next/navigation and the account
// helper mocked -- no real Supabase, no real router.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";

const push = vi.fn();
const searchParamsGet = vi.fn((key: string) => (key === "link" ? "kassandra-2027" : null));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: searchParamsGet }),
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
  it("links the newly created trip to the account (server-side) and redirects into it, instead of ignoring linkSlug", async () => {
    linkTripToCurrentAccount.mockResolvedValue({ displayName: "Andrei", tripLink: "linked" });

    const { default: TripsPage } = await import("../../app/trips/page");
    render(<TripsPage />);

    await waitFor(() => expect(push).toHaveBeenCalled());

    // Fixed: the already-logged-in path now links the trip the same way
    // a fresh login would, using the session-cookie-gated endpoint (no
    // phone/PIN re-entry). The join itself is entirely server-side now
    // (app/api/account/link-trip/route.ts) -- this client makes no
    // participant-creation call of its own.
    expect(linkTripToCurrentAccount).toHaveBeenCalledWith("kassandra-2027");

    // Lands inside the trip just created/linked, not some previously-
    // linked one -- getTripsForCurrentAccount (the loadTrips() path) is
    // never even consulted on this branch.
    expect(push).toHaveBeenCalledWith("/trip/kassandra-2027/settings");
    expect(getTripsForCurrentAccount).not.toHaveBeenCalled();
  });

  it("still redirects into the trip even if linking fails (best-effort, matches the fresh-login flow's own linking)", async () => {
    linkTripToCurrentAccount.mockRejectedValue(new Error("simulated network failure"));

    const { default: TripsPage } = await import("../../app/trips/page");
    render(<TripsPage />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/trip/kassandra-2027/settings"));
  });
});
