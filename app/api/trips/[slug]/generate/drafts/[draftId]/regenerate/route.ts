import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTripCreatorOrAdmin } from "@/lib/security/tripAuthorAccess";
import { setAccountSessionCookies } from "@/lib/security/session";
import { runSingleSlotRegeneration } from "@/lib/ai/generationService";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST regenerates ONE question -- rejects the existing draft (audit
// trail preserved, per "Retry-ul nu trebuie să șteargă drafturile
// acceptate manual": rejecting is not deleting, and every OTHER draft
// is untouched) and runs a fresh 1-question generation targeted at the
// exact same day/slot/theme/difficulty slot. Shares
// start_trip_question_generation's own one-job-per-trip lock -- calling
// this while a bulk generation is already in flight for the same trip
// correctly returns "already_running", the same as starting a second
// bulk job would.
export async function POST(request: Request, { params }: { params: { slug: string; draftId: string } }) {
  try {
    const auth = await requireTripCreatorOrAdmin(request, params.slug);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = createAdminClient();
    const { data: draft, error: draftError } = await admin
      .from("trip_generated_question_drafts")
      .select("*")
      .eq("id", params.draftId)
      .eq("trip_id", auth.trip.id)
      .maybeSingle();
    if (draftError) throw draftError;
    if (!draft) return NextResponse.json({ error: "Întrebarea generată nu a fost găsită." }, { status: 404 });
    if (draft.status !== "pending_review") {
      return NextResponse.json({ error: "Această întrebare a fost deja procesată -- nu mai poate fi regenerată." }, { status: 409 });
    }

    const { error: rejectError } = await admin.rpc("reject_generated_question_draft", { p_draft_id: draft.id });
    if (rejectError) throw rejectError;

    const { data: startResult, error: startError } = await admin.rpc("start_trip_question_generation", {
      p_trip_id: auth.trip.id,
      p_account_id: auth.session.accountId,
      p_requested_count: 1,
    });
    if (startError) throw startError;

    if (startResult.status !== "started") {
      const message =
        startResult.status === "already_running"
          ? "O generare este deja în desfășurare pentru această călătorie -- așteaptă să se termine."
          : startResult.status === "already_published"
            ? "Călătoria e deja publicată -- generarea nu mai este permisă."
            : startResult.status === "no_brief"
              ? "Completează mai întâi brief-ul editorial al călătoriei."
              : "Poți regenera doar la cel puțin 30 de secunde de la ultima încercare.";
      return NextResponse.json({ status: startResult.status, error: message }, { status: startResult.status === "already_running" ? 200 : 409 });
    }

    const outcome = await runSingleSlotRegeneration(auth.trip.id, startResult.run!.id, {
      dayNumber: draft.day_number,
      slot: draft.slot,
      themeCategory: draft.theme_category,
      difficulty: draft.difficulty,
    });

    const response = NextResponse.json(outcome);
    if (auth.session.refreshed) setAccountSessionCookies(response, auth.session.refreshed);
    return response;
  } catch (err) {
    console.error("Regenerating a single question draft failed", err);
    return NextResponse.json({ error: "Nu am putut regenera întrebarea. Încearcă din nou." }, { status: 500 });
  }
}
