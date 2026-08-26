import { supabase } from "./supabase/client";
import { getDeviceId } from "./device";
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

export async function getOrCreateAdultParticipant(
  tripId: string,
  displayName: string,
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
    await supabase
      .from("participants")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing;
  }

  const { data: created, error: insertError } = await supabase
    .from("participants")
    .insert({
      trip_id: tripId,
      device_id: deviceId,
      display_name: displayName,
      role: "adult" as ParticipantRole,
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
export async function addChildProfile(
  tripId: string,
  displayName: string,
  age: number | null,
  managingAdultId?: string,
): Promise<Participant> {
  const deviceId = getDeviceId();

  const { data, error } = await supabase
    .from("participants")
    .insert({
      trip_id: tripId,
      device_id: deviceId,
      display_name: displayName,
      role: "child" as ParticipantRole,
      age,
      managed_by_participant_id: managingAdultId ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
