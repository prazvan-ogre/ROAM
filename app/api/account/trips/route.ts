import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAccountSession, setAccountSessionCookies } from "@/lib/security/session";

export const runtime = "nodejs";

// R1: "Which trips does this account see" used to be decided client-side
// (app/trips/page.tsx, app/trip/[slug]/settings/page.tsx: `getStoredIsAdmin()
// ? getAllTrips() : getTripsForAccount(accountId)`) -- both the accountId
// filter and the admin flag itself came straight out of localStorage, so
// anyone could set roam_creator_account_is_admin=1 in devtools and see
// every trip on the platform. This route re-derives both from a real,
// provider-verified Supabase Auth session (batch 2,
// src/lib/security/session.ts) and a server-side lookup of
// creator_accounts.is_admin instead.
export async function GET(request: Request) {
  try {
    const session = await resolveAccountSession(request);
    if (!session) {
      return NextResponse.json({ error: "Sesiune expirată sau lipsă. Autentifică-te din nou." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: account, error: accountError } = await admin
      .from("creator_accounts")
      .select("is_admin")
      .eq("id", session.accountId)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return NextResponse.json({ error: "Contul nu a fost găsit." }, { status: 404 });

    const columns = "id, slug, name, language, start_date, duration_days, destination, location_info, content_status, is_active, is_demo, created_at";
    const query = admin.from("trips").select(columns).order("created_at", { ascending: false });
    const { data: trips, error: tripsError } = account.is_admin
      ? await query
      : await query.eq("created_by_account_id", session.accountId);
    if (tripsError) throw tripsError;

    const response = NextResponse.json({ isAdmin: account.is_admin, trips: trips ?? [] });
    if (session.refreshed) setAccountSessionCookies(response, session.refreshed);
    return response;
  } catch (err) {
    console.error("Account trip listing failed", err);
    return NextResponse.json({ error: "Nu am putut încărca călătoriile. Încearcă din nou." }, { status: 500 });
  }
}
