import { supabase } from "./supabase/client";
import type { Database } from "./supabase/types";

// The publicly-readable projection (trips_public,
// 20260906091000_account_hardening.sql) -- every ordinary trip read
// (join flow, Discover/Battle content lookups, etc.) goes through this,
// never the base `trips` table: anon/authenticated no longer have SELECT
// on it directly, since it also carries created_by_account_id/
// created_by_device_id, which the review flagged as internal ownership
// identifiers that shouldn't be in a publicly-readable response.
export type Trip = Database["public"]["Views"]["trips_public"]["Row"];

export async function getTripBySlug(slug: string): Promise<Trip | null> {
  const { data, error } = await supabase
    .from("trips_public")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// "Which trips belong to my account" and "am I an admin" now come from
// app/api/account/trips/route.ts, not a client-side query: which trips
// are "mine" depends on creator_accounts.id, and whether to show every
// trip depends on creator_accounts.is_admin -- both require verifying
// the caller's session server-side (src/lib/security/session.ts) rather
// than trusting a client-supplied accountId or a client-set isAdmin
// flag. See src/lib/creatorAccount.ts's getTripsForCurrentAccount().

// Trip day is 1-indexed and clamped to [1, duration_days] so a stale
// device clock or a trip that hasn't started yet doesn't produce day 0
// or a day past the end of the pilot.
export function currentTripDay(trip: Trip): number {
  if (!trip.start_date) return 1;
  const start = new Date(trip.start_date);
  const today = new Date();
  const diffDays =
    Math.floor(
      (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
        (1000 * 60 * 60 * 24),
    ) + 1;
  return Math.min(Math.max(diffDays, 1), trip.duration_days);
}
