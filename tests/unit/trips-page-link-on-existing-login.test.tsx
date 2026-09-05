// Verifies R5's hypothesis from the 2026-09-05 review: an already
// logged-in creator ("Călătoriile mele" account id already in
// localStorage) who is redirected to /trips?link=<newSlug> right after
// creating a second trip never gets that trip linked to their account --
// the mount effect in app/trips/page.tsx only ever calls loadTrips() when
// an account id is already stored, and linking (getOrCreateAdultParticipant
// with the account id, plus the account API's own trip-linking update)
// only happens inside handleAuthSubmit, which the "already logged in" path
// never reaches.
//
// Renders the real page component with next/navigation and the trip/
// account/participant helpers mocked -- no real Supabase, no real router.
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";

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

// R1 replaced the direct getTripsForAccount()/getAllTrips() + client-side
// getStoredIsAdmin() reads with one server-verified call
// (app/api/account/trips/route.ts, src/lib/creatorAccount.ts's
// getTripsForCurrentAccount()) -- the R5 bug this test demonstrates is
// unrelated to that plumbing change (it's about linkSlug never being
// consulted on this render path) and is deliberately left unfixed this
// batch (R1 explicitly excludes R2-R5), so this mock only needs to speak
// the new interface, not fix the underlying behavior.
const getTripsForCurrentAccount = vi.fn();
vi.mock("@/lib/creatorAccount", () => ({
  authenticateCreatorAccount: vi.fn(),
  clearStoredAccountId: vi.fn(),
  getStoredAccountId: () => "existing-account-id",
  getTripsForCurrentAccount: (...args: unknown[]) => getTripsForCurrentAccount(...args),
}));

describe("R5: returning creator's new trip linking", () => {
  it("never attempts to link the new trip and shows only the account's previously-linked trips", async () => {
    // The account's existing trip list -- deliberately does NOT include
    // "kassandra-2027" (the one just created and referenced by ?link=),
    // matching the real route's .eq("created_by_account_id", ...) filter:
    // an unlinked trip can never appear here.
    getTripsForCurrentAccount.mockResolvedValue({
      isAdmin: false,
      trips: [{ id: "old-trip", slug: "kassandra-2025", content_status: "ready" }],
    });

    const { default: TripsPage } = await import("../../app/trips/page");
    render(<TripsPage />);

    await waitFor(() => expect(push).toHaveBeenCalled());

    // The bug: nothing about this render path ever looks at linkSlug --
    // no attempt to join/link the new trip happens.
    expect(getTripBySlug).not.toHaveBeenCalled();
    expect(getOrCreateAdultParticipant).not.toHaveBeenCalled();

    // Instead it silently redirects into whichever trip the account was
    // *already* linked to before -- never the one the user just created.
    expect(push).toHaveBeenCalledWith("/trip/kassandra-2025/settings");
  });
});
