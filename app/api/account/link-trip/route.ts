import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifySessionToken, readSessionCookie } from "@/lib/security/session";

export const runtime = "nodejs";

// Fixes hypothesis E (2026-09-05 review): app/trips/page.tsx's mount
// effect skips straight to loadTrips() whenever an account id is already
// stored (an already logged-in creator, no phone/PIN re-entry needed to
// enter "Călătoriile mele"), and never even looks at ?link= -- only
// handleAuthSubmit (a fresh phone+PIN login) does the actual "link this
// device's newly created trip to this account" write, inside
// app/api/account/route.ts's POST. So a trip created by an
// already-logged-in creator was never linked, silently.
//
// This route does the same best-effort link, but gated by the session
// cookie the same way app/api/account/trips/route.ts is (no phone/PIN,
// no client-supplied accountId) -- reachable from the mount effect
// without asking an already-authenticated user to log in again.
export async function POST(request: Request) {
  try {
    const accountId = verifySessionToken(readSessionCookie(request))?.accountId;
    if (!accountId) {
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

    const admin = createAdminClient();

    // Same rule as app/api/account/route.ts's own linking: only if this
    // exact device created that exact trip, and it isn't already tied to
    // some other account. A trip that doesn't match either condition
    // (someone else's device, or already linked) is silently left alone
    // -- not an error, just nothing to do.
    const { error: linkError } = await admin
      .from("trips")
      .update({ created_by_account_id: accountId })
      .eq("slug", tripSlug.trim())
      .eq("created_by_device_id", deviceId.trim())
      .is("created_by_account_id", null);
    if (linkError) throw linkError;

    // The caller (app/trips/page.tsx) needs this to auto-join the
    // account holder as the trip's first participant, the same way a
    // fresh login does -- requires a name to join with, same
    // requirement handleAuthSubmit's own auto-join has.
    const { data: account, error: accountError } = await admin
      .from("creator_accounts")
      .select("display_name")
      .eq("id", accountId)
      .maybeSingle();
    if (accountError) throw accountError;

    return NextResponse.json({ displayName: account?.display_name ?? null });
  } catch (err) {
    console.error("Trip linking for an already logged-in account failed", err);
    return NextResponse.json({ error: "Nu am putut lega călătoria de cont." }, { status: 500 });
  }
}
