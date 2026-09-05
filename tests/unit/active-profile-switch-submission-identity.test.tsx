// Regression test following the 2026-09-05 review: does switching the
// device's active profile (top-right ProfileMenu, "Schimbă profilul")
// while already sitting on an open question actually change WHO the
// question gets submitted as -- or only the avatar shown in the menu?
//
// 9fcc72e ("Fix catch-up banner to check the active profile, not any
// profile") only ever touched the Home dashboard's catch-up banner
// visibility check (app/trip/[slug]/page.tsx). It never touched the
// actual submission flow in app/trip/[slug]/discover/[slot]/page.tsx.
//
// CONFIRMED, then FIXED (not one of the original 5 hypotheses; found
// while completing this batch, not covered by 9fcc72e or any earlier
// commit): DiscoverPage used to resolve `activeProfile` exactly once,
// inside a mount-time useEffect keyed on [trip, profiles, discoverSlot]
// -- none of which changed when the user switched profile via
// ProfileMenu (a plain localStorage write + local setState in
// ProfileMenu itself, no shared context/event). So a profile switch made
// *after* the question had already loaded submitted under the *previous*
// profile's identity, even though ProfileMenu's own avatar/name already
// showed the new one.
//
// Fixed by making the active profile itself reactive across every
// consumer: setStoredActiveProfileId (src/lib/participant.ts) now
// broadcasts the new id through SWR's global mutate() on a shared key,
// and src/lib/hooks.ts's new useActiveProfileId/useActiveProfile read
// that same key -- so ProfileMenu, DiscoverPage, and
// app/trip/[slug]/catchup/page.tsx (same fix, same pattern) all see a
// switch the instant it happens, not just at their own next mount.
// src/components/BattleFlow.tsx is deliberately NOT part of this fix: it
// has its own explicit in-flow "Alt profil răspunde" picker for passing
// the phone between family members mid-battle (product spec), and
// already re-reads getStoredActiveProfileId() fresh at its own
// handleStart() click time rather than capturing a stale snapshot, so it
// was never the same bug.
//
// This test renders the real ProfileMenu and the real DiscoverPage
// together (both wired to the same jsdom localStorage AND the same real,
// unmocked useActiveProfile/useActiveProfileId + SWR global cache that
// getStoredActiveProfileId/setStoredActiveProfileId actually drive),
// switches the active profile through ProfileMenu's own real "Schimbă
// profilul" UI the way a user would, then answers the question and
// inspects which participantId submitAnswer was actually called with
// -- not just which name is shown. Only the Supabase-touching lib
// functions (@/lib/discover, @/lib/analytics, @/lib/schedule) and the
// network-backed halves of @/lib/hooks/@/lib/trip (useTrip/useProfiles/
// currentTripDay) are mocked at the module boundary; @/lib/participant's
// active-profile storage and the useActiveProfile*/SWR plumbing under
// test are real. No new test dependency (e.g. user-event) is introduced:
// fireEvent from the already-present @testing-library/react is enough
// for plain clicks.
//
// CONTRACT: both tests below are plain `it` and must always pass --
// unlike the A/B/E hypothesis tests (api-account-ownership.test.ts /
// battle-score-divergence.test.ts / trips-page-link-on-existing-login.test.tsx),
// which assert *today's* buggy behavior and are expected to need
// updating once fixed, this file's defect has already been fixed in the
// same batch that added this file's second test, so there is nothing
// left asserting a bug -- only the corrected behavior, as an ordinary
// regression test from here on.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import { mutate } from "swr";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "trip-1", slot: "morning" }),
  useRouter: () => ({ push }),
}));

// Plain object literals, deliberately not cast to their Supabase row
// types (unlike the fixtures in the other test files here, which get
// passed directly into strongly-typed lib functions): these only ever
// flow through vi.mock() factories, whose return shape isn't
// type-checked against the real module, and this file reads `.id` back
// off them directly in its assertions -- a `never` cast would make that
// a type error instead.
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

const trip = { id: "trip-1", slug: "trip-1", duration_days: 5, start_date: null };

// A *stable* array reference, reused across every render -- the real
// useProfiles() is an SWR hook, which caches and returns the same data
// reference until the underlying fetch actually revalidates with new
// data (neither the trip, the device's participants, nor anything else
// this test touches changes during it). A fresh `[parent, child]` array
// literal returned on every call would make every effect keyed on
// `profiles` see it as "changed" on every one of a component's own
// re-renders and re-run needlessly -- this just matches real SWR
// caching behavior, not a special accommodation for this test.
const profiles = [parent, child];

// Partial mock: useTrip/useProfiles are network-backed in the real
// module and need faking, but useActiveProfileId/useActiveProfile (the
// hooks this test actually exercises) are pure localStorage + SWR and
// stay real, via importOriginal.
vi.mock("@/lib/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/hooks")>();
  return {
    ...actual,
    useTrip: () => ({ data: trip, error: undefined }),
    useProfiles: () => ({ data: profiles, error: undefined }),
  };
});

vi.mock("@/lib/trip", () => ({
  currentTripDay: () => 1,
}));

vi.mock("@/lib/schedule", () => ({
  getSlotAvailability: () => ({ status: "open", opensAt: "07:00", closesAt: "11:59" }),
}));

const questionFixture = {
  id: "q1",
  trip_id: "trip-1",
  kind: "discover",
  day_number: 1,
  slot: "morning",
  order_index: 1,
  prompt: "Cine a raspuns?",
  question_type: "single_choice",
  points: 10,
  verified: true,
  published: true,
};

const option = { id: "opt1", question_id: "q1", order_index: 1, label: "Raspunsul A", is_correct: true };

const getMyResponse = vi.fn().mockResolvedValue(null);
const submitAnswer = vi.fn().mockResolvedValue({
  status: "accepted",
  response: {
    id: "resp1",
    participant_id: "unset",
    question_id: "q1",
    selected_option_id: "opt1",
    is_correct: true,
  },
  contributedToTeam: false,
  correctOptionId: "opt1",
});
const getOrAssignExtra = vi.fn().mockResolvedValue(null);

vi.mock("@/lib/discover", () => ({
  getDiscoverQuestion: vi.fn().mockResolvedValue({ question: questionFixture, options: [option], exploreLinks: [] }),
  getMyResponse: (...args: unknown[]) => getMyResponse(...args),
  submitAnswer: (...args: unknown[]) => submitAnswer(...args),
  getOrAssignExtra: (...args: unknown[]) => getOrAssignExtra(...args),
}));

vi.mock("@/lib/analytics", () => ({
  trackEvent: vi.fn().mockResolvedValue(undefined),
}));

async function click(el: HTMLElement) {
  await act(async () => {
    fireEvent.click(el);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  submitAnswer.mockClear();
  getMyResponse.mockClear();
  // useActiveProfileId is real in this file (see the @/lib/hooks partial
  // mock above), so it's backed by SWR's real, module-level global
  // cache -- which otherwise persists across the `it` blocks below,
  // since it isn't reset by @testing-library/react's cleanup(). Wiping
  // every key keeps each test starting from "nothing stored yet",
  // matching the fresh localStorage.clear() above.
  mutate(() => true, undefined, { revalidate: false });
});

// This vitest.config.ts doesn't set test.globals, so @testing-library/react's
// own automatic afterEach(cleanup) (which only registers itself against a
// detected *global* afterEach) never runs -- without this, a second render()
// in the same file leaves the previous test's DOM behind. Every existing
// component test in this repo so far only ever called render() once per
// file, so this gap was never visible before.
afterEach(() => {
  cleanup();
});

describe("active profile switch vs. submission identity", () => {
  it("ProfileMenu's own 'Schimba profilul' UI actually changes the displayed active profile (sanity check for this test's own setup)", async () => {
    const { ProfileMenu } = await import("@/components/ProfileMenu");
    render(<ProfileMenu slug="trip-1" />);

    // Defaults to the first profile (Parent) -- no stored active id yet.
    // (findByText itself throws/fails the test if the text never appears,
    // so its resolution is the presence assertion -- no jest-dom matcher
    // needed, keeping this batch's dependency footprint unchanged.)
    await screen.findByText("Parintele");

    await click(screen.getByRole("button", { name: /profil/i }));
    await click(screen.getByRole("button", { name: /schimb.* profilul/i }));
    await click(screen.getByRole("button", { name: "Copilul" }));

    await screen.findByText("Copilul");
  });

  it("switching the active profile after a question is already open submits the new (switched-to) profile's identity, not the one loaded at mount", async () => {
    const { ProfileMenu } = await import("@/components/ProfileMenu");
    const { default: DiscoverPage } = await import("../../app/trip/[slug]/discover/[slot]/page");

    render(
      <>
        <ProfileMenu slug="trip-1" />
        <DiscoverPage />
      </>,
    );

    // DiscoverPage has mounted and resolved its own activeProfile to the
    // Parent (the only stored/default choice at this point) before any
    // switch happens.
    await screen.findByText("Cine a raspuns?");

    // Now switch the device's active profile to the Child, the same way
    // a user actually would -- through ProfileMenu's real menu, already
    // mounted alongside the still-open question.
    await click(screen.getByRole("button", { name: /profil/i }));
    await click(screen.getByRole("button", { name: /schimb.* profilul/i }));
    await click(screen.getByRole("button", { name: "Copilul" }));
    await screen.findByText("Copilul"); // ProfileMenu's own avatar/name did switch.

    // Answer and submit the still-open question.
    await click(screen.getByRole("button", { name: "Raspunsul A" }));
    await click(screen.getByRole("button", { name: "RĂSPUNDE" }));

    await waitFor(() => expect(submitAnswer).toHaveBeenCalled());

    // The question the user is looking at right now is submitted as
    // whoever ProfileMenu currently shows as active -- the Child, since
    // that's who they just switched to before answering.
    expect(submitAnswer).toHaveBeenCalledWith(child.id, "q1", option.id);
  });
});
