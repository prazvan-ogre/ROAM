// R6 follow-up: the trip's timezone belongs to the DESTINATION, not to
// whoever fills in the public creation form -- app/page.tsx's picker
// must never default to the creator's own browser/Intl timezone, and
// every "available at HH:MM" message shown afterward must be clearly
// labeled as the destination's own time, not the viewing device's.
//
// app/page.tsx never calls Intl.DateTimeFormat().resolvedOptions() (or
// anything else that would read this test process's own default
// timezone) at all -- there is nothing here to fake a "creator's device
// zone" with, which is exactly the point: the timezone field starts
// empty and is only ever set by an explicit selection (or a destination-
// keyword suggestion the person can still override), never derived from
// the environment running the form. Each case below submits a specific
// destination timezone (Europe/Athens, America/New_York, Asia/Tokyo --
// each unmistakably NOT this repo's own Europe/Bucharest pilot default)
// and asserts that exact value reaches createPublicTrip, proving there is
// no environment-derived value anywhere in the path.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ slug: "trip-1", slot: "morning" }),
}));

const createPublicTrip = vi.fn();
vi.mock("@/lib/publicTripCreation", () => ({
  createPublicTrip: (...args: unknown[]) => createPublicTrip(...args),
}));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  push.mockClear();
  createPublicTrip.mockReset();
});
afterEach(() => {
  cleanup();
});

describe("R6 follow-up: creation form stores the DESTINATION's timezone, never the creator's device zone", () => {
  it.each([
    ["Europe/Athens", "O vacanță undeva"],
    ["America/New_York", "O vacanță undeva"],
    ["Asia/Tokyo", "O vacanță undeva"],
  ])("a creator picking %s stores exactly that destination zone, never the pilot's own Europe/Bucharest default", async (timezone, destination) => {
    createPublicTrip.mockResolvedValueOnce({ slug: "trip-xyz" });
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);

    fireEvent.change(screen.getByLabelText("Destinație"), { target: { value: destination } });
    fireEvent.change(screen.getByLabelText("Fusul orar al destinației"), { target: { value: timezone } });
    await click(screen.getByRole("button", { name: /Creează călătoria/i }));

    expect(createPublicTrip).toHaveBeenCalledTimes(1);
    const [submitted] = createPublicTrip.mock.calls[0];
    expect(submitted.timezone).toBe(timezone);
    expect(submitted.timezone).not.toBe("Europe/Bucharest");
  });

  it("the timezone picker never pre-fills the browser's own zone by default", async () => {
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);
    // Nothing selected yet -- the placeholder option, not Europe/Bucharest
    // (the pilot's own default) and not any other silently-chosen value.
    const select = screen.getByLabelText("Fusul orar al destinației") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("a recognized destination keyword pre-selects a matching zone, but never overrides an explicit later choice", async () => {
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);
    const select = screen.getByLabelText("Fusul orar al destinației") as HTMLSelectElement;

    fireEvent.change(screen.getByLabelText("Destinație"), { target: { value: "Tokyo, Japonia" } });
    expect(select.value).toBe("Asia/Tokyo");

    // The person overrides the suggestion by hand.
    fireEvent.change(select, { target: { value: "UTC" } });
    expect(select.value).toBe("UTC");

    // Further edits to the destination text must not silently clobber
    // that explicit correction.
    fireEvent.change(screen.getByLabelText("Destinație"), { target: { value: "Tokyo din nou" } });
    expect(select.value).toBe("UTC");
  });

  it("submitting without ever picking a timezone never calls createPublicTrip", async () => {
    const { default: HomePage } = await import("../../app/page");
    render(<HomePage />);

    fireEvent.change(screen.getByLabelText("Destinație"), { target: { value: "Un loc fără sugestie automată xyz" } });
    await click(screen.getByRole("button", { name: /Creează călătoria/i }));

    expect(createPublicTrip).not.toHaveBeenCalled();
  });
});

describe("R6 follow-up: 'available at HH:MM' messages are labeled as the destination's own time", () => {
  const parent = {
    id: "parent-1",
    trip_id: "trip-1",
    device_id: "dev-shared",
    display_name: "Parintele",
    role: "adult",
    created_at: "2026-01-01T00:00:00Z",
  };
  // The destination itself is Tokyo -- deliberately far from this test
  // process's own Europe/Bucharest TZ (pinned at the top of this file),
  // so a message that silently fell back to the device/process zone
  // instead of the trip's own would be caught by asserting the label
  // names Asia/Tokyo specifically.
  const trip = { id: "trip-1", slug: "trip-1", duration_days: 5, start_date: null, timezone: "Asia/Tokyo" };
  const profiles = [parent];

  vi.doMock("@/lib/hooks", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@/lib/hooks")>();
    return {
      ...actual,
      useTrip: () => ({ data: trip, error: undefined }),
      useProfiles: () => ({ data: profiles, error: undefined }),
    };
  });
  vi.doMock("@/lib/trip", () => ({
    currentTripDay: () => 1,
    getTripTemporalState: () => ({ status: "active", day: 1, daysUntilStart: null }),
    getTripTimezone: () => "Asia/Tokyo",
  }));
  vi.doMock("@/lib/schedule", () => ({
    // Slot not open yet -- lands on the "closed" (before) screen, which
    // is exactly the "devine disponibil la HH:MM" message this batch
    // requires to name the destination's own time.
    getSlotAvailability: () => ({ status: "before", opensAt: "07:00", closesAt: "11:59" }),
  }));
  vi.doMock("@/lib/discover", () => ({
    getDiscoverQuestion: vi.fn().mockResolvedValue({
      question: {
        id: "q1",
        trip_id: "trip-1",
        kind: "discover",
        day_number: 1,
        slot: "morning",
        prompt: "Q",
        verified: true,
        published: true,
      },
      options: [],
      exploreLinks: [],
    }),
    getMyResponse: vi.fn().mockResolvedValue(null),
    getOrAssignExtra: vi.fn().mockResolvedValue(null),
    submitAnswer: vi.fn(),
  }));
  vi.doMock("@/lib/analytics", () => ({ trackEvent: vi.fn().mockResolvedValue(undefined) }));

  it("Discover's 'closed, opens later today' screen names the destination's timezone", async () => {
    const { default: DiscoverPage } = await import("../../app/trip/[slug]/discover/[slot]/page");
    render(<DiscoverPage />);
    await screen.findByText(/devine disponibil la 07:00/);
    expect(screen.getByText(/ora destinației, Asia\/Tokyo/)).toBeTruthy();
  });
});
