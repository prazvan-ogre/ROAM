// R7 point 6 (operator experience) + point 8's explicit test list:
// "trip pending/failed în UI" and "trip ready disponibilă în fluxul de
// participant". The Dashboard (app/trip/[slug]/page.tsx) has shown a
// pending/generating notice and a failed notice since R7's content_status
// contract landed (see its own "R6:"-labeled comment right above those
// branches), but neither had a direct test before this file -- only
// exercised incidentally, if at all, by tests aimed at other behavior.
// Renders the real TripHomePage component; only useTrip/useProfiles/
// useActiveProfile (network-backed) and OnboardingWizard's own
// dependencies are mocked.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "trip-1" }),
}));

let mockTrip: Record<string, unknown> | undefined;
let mockProfiles: unknown[] | undefined;

vi.mock("@/lib/hooks", () => ({
  useTrip: () => ({ data: mockTrip, error: undefined }),
  useProfiles: () => ({ data: mockProfiles, error: undefined, mutate: vi.fn() }),
  useActiveProfile: () => (mockProfiles && mockProfiles.length > 0 ? mockProfiles[0] : undefined),
}));

// Only reached once a trip's own content_status === "ready" and it has
// zero profiles on this device -- the ready-trip participant-flow case
// below hits this branch (OnboardingWizard's intro step), same as a real
// first-time visitor to a published trip.
vi.mock("@/lib/participant", () => ({
  getOrCreateAdultParticipant: vi.fn(),
  addChildProfile: vi.fn(),
  getStoredActiveProfileId: vi.fn(() => null),
}));

vi.mock("@/lib/prize", () => ({
  getPrizeStatus: vi.fn().mockResolvedValue({ options: [], votingOpen: false, winner: null, closesAt: null }),
  castPrizeVote: vi.fn(),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

const baseTrip = {
  id: "trip-1",
  slug: "trip-1",
  name: "Praga 2026",
  language: "ro",
  duration_days: 5,
  start_date: "2026-06-01",
  timezone: "Europe/Prague",
  destination: "Praga",
  location_info: null,
  is_active: true,
  is_demo: false,
  created_at: "2026-01-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
  mockTrip = undefined;
  mockProfiles = undefined;
});

describe("R7: Dashboard shows honest status for a trip that isn't published yet", () => {
  it("a pending trip shows a clear 'still being prepared' notice, never the join wizard or game content", async () => {
    mockTrip = { ...baseTrip, content_status: "pending" };
    mockProfiles = [];

    const { default: TripHomePage } = await import("../../app/trip/[slug]/page");
    render(<TripHomePage />);

    expect(await screen.findByText(/Pregătim Praga 2026/i)).toBeTruthy();
    expect(screen.getByText(/în lucru. Revino mai târziu/i)).toBeTruthy();
    // Never claims questions are ready, and never shows the join flow for
    // content that doesn't exist yet.
    expect(screen.queryByText(/Cum te numești/i)).toBeNull();
  });

  it("a generating trip shows the same honest in-progress notice", async () => {
    mockTrip = { ...baseTrip, content_status: "generating" };
    mockProfiles = [];

    const { default: TripHomePage } = await import("../../app/trip/[slug]/page");
    render(<TripHomePage />);

    expect(await screen.findByText(/Pregătim Praga 2026/i)).toBeTruthy();
  });

  it("a failed trip tells the participant to contact the administrator instead of pretending it's ready", async () => {
    mockTrip = { ...baseTrip, content_status: "failed" };
    mockProfiles = [];

    const { default: TripHomePage } = await import("../../app/trip/[slug]/page");
    render(<TripHomePage />);

    expect(await screen.findByText(/Pregătirea conținutului a fost întreruptă/i)).toBeTruthy();
    expect(screen.getByText(/Contactează administratorul/i)).toBeTruthy();
    expect(screen.queryByText(/Cum te numești/i)).toBeNull();
  });

  it("a ready trip with no profile on this device shows the real join wizard, not a pending/failed notice", async () => {
    mockTrip = { ...baseTrip, content_status: "ready" };
    mockProfiles = [];

    const { default: TripHomePage } = await import("../../app/trip/[slug]/page");
    render(<TripHomePage />);

    expect(await screen.findByText(/Vacanța asta explorăm Praga 2026/i)).toBeTruthy();
    expect(screen.queryByText(/Pregătim Praga 2026/i)).toBeNull();
    expect(screen.queryByText(/Pregătirea conținutului a fost întreruptă/i)).toBeNull();
  });
});
