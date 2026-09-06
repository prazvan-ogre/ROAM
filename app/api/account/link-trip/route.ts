import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAccountSession, resolveBearerAuthUserId, setAccountSessionCookies } from "@/lib/security/session";
import { linkCreatorParticipant } from "@/lib/security/participantLink";
import { linkOwnedTripsToAccount } from "@/lib/security/tripOwnership";
import { isSameOriginRequest } from "@/lib/security/csrf";

export const runtime = "nodejs";

// Fixes hypothesis E (2026-09-05 review): app/trips/page.tsx's mount
// effect skips straight to loadTrips() whenever an account already looks
// logged in (no phone/PIN re-entry needed), and never even looks at
// ?link= -- only a fresh login's handleAccount (app/api/account/route.ts)
// ever did the "link this device's newly created trip to this account"
// write. This route does the same best-effort link + auto-join, gated by
// the real Supabase Auth session cookie (src/lib/security/session.ts) --
// reachable from the mount effect without asking an already-authenticated
// user to log in again.
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "Cerere respinsă." }, { status: 403 });
  }
  try {
    const session = await resolveAccountSession(request);
    if (!session) {
      return NextResponse.json({ error: "Sesiune expirată sau lipsă. Autentifică-te din nou." }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
    }
    const { tripSlug, deviceId } = (body ?? {}) as Record<string, unknown>;
    if (typeof tripSlug !== "string" || !tripSlug.trim() || typeof deviceId !== "string" || !deviceId.trim()) {
      return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
    }
    const trimmedTripSlug = tripSlug.trim();
    const trimmedDeviceId = deviceId.trim();

    const admin = createAdminClient();

    const { data: account, error: accountError } = await admin
      .from("creator_accounts")
      .select("display_name")
      .eq("id", session.accountId)
      .maybeSingle();
    if (accountError) throw accountError;

    const { data: tripRow, error: tripError } = await admin
      .from("trips")
      .select("id")
      .eq("slug", trimmedTripSlug)
      .maybeSingle();
    if (tripError) throw tripError;

    // R5: ownership is decided ONLY by created_by_auth_user_id (stamped
    // server-side at trip-creation time from a verified bearer token,
    // app/api/trips/create/route.ts), never by comparing the
    // client-supplied deviceId above to created_by_device_id -- that
    // column was only ever a rate-limit key (see the migration's own
    // comment), not proof of ownership. resolveBearerAuthUserId here
    // verifies THIS request's own bearer token the same way; sweeping up
    // every trip this exact verified device created and hasn't linked
    // yet (not just trimmedTripSlug) is what makes this a safe path to
    // associate after authentication regardless of which trip brought
    // the person back to /trips.
    const deviceAuthUserId = await resolveBearerAuthUserId(request);
    if (deviceAuthUserId) {
      await linkOwnedTripsToAccount(admin, { authUserId: deviceAuthUserId, accountId: session.accountId });
    }

    // The caller (app/trips/page.tsx) used to need `displayName` back to
    // run getOrCreateAdultParticipant() itself, client-side, with a
    // client-supplied accountId -- exactly the "self-grant membership in
    // an account" gap the review calls out. The join now happens here,
    // server-side, with the calling device's own anonymous identity
    // verified via its Authorization bearer token.
    if (tripRow && account?.display_name && deviceAuthUserId) {
      try {
        await linkCreatorParticipant(admin, {
          tripId: tripRow.id,
          deviceId: trimmedDeviceId,
          authUserId: deviceAuthUserId,
          accountId: session.accountId,
          displayName: account.display_name,
        });
      } catch (joinErr) {
        console.error("Auto-join for an already logged-in account failed", joinErr);
      }
    }

    const response = NextResponse.json({ displayName: account?.display_name ?? null });
    if (session.refreshed) setAccountSessionCookies(response, session.refreshed);
    return response;
  } catch (err) {
    console.error("Trip linking for an already logged-in account failed", err);
    return NextResponse.json({ error: "Nu am putut lega călătoria de cont." }, { status: 500 });
  }
}
