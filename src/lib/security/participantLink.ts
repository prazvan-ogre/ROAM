import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Batch 2 (2026-09-05 review, R1 continued): the only place
// participants.account_id is ever written now. Previously
// getOrCreateAdultParticipant (src/lib/participant.ts) set it directly
// from the browser's anon-key client, with accountId coming straight out
// of a JSON response body -- nothing stopped a direct Supabase call from
// passing ANY account id at all (self-granting membership in a creator
// account that isn't yours). account_id is now locked down at the
// database layer too (20260907091000_batch2_participant_lockdown.sql:
// never settable via UPDATE, must be null at INSERT) -- this is the
// service-role-only counterpart that actually sets it, called from
// app/api/account/route.ts and app/api/account/link-trip/route.ts and
// app/api/account/link-participant/route.ts, always after BOTH the
// creator account's own session (phone+PIN, verified server-side) AND
// the calling device's own anonymous participant session (Authorization
// bearer token, verified via resolveBearerAuthUserId) have been
// confirmed -- never from a bare client-supplied value.
export async function linkCreatorParticipant(
  admin: SupabaseClient<Database>,
  params: { tripId: string; deviceId: string; authUserId: string; accountId: string; displayName: string },
): Promise<void> {
  const { tripId, deviceId, authUserId, accountId, displayName } = params;

  const { data: existing, error: selectError } = await admin
    .from("participants")
    .select("id, account_id")
    .eq("trip_id", tripId)
    .eq("device_id", deviceId)
    .eq("role", "adult")
    .maybeSingle();
  if (selectError) throw selectError;

  if (existing) {
    // Never overwrites an existing different link -- same "don't clobber
    // a legitimate prior link" caution as the trips.created_by_account_id
    // linking this mirrors.
    if (!existing.account_id) {
      const { error } = await admin
        .from("participants")
        .update({ account_id: accountId, last_seen_at: new Date().toISOString() })
        .eq("id", existing.id)
        .is("account_id", null);
      if (error) throw error;
    }
    return;
  }

  const { error: insertError } = await admin.from("participants").insert({
    trip_id: tripId,
    device_id: deviceId,
    display_name: displayName,
    role: "adult",
    account_id: accountId,
    auth_user_id: authUserId,
  });
  if (insertError) throw insertError;
}
