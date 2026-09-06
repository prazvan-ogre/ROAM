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
// R5 round 2 (explicit association contract): the six states a request to
// associate one named trip with an account can land in. "not_owned_by_device"
// covers both a genuinely unclaimed trip this device didn't create AND any
// pre-R5 trip with no created_by_auth_user_id at all -- knowing the slug
// (or a client-supplied deviceId/accountId) never proves ownership, so both
// cases are refused the same way; recovering one of those old trips is a
// deliberate, separate, out-of-band process, never this endpoint.
export type TripLinkOutcome = "linked" | "already_linked" | "linked_to_other" | "not_found" | "not_owned_by_device";

export async function resolveTripLinkOutcome(
  admin: SupabaseClient<Database>,
  params: { tripSlug: string; authUserId: string; accountId: string },
): Promise<TripLinkOutcome> {
  const { tripSlug, authUserId, accountId } = params;

  const { data: trip, error: selectError } = await admin
    .from("trips")
    .select("id, created_by_account_id, created_by_auth_user_id")
    .eq("slug", tripSlug)
    .maybeSingle();
  if (selectError) throw selectError;
  if (!trip) return "not_found";

  if (trip.created_by_auth_user_id !== authUserId) {
    // This verified device did not create this trip -- the slug alone
    // proves nothing. Still worth telling an already-linked caller "you
    // already have this" rather than a bare refusal, since that can
    // legitimately happen (e.g. an admin account revisiting its own link).
    return trip.created_by_account_id === accountId ? "already_linked" : "not_owned_by_device";
  }

  // This device DID create it -- attempt the same atomic, conditional claim
  // linkOwnedTripsToAccount uses below. `.select("id")` on the update lets
  // us tell, from the row count alone, whether THIS call was the one that
  // won the race.
  const { data: updated, error: updateError } = await admin
    .from("trips")
    .update({ created_by_account_id: accountId })
    .eq("id", trip.id)
    .is("created_by_account_id", null)
    .select("id");
  if (updateError) throw updateError;
  if (updated && updated.length > 0) return "linked";

  // Zero rows updated: something else set created_by_account_id between our
  // SELECT and this UPDATE (a concurrent request, or a retry of a call that
  // already succeeded). Re-read to report which of the two actually
  // happened, rather than guessing.
  const { data: rechecked, error: recheckError } = await admin
    .from("trips")
    .select("created_by_account_id")
    .eq("id", trip.id)
    .maybeSingle();
  if (recheckError) throw recheckError;
  return rechecked?.created_by_account_id === accountId ? "already_linked" : "linked_to_other";
}

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
