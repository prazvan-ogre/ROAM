import { supabase } from "./supabase/client";
import { getDeviceId, ensureAuthSession } from "./device";
import type { Database, ParticipantRole } from "./supabase/types";

export type Participant = Database["public"]["Tables"]["participants"]["Row"];

// A child has no device/session of its own, so its row shares the
// managing adult's device_id. That means "every participant on this
// device" is just one query -- see docs/DATABASE.md.
export async function listProfilesForDevice(tripId: string): Promise<Participant[]> {
  const deviceId = getDeviceId();
  const { data, error } = await supabase
    .from("participants")
    .select("*")
    .eq("trip_id", tripId)
    .eq("device_id", deviceId)
    .order("role", { ascending: true }) // 'adult' < 'child' alphabetically, so adult sorts first
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data ?? [];
}

// accountId links this participant to the "Călătoriile mele" account it
// belongs to (only passed by the post-login auto-join in app/trips/
// page.tsx) -- Setări > Utilizatori reads it back to show that account's
// phone/PIN fields only under the profile that actually owns them,
// instead of under any adult profile just because *some* account is
// logged into this device (see 20260901100000_participant_account_link.sql).
export async function getOrCreateAdultParticipant(
  tripId: string,
  displayName: string,
  accountId?: string,
): Promise<Participant> {
  const deviceId = getDeviceId();

  const { data: existing, error: selectError } = await supabase
    .from("participants")
    .select("*")
    .eq("trip_id", tripId)
    .eq("device_id", deviceId)
    .eq("role", "adult")
    .maybeSingle();

  if (selectError) throw selectError;

  if (existing) {
    // Deliberately never sets auth_user_id here, even when this row is
    // still a pre-R1 legacy one (auth_user_id null): matching on
    // device_id -- a plain client-asserted string, not a credential --
    // would be exactly the "claim an old profile via a public/
    // localStorage identifier" migration R1 was written to avoid. A
    // legacy row stays legacy (openly grandfathered) until whatever
    // future, explicit decision re-establishes its ownership.
    const update: { last_seen_at: string; account_id?: string } = { last_seen_at: new Date().toISOString() };
    if (accountId) update.account_id = accountId;
    const { data: updated, error: updateError } = await supabase
      .from("participants")
      .update(update)
      .eq("id", existing.id)
      .select()
      .single();
    if (updateError) throw updateError;
    return updated;
  }

  const authUserId = await ensureAuthSession();
  const { data: created, error: insertError } = await supabase
    .from("participants")
    .insert({
      trip_id: tripId,
      device_id: deviceId,
      display_name: displayName,
      role: "adult" as ParticipantRole,
      account_id: accountId ?? null,
      auth_user_id: authUserId,
    })
    .select()
    .single();

  if (insertError) throw insertError;
  return created;
}

export interface ParticipantCounts {
  adults: number;
  children: number;
}

// Trip-wide counts for the dashboard (every device, not just this one) --
// participants is publicly readable (docs/DATABASE.md), so this is a
// plain count query, no RPC needed.
export async function getParticipantCounts(tripId: string): Promise<ParticipantCounts> {
  const [{ count: adults, error: adultsError }, { count: children, error: childrenError }] =
    await Promise.all([
      supabase
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", tripId)
        .eq("role", "adult"),
      supabase
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("trip_id", tripId)
        .eq("role", "child"),
    ]);

  if (adultsError) throw adultsError;
  if (childrenError) throw childrenError;

  return { adults: adults ?? 0, children: children ?? 0 };
}

export async function updateParticipant(
  id: string,
  displayName: string,
  role: ParticipantRole,
  age: number | null,
): Promise<Participant> {
  const { data, error } = await supabase
    .from("participants")
    .update({ display_name: displayName, role, age })
    .eq("id", id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteParticipant(id: string): Promise<void> {
  const { error } = await supabase.from("participants").delete().eq("id", id);
  if (error) throw error;
}

// managingAdultId is optional: the onboarding wizard lets a child be the
// first (and possibly only) participant on their own device, with no
// adult around yet to manage them (child_needs_manager was relaxed for
// exactly this -- see the onboarding_wizard migration). age is optional
// too (product owner request) -- a family may not want to enter it.
const ACTIVE_PROFILE_KEY_PREFIX = "roam_active_profile_";

// The "Cine răspunde?" picker in Discover/Battle/Catchup lets anyone on
// this device answer a given question, but has no memory of who to
// default to -- product owner request: the Home page lets this device's
// user pick, once, which of this device's own profiles they mean to use,
// so it's clear at a glance whose answers are being tracked when a
// device has more than one (e.g. a parent's phone with a child's profile
// too). Scoped per trip, same as the device id itself.
export function getStoredActiveProfileId(tripId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY_PREFIX + tripId);
}

export function setStoredActiveProfileId(tripId: string, participantId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_PROFILE_KEY_PREFIX + tripId, participantId);
}

export async function addChildProfile(
  tripId: string,
  displayName: string,
  age: number | null,
  managingAdultId?: string,
): Promise<Participant> {
  const deviceId = getDeviceId();
  // Same auth session as the managing adult (same device, same
  // signInAnonymously() call) -- a child never signs in separately.
  const authUserId = await ensureAuthSession();

  const { data, error } = await supabase
    .from("participants")
    .insert({
      trip_id: tripId,
      device_id: deviceId,
      display_name: displayName,
      role: "child" as ParticipantRole,
      age,
      managed_by_participant_id: managingAdultId ?? null,
      auth_user_id: authUserId,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
