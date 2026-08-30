import { supabase } from "./supabase/client";
import type { Database } from "./supabase/types";

export type Trip = Database["public"]["Tables"]["trips"]["Row"];

export async function getTripBySlug(slug: string): Promise<Trip | null> {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// "Călătoriile mele" (app/trips/page.tsx) -- trips are publicly readable
// (docs/DATABASE.md "Security model"), so this is a plain filtered read
// with the anon key, no server route needed.
export async function getTripsForAccount(accountId: string): Promise<Trip[]> {
  const { data, error } = await supabase
    .from("trips")
    .select("*")
    .eq("created_by_account_id", accountId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

// Admin view of app/trips/page.tsx (creator_accounts.is_admin) -- trips
// are publicly readable, so this is the same plain read as
// getTripsForAccount, just without the account filter.
export async function getAllTrips(): Promise<Trip[]> {
  const { data, error } = await supabase.from("trips").select("*").order("created_at", { ascending: false });

  if (error) throw error;
  return data ?? [];
}

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
