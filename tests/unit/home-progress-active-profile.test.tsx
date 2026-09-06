// Regression test for the R2-4/R2-5 defect confirmed during the
// 2026-09-05 review's independent-reviewer pass (closure batch):
// app/trip/[slug]/page.tsx used to resolve the active profile once per
// effect run via a plain getStoredActiveProfileId() read
// (resolveActiveProfile), keyed on [trip, profiles, loadSlotStatus,
// loadBattleStatus, loadCatchUpStatus] -- none of which change on a
// same-device ProfileMenu switch. So switching from a profile who'd
// already answered today to one who hadn't kept showing the first
// profile's "completed" checkmarks under the second profile's own name,
// until the page was remounted.
//
// Fixed by reading the active profile through the same reactive
// useActiveProfile hook Discover/Catchup already used, and adding it to
// the status-loading effect's dependency array, so a ProfileMenu switch
// re-scopes every per-slot/per-battle "completed" check to the newly
// active profile without needing a remount.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { mutate } from "swr";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "trip-1" }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/trip/trip-1",
}));

const parent = {
  id: "parent-1",
  trip_id: "trip-1",
  device_id: "dev-shared",
  display_name: "Parintele",
  role: "adult",
  created_at: "2026-01-01T00:00:00Z",
};
const child = {
  id: "child-1",
  trip_id: "trip-1",
  device_id: "dev-shared",
  display_name: "Copilul",
  role: "child",
  created_at: "2026-01-01T00:00:01Z",
};
const trip = {
  id: "trip-1",
  slug: "trip-1",
  duration_days: 5,
  start_date: null,
  content_status: "ready",
  name: "Test Trip",
  location_info: null,
};
const profiles = [parent, child];

vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useTrip: () => ({ data: trip, error: undefined }),
    useProfiles: () => ({ data: profiles, error: undefined, mutate: vi.fn() }),
  };
});
vi.mock("@/lib/trip", () => ({ currentTripDay: () => 1 }));
vi.mock("@/lib/schedule", () => ({
  getSlotAvailability: () => ({ status: "open", opensAt: "07:00", closesAt: "11:59" }),
  getNextWindowOpening: () => ({ slot: "morning", opensAt: new Date(Date.now() + 3600_000) }),
}));
vi.mock("@/lib/battle", () => ({
  getDailyBattle: vi.fn().mockResolvedValue(null),
  getFinalBattle: vi.fn().mockResolvedValue(null),
}));
vi.mock("@/lib/discover", () => ({
  getCatchUpQuestions: vi.fn().mockResolvedValue([]),
}));

// Fixture: Parent has answered the morning question; Child has not.
const morningQuestionId = "q-morning-1";
vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (..._selectArgs: unknown[]) => {
        const isCountQuery = _selectArgs[1] && (_selectArgs[1] as { count?: string }).count === "exact";
        if (isCountQuery) {
          let filters: Record<string, unknown> = {};
          const countChain = {
            eq: (col: string, val: unknown) => {
              filters = { ...filters, [col]: val };
              return countChain;
            },
            then: (resolve: (v: { count: number }) => void) => {
              const matchesQuestion = filters["question_id"] === morningQuestionId;
              const matchesParticipant = filters["participant_id"] === parent.id;
              resolve({ count: matchesQuestion && matchesParticipant ? 1 : 0 });
            },
          };
          return countChain;
        }
        let slotFilter: unknown;
        const chain = {
          eq: (col: string, val: unknown) => {
            if (col === "slot") slotFilter = val;
            return chain;
          },
          maybeSingle: async () =>
            table === "questions" && slotFilter === "morning" ? { data: { id: morningQuestionId } } : { data: null },
        };
        return chain;
      },
    }),
  },
}));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mutate(() => true, undefined, { revalidate: false });
});

describe("R2 regression: Home progress re-scopes to the active profile without a remount", () => {
  it("switching from Parent (answered) to Child (not answered) updates the morning row without navigating away", async () => {
    const { ProfileMenu } = await import("@/components/ProfileMenu");
    const { default: TripHomePage } = await import("../../app/trip/[slug]/page");

    render(
      <>
        <ProfileMenu slug="trip-1" />
        <TripHomePage />
      </>,
    );

    await screen.findByText("Parintele");
    // Parent already answered -- the row must NOT offer "Descoperă".
    await waitFor(() => expect(screen.queryByText("Descoperă")).toBeNull());

    await click(screen.getByRole("button", { name: /profil/i }));
    await click(screen.getByRole("button", { name: /schimb.* profilul/i }));
    await click(screen.getByRole("button", { name: "Copilul" }));
    await screen.findByText("Copilul");

    // Child hasn't answered -- without any remount, the row must now
    // offer "Descoperă" again, scoped to Child.
    await waitFor(() => expect(screen.queryByText("Descoperă")).not.toBeNull());
  });
});
