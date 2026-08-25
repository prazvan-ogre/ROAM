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

export async function addChildProfile(
  tripId: string,
  managingAdultId: string,
  displayName: string,
  age: number,
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
      managed_by_participant_id: managingAdultId,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
