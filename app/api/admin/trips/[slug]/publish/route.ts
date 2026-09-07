import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminSession } from "@/lib/security/adminAuth";
import { setAccountSessionCookies } from "@/lib/security/session";

// Needs the Node runtime for the service-role Supabase client.
export const runtime = "nodejs";

// R7: the one explicit publish operation -- re-validates the trip's
// content from scratch (publish_trip() calls validate_trip_content()
// itself, inside the same transaction, 20260908090000_r7_content_
// publishing_pipeline.sql) and only flips content_status to 'ready' if
// there are zero errors; a trip with any error-severity issue is
// rejected outright, content_status untouched, full issue list returned
// so the operator sees exactly what's missing. Idempotent: publishing an
// already-'ready' trip is a safe no-op ("already_published"), never a
// second write. Admin-only, same server-verified check as ../validate.
export async function POST(request: Request, { params }: { params: { slug: string } }) {
  try {
    const auth = await requireAdminSession(request);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = createAdminClient();
    const { data: trip, error: tripError } = await admin
      .from("trips")
      .select("id")
      .eq("slug", params.slug)
      .maybeSingle();
    if (tripError) throw tripError;
    if (!trip) return NextResponse.json({ error: "Călătoria nu a fost găsită." }, { status: 404 });

    const { data, error: publishError } = await admin.rpc("publish_trip", { p_trip_id: trip.id });
    if (publishError) throw publishError;

    const response = NextResponse.json({
      status: data.status,
      errorCount: data.error_count,
      warningCount: data.warning_count,
      issues: data.issues ?? [],
    });
    if (auth.session.refreshed) setAccountSessionCookies(response, auth.session.refreshed);
    return response;
  } catch (err) {
    console.error("Trip publish failed", err);
    return NextResponse.json({ error: "Nu am putut publica. Încearcă din nou." }, { status: 500 });
  }
}
