import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTripCreatorOrAdmin } from "@/lib/security/tripAuthorAccess";
import { setAccountSessionCookies } from "@/lib/security/session";

export const runtime = "nodejs";

// POST rejects one draft -- an explicit "don't use this" decision. Never
// deletes the row (audit trail); a no-op if it was already resolved
// (accepted/rejected/invalidated) rather than an error, since two admins
// clicking reject around the same time is a benign race, not a failure.
export async function POST(request: Request, { params }: { params: { slug: string; draftId: string } }) {
  try {
    const auth = await requireTripCreatorOrAdmin(request, params.slug);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = createAdminClient();
    const { data: draft, error: draftError } = await admin
      .from("trip_generated_question_drafts")
      .select("id")
      .eq("id", params.draftId)
      .eq("trip_id", auth.trip.id)
      .maybeSingle();
    if (draftError) throw draftError;
    if (!draft) return NextResponse.json({ error: "Întrebarea generată nu a fost găsită." }, { status: 404 });

    const { data, error: rejectError } = await admin.rpc("reject_generated_question_draft", { p_draft_id: draft.id });
    if (rejectError) throw rejectError;

    const response = NextResponse.json({ draft: data });
    if (auth.session.refreshed) setAccountSessionCookies(response, auth.session.refreshed);
    return response;
  } catch (err) {
    console.error("Rejecting generated question draft failed", err);
    return NextResponse.json({ error: "Nu am putut respinge întrebarea. Încearcă din nou." }, { status: 500 });
  }
}
