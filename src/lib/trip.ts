import { supabase } from "./supabase/client";
import type { Database } from "./supabase/types";
import { DEFAULT_TRIP_TIMEZONE, daysBetweenDateOnly, getZonedDateParts, parseDateOnly } from "./timezone";

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

// R6: which IANA zone a trip's own calendar day/hour is computed in.
// trips.timezone is nullable -- every trip created before this feature
// (20260907140000_r6_trip_timezone_and_lifecycle.sql) has it null, and is
// deliberately NOT backfilled (see that migration's header: there is no
// way to know, after the fact, what zone a past trip's participants were
// actually standing in). DEFAULT_TRIP_TIMEZONE is the documented runtime
// fallback for that case -- 'ro' is already the only hardcoded language
// (app/api/trips/create/route.ts), so Europe/Bucharest is the reasonable
// default for a pre-R6 row, not an invented one; a specific already-ended
// trip that needs to be read in a different zone can have one stamped
// directly (any value, including 'UTC') without this function changing.
// Every trip created after this migration always has an explicit value.
export function getTripTimezone(trip: Trip): string {
  return trip.timezone ?? DEFAULT_TRIP_TIMEZONE;
}

export type TripLifecycleStatus = "scheduled" | "active" | "ended";

export interface TripTemporalState {
  status: TripLifecycleStatus;
  // 1-indexed, clamped to [1, duration_days] -- meaningful as "which
  // day's content to show" while active, and as "which day it ended on"
  // once ended; while scheduled there is no current trip day yet, so
  // this reads 1 as a neutral placeholder (callers gating on status
  // "scheduled" should not display it as a day number).
  day: number;
  // Only set while scheduled: how many calendar days remain (in the
  // trip's own zone) until start_date. 1 means "starts tomorrow", 0 is
  // never returned (day 0 relative to start is already "active").
  daysUntilStart: number | null;
}

// The single source of truth for "is this trip scheduled/active/ended,
// and which day is it" -- computed in the TRIP's own IANA zone (see
// getTripTimezone above), never the device's. Mirrors the server-side
// computation in record_answer() (20260907140000_r6_trip_timezone_and_
// lifecycle.sql) exactly, so the UI and the RPC that actually enforces
// eligibility never disagree about which state the trip is in.
export function getTripTemporalState(trip: Trip, now: Date = new Date()): TripTemporalState {
  if (!trip.start_date) {
    // No start date on record at all -- there is no schedule to enforce,
    // so the trip has always behaved as permanently "active" (this
    // matches the pre-R6 behavior for such rows, since it was never
    // possible to detect "not started yet"/"ended" without one).
    return { status: "active", day: 1, daysUntilStart: null };
  }

  const timeZone = getTripTimezone(trip);
  const todayParts = getZonedDateParts(now, timeZone);
  const startParts = parseDateOnly(trip.start_date);
  const rawDay = daysBetweenDateOnly(todayParts, startParts) + 1;

  if (rawDay < 1) {
    return { status: "scheduled", day: 1, daysUntilStart: 1 - rawDay };
  }
  if (rawDay > trip.duration_days) {
    return { status: "ended", day: trip.duration_days, daysUntilStart: null };
  }
  return { status: "active", day: rawDay, daysUntilStart: null };
}

// Back-compat convenience wrapper -- most call sites only ever need "which
// day's content to show" and don't care about the scheduled/ended
// distinction (they're already gated elsewhere, e.g. behind "has joined
// this trip"). Callers that DO need to tell scheduled/active/ended apart
// (the Dashboard, and direct-navigation guards on Discover/Battle/Final)
// should call getTripTemporalState directly instead.
export function currentTripDay(trip: Trip, now: Date = new Date()): number {
  return getTripTemporalState(trip, now).day;
}
