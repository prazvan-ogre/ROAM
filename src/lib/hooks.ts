import useSWR from "swr";
import { getTripBySlug, type Trip } from "./trip";
import { listProfilesForDevice, getStoredActiveProfileId, activeProfileSwrKey, type Participant } from "./participant";

// Every trip-scoped page fetches the same trip row on mount, and
// ProfileMenu (mounted alongside all of them via app/trip/[slug]/layout.tsx)
// independently fetches it again -- previously two network round trips for
// the same data on every single page load, repeated on every in-app
// navigation between trip pages. Keying on ["trip", slug] puts every
// consumer on the same SWR cache entry: the first caller fetches, anyone
// else mounting within the deduping window reuses that in-flight request,
// and navigating back to an already-visited trip page reads from cache
// instantly instead of re-fetching.
export function useTrip(slug: string | undefined) {
  return useSWR<Trip | null>(slug ? ["trip", slug] : null, () => getTripBySlug(slug as string));
}

// Same duplication for "every profile on this device for this trip" --
// shared across ProfileMenu and whichever page also needs the list.
export function useProfiles(tripId: string | undefined) {
  return useSWR<Participant[]>(tripId ? ["profiles", tripId] : null, () =>
    listProfilesForDevice(tripId as string),
  );
}

// Reactive wrapper around getStoredActiveProfileId's localStorage value.
// ProfileMenu's "Schimbă profilul" writes through setStoredActiveProfileId
// (src/lib/participant.ts), which broadcasts the new id via SWR's global
// mutate() on this same key -- so every other mounted consumer of this
// hook picks the switch up immediately, instead of each one only ever
// reading it once at its own mount time (the bug behind hypothesis D's
// sibling issue: switching profile after a Discover/Catchup question was
// already open kept submitting under the profile resolved at mount,
// even though ProfileMenu's own avatar had already moved on).
export function useActiveProfileId(tripId: string | undefined) {
  return useSWR<string | null>(tripId ? activeProfileSwrKey(tripId) : null, () =>
    getStoredActiveProfileId(tripId as string),
  );
}

// Resolves the actual Participant the active-profile id currently points
// to, falling back to the first device profile (typically the account
// holder/trip creator) if none has been explicitly chosen yet. Returns
// null only while profiles hasn't loaded/is empty -- callers that already
// gate on a non-empty profiles list get a non-null Participant back.
export function useActiveProfile(
  tripId: string | undefined,
  profiles: Participant[] | undefined,
): Participant | null {
  const { data: activeId } = useActiveProfileId(tripId);
  if (!profiles || profiles.length === 0) return null;
  return profiles.find((p) => p.id === activeId) ?? profiles[0];
}
