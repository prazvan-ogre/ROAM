import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// R5 (călătorii nou-create asociate corect creatorului): the only proof
// of "this trip is mine" that's ever trusted for linking it to a
// creator_accounts row is trips.created_by_auth_user_id -- stamped
// server-side at creation time (app/api/trips/create/route.ts) from a
// bearer token verified against Supabase Auth, exactly like
// participants.auth_user_id (20260906090000_auth_ownership.sql). Never
// a client-supplied deviceId/accountId, and never the OLDER
// created_by_device_id column, which was only ever a rate-limit key
// (see the R5 migration's own comment) and got reused for ownership
// checks by mistake before this.
//
// Called on EVERY successful account authentication (fresh login or an
// already-logged-in device revisiting /trips), not just when a specific
// tripSlug is in hand -- this is the "safe path to associate after
// authentication" for a creator who deferred saving at creation time:
// whichever trips this exact verified device created and never linked
// anywhere get swept up automatically, with no dependency on
// remembering a particular ?link=<slug> URL. A trip already linked to
// some account (this one or another) is never touched -- ownership is
// never implicitly transferred.
export async function linkOwnedTripsToAccount(
  admin: SupabaseClient<Database>,
  params: { authUserId: string; accountId: string },
): Promise<void> {
  const { authUserId, accountId } = params;

  const { data: candidates, error: selectError } = await admin
    .from("trips")
    .select("id")
    .eq("created_by_auth_user_id", authUserId)
    .is("created_by_account_id", null);
  if (selectError) throw selectError;
  if (!candidates || candidates.length === 0) return;

  for (const trip of candidates) {
    // Atomic, conditional update, not a read-then-write: the `is
    // created_by_account_id null` guard is re-checked by Postgres at
    // update time, so two concurrent requests for the same trip (e.g.
    // two different accounts both authenticated as this same device in
    // separate tabs) can never both succeed -- whichever the database
    // lets through first wins, and the loser's update simply matches
    // zero rows instead of overwriting the winner a moment later.
    const { error: updateError } = await admin
      .from("trips")
      .update({ created_by_account_id: accountId })
      .eq("id", trip.id)
      .is("created_by_account_id", null);
    if (updateError) throw updateError;
  }
}
