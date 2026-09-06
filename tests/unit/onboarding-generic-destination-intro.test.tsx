// R7 point 5 (destinații noi): OnboardingWizard's intro step used to show
// hardcoded Halkidiki/Poseidon mythology text for every trip, regardless of
// actual destination. It now shows trip.location_info when the trip has
// one set, and a neutral, honest fallback ("O nouă aventură ne așteaptă...")
// when it doesn't -- never inventing destination-specific facts. See the
// component's own "R7:" comment at its intro step.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OnboardingWizard } from "@/components/OnboardingWizard";

vi.mock("@/lib/participant", () => ({
  getOrCreateAdultParticipant: vi.fn(),
  addChildProfile: vi.fn(),
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
  name: "Praga",
  language: "ro",
  duration_days: 5,
  start_date: null,
  timezone: "Europe/Prague",
  destination: "Praga",
  content_status: "ready" as const,
  is_active: true,
  is_demo: false,
  created_at: "2026-01-01T00:00:00Z",
};

afterEach(() => {
  cleanup();
});

describe("R7: OnboardingWizard intro -- destination content, no hardcoded Kassandra text", () => {
  it("a new destination with no location_info gets the neutral fallback, not Kassandra/Halkidiki mythology", async () => {
    render(<OnboardingWizard trip={{ ...baseTrip, location_info: null }} onComplete={vi.fn()} />);

    expect(await screen.findByText(/Vacanța asta explorăm Praga/i)).toBeTruthy();
    expect(screen.getByText(/O nouă aventură ne așteaptă/i)).toBeTruthy();
    expect(screen.queryByText(/Poseidon/i)).toBeNull();
    expect(screen.queryByText(/Halkidiki/i)).toBeNull();
    expect(screen.queryByText(/Kassandra/i)).toBeNull();
  });

  it("a trip with its own location_info shows that text verbatim instead of the fallback", async () => {
    const locationInfo = "Praga te așteaptă cu podurile ei istorice și ceasul astronomic din Piața Orologiului.";
    render(<OnboardingWizard trip={{ ...baseTrip, location_info: locationInfo }} onComplete={vi.fn()} />);

    expect(await screen.findByText(locationInfo)).toBeTruthy();
    expect(screen.queryByText(/O nouă aventură ne așteaptă/i)).toBeNull();
  });
});
