import { mutate } from "swr";
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

// participants.account_id (which "Călătoriile mele" account this
// participant belongs to, if any) is no longer settable from here at all
// (batch 2, 2026-09-05 review): a direct anon-key call could previously
// pass any accountId at all, self-granting membership in an account that
// isn't the caller's. It's now stamped server-side only, after verifying
// both the creator account's own session and this device's anonymous
// session -- see src/lib/security/participantLink.ts, called from
// app/api/account/route.ts and app/api/account/link-trip/route.ts.
export async function getOrCreateAdultParticipant(tripId: string, displayName: string): Promise<Participant> {
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
    const { data: updated, error: updateError } = await supabase
      .from("participants")
      .update({ last_seen_at: new Date().toISOString() })
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
// The SWR cache key src/lib/hooks.ts's useActiveProfileId()/useActiveProfile()
// read this same value through -- exported so setStoredActiveProfileId
// below can broadcast a change to it on that exact key.
export function activeProfileSwrKey(tripId: string) {
  return ["activeProfileId", tripId] as const;
}

export function getStoredActiveProfileId(tripId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_PROFILE_KEY_PREFIX + tripId);
}

export function setStoredActiveProfileId(tripId: string, participantId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_PROFILE_KEY_PREFIX + tripId, participantId);
  // A plain localStorage write triggers no re-render on its own, and the
  // browser's own "storage" event never fires in the same tab that made
  // the change -- so without this, every already-mounted
  // useActiveProfileId(tripId) consumer (ProfileMenu itself aside, which
  // updates its own local state directly) would keep showing/using
  // whatever it read at its own mount time until it happened to
  // unmount/remount. This pushes the new value into SWR's cache on the
  // same key those hooks read, so they all pick it up immediately.
  mutate(activeProfileSwrKey(tripId), participantId, { revalidate: false });
}

// R4 (2026-09-06 batch): a lost confirmation (the insert commits, but the
// response never reaches the caller -- a dropped connection, a tab
// backgrounded mid-request) used to mean a retry from the onboarding
// wizard or Setări's "Adaugă profil copil" created a second child with
// the same name. There is no natural unique key across (trip, device,
// name) that would also still legitimately allow two DIFFERENT children
// sharing a name (twins), so this only recognizes an exact match created
// by this same device in the last 15 seconds as "this is my own retry",
// never as a general rule against same-named children. App-level check,
// no migration or schema change.
const RETRY_DEDUP_WINDOW_MS = 15_000;

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

  let recentMatchQuery = supabase
    .from("participants")
    .select("*")
    .eq("trip_id", tripId)
    .eq("device_id", deviceId)
    .eq("role", "child")
    .eq("display_name", displayName)
    .gte("created_at", new Date(Date.now() - RETRY_DEDUP_WINDOW_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  recentMatchQuery = age === null ? recentMatchQuery.is("age", null) : recentMatchQuery.eq("age", age);
  const { data: recentMatch, error: recentMatchError } = await recentMatchQuery.maybeSingle();
  if (recentMatchError) throw recentMatchError;
  if (recentMatch) return recentMatch;

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
