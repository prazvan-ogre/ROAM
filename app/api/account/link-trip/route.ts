import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAccountSession, resolveBearerAuthUserId, setAccountSessionCookies } from "@/lib/security/session";
import { linkCreatorParticipant } from "@/lib/security/participantLink";

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
      .select("id, created_by_account_id, created_by_device_id")
      .eq("slug", trimmedTripSlug)
      .maybeSingle();
    if (tripError) throw tripError;

    // Same rule as app/api/account/route.ts's own linking: only if this
    // exact device created that exact trip, and it isn't already tied to
    // some other account. A trip that doesn't match either condition
    // (someone else's device, or already linked) is silently left alone
    // -- not an error, just nothing to do.
    if (tripRow && !tripRow.created_by_account_id && tripRow.created_by_device_id === trimmedDeviceId) {
      await admin.from("trips").update({ created_by_account_id: session.accountId }).eq("id", tripRow.id);
    }

    // The caller (app/trips/page.tsx) used to need `displayName` back to
    // run getOrCreateAdultParticipant() itself, client-side, with a
    // client-supplied accountId -- exactly the "self-grant membership in
    // an account" gap the review calls out. The join now happens here,
    // server-side, with the calling device's own anonymous identity
    // verified via its Authorization bearer token.
    const deviceAuthUserId = await resolveBearerAuthUserId(request);
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
