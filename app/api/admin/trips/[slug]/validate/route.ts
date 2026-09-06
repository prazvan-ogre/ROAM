import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/security/adminAuth";
import { setAccountSessionCookies } from "@/lib/security/session";

// Needs the Node runtime for the service-role Supabase client.
export const runtime = "nodejs";

// R7: read-only "what's missing" check for one trip's content -- the
// same validate_trip_content() SQL function publish_trip() itself calls
// (20260908090000_r7_content_publishing_pipeline.sql), exposed here as
// its own endpoint so the operator UI (Setări > Publicare) -- and anyone
// running it as a standalone check before attempting to publish -- can
// see the full issue list without side effects. Admin-only: see
// src/lib/security/adminAuth.ts for the server-verified session +
// creator_accounts.is_admin check this never skips.
export async function GET(request: Request, { params }: { params: { slug: string } }) {
  try {
    const auth = await requireAdminSession(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = createAdminClient();
    const { data: trip, error: tripError } = await admin
      .from("trips")
      .select("id, content_status")
      .eq("slug", params.slug)
      .maybeSingle();
    if (tripError) throw tripError;
    if (!trip) return NextResponse.json({ error: "Călătoria nu a fost găsită." }, { status: 404 });

    const { data: issues, error: validateError } = await admin.rpc("validate_trip_content", { p_trip_id: trip.id });
    if (validateError) throw validateError;

    const response = NextResponse.json({ contentStatus: trip.content_status, issues: issues ?? [] });
    if (auth.session.refreshed) setAccountSessionCookies(response, auth.session.refreshed);
    return response;
  } catch (err) {
    console.error("Trip content validation failed", err);
    return NextResponse.json({ error: "Nu am putut valida conținutul. Încearcă din nou." }, { status: 500 });
  }
}
