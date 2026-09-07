import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAccountSession, type ResolvedAccountSession } from "./session";

// Trip editorial brief (20260909090000_trip_editorial_brief.sql): "only
// the trip's own authorized creator, or an admin, may modify the
// brief." Broader than requireAdminSession (src/lib/security/
// adminAuth.ts, R7's admin-only gate for validate/publish) -- this also
// allows the account that actually owns THIS trip -- but built the same
// way: resolveAccountSession verifies the httpOnly session cookie
// against Supabase Auth itself, then trips.created_by_account_id (the
// same column app/api/account/trips/route.ts already filters "Toate
// călătoriile" by) and creator_accounts.is_admin are looked up
// server-side via the service-role client, never trusted from the
// client as a bare accountId/isAdmin flag.
export type TripAuthorAccessResult =
  | { ok: true; session: ResolvedAccountSession; trip: { id: string; contentStatus: string } }
  | { ok: false; status: 401 | 403 | 404; error: string };

export async function requireTripCreatorOrAdmin(request: Request, slug: string): Promise<TripAuthorAccessResult> {
  const session = await resolveAccountSession(request);
  if (!session) {
    return { ok: false, status: 401, error: "Sesiune expirată sau lipsă. Autentifică-te din nou." };
  }

  const admin = createAdminClient();
  const [{ data: account, error: accountError }, { data: trip, error: tripError }] = await Promise.all([
    admin.from("creator_accounts").select("is_admin").eq("id", session.accountId).maybeSingle(),
    admin.from("trips").select("id, content_status, created_by_account_id").eq("slug", slug).maybeSingle(),
  ]);
  if (accountError) throw accountError;
  if (tripError) throw tripError;
  if (!trip) {
    return { ok: false, status: 404, error: "Călătoria nu a fost găsită." };
  }

  const isOwner = trip.created_by_account_id !== null && trip.created_by_account_id === session.accountId;
  if (!account?.is_admin && !isOwner) {
    return { ok: false, status: 403, error: "Nu ai drepturi asupra acestei călătorii." };
  }

  return { ok: true, session, trip: { id: trip.id, contentStatus: trip.content_status } };
}
