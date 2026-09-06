// R5 requirement: a creator who isn't authenticated yet must see, in the
// UI, the consequence of deferring account association ("Sari peste")
// -- not just a bare skip link. Also verifies the "Ai deja cont?"
// chooser (R5-fix4) now appears for a brand-new, not-yet-authenticated
// visitor arriving via ?link=<slug> right after creating a trip.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const searchParamsGet = vi.fn((key: string) => (key === "link" ? "corfu-2027-ab12" : null));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: searchParamsGet }),
}));

vi.mock("@/lib/creatorAccount", () => ({
  getStoredAccountId: () => null, // not authenticated yet
  authenticateCreatorAccount: vi.fn(),
  getTripsForCurrentAccount: vi.fn(),
  clearStoredAccountId: vi.fn(),
  linkTripToCurrentAccount: vi.fn(),
}));

afterEach(() => {
  cleanup();
});

describe("R5: /trips explains the consequence of deferring account association", () => {
  it("shows the chooser and an explanation next to 'Sari peste' before any account choice is made", async () => {
    const { default: TripsPage } = await import("../../app/trips/page");
    render(<TripsPage />);

    await screen.findByText("Ai deja un cont?");
    expect(screen.getByRole("link", { name: "Sari peste" })).toBeTruthy();
    expect(
      screen.getByText(/Dacă amâni acum, călătoria rămâne doar pe acest dispozitiv/i),
    ).toBeTruthy();
  });
});
