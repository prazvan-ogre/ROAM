import useSWR from "swr";
import { getTripBySlug, type Trip } from "./trip";
import { listProfilesForDevice, type Participant } from "./participant";

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
