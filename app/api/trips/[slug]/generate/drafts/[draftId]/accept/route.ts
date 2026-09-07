import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTripCreatorOrAdmin } from "@/lib/security/tripAuthorAccess";
import { setAccountSessionCookies } from "@/lib/security/session";
import { validateGeneratedQuestionContent, type GeneratedOption } from "@/lib/generatedQuestions";

export const runtime = "nodejs";

// POST accepts one draft -- the human review step that promotes it into
// a real, verified+published questions/answer_options row (see
// accept_generated_question_draft()'s own header, 20260910090000_r9_
// question_generation.sql). The request body may override any content
// field (an admin's edit before accepting); an omitted field falls back
// to the draft's own currently-stored value, so a plain "accept as-is"
// only needs {} as the body. "edited" (source becomes 'edited' rather
// than 'generated') is computed here by comparing the effective values
// against the draft's own stored ones -- never trusted as a raw client
// flag.
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const raw = (body ?? {}) as Record<string, unknown>;

    const effective = {
      prompt: raw.prompt ?? draft.prompt,
      explanation: raw.explanation ?? draft.explanation,
      options: raw.options ?? draft.options,
      themeCategory: raw.themeCategory ?? draft.theme_category,
      difficulty: raw.difficulty ?? draft.difficulty,
      dayNumber: raw.dayNumber ?? draft.day_number,
      slot: raw.slot ?? draft.slot,
    };

    const { data: trip, error: tripError } = await admin.from("trips").select("duration_days").eq("id", auth.trip.id).single();
    if (tripError) throw tripError;

    const validated = validateGeneratedQuestionContent(effective, trip.duration_days);
    if (!validated.ok) {
      return NextResponse.json({ error: "Verifică valorile introduse.", fieldErrors: validated.errors }, { status: 400 });
    }

    const edited =
      validated.value.prompt !== draft.prompt ||
      validated.value.explanation !== draft.explanation ||
      validated.value.themeCategory !== draft.theme_category ||
      validated.value.difficulty !== draft.difficulty ||
      validated.value.dayNumber !== draft.day_number ||
      validated.value.slot !== draft.slot ||
      !optionsEqual(validated.value.options, draft.options as GeneratedOption[]);

    const { data, error: acceptError } = await admin.rpc("accept_generated_question_draft", {
      p_draft_id: draft.id,
      p_account_id: auth.session.accountId,
      p_prompt: validated.value.prompt,
      p_explanation: validated.value.explanation,
      p_options: validated.value.options,
      p_theme_category: validated.value.themeCategory,
      p_difficulty: validated.value.difficulty,
      p_day_number: validated.value.dayNumber,
      p_slot: validated.value.slot,
      p_edited: edited,
    });
    if (acceptError) throw acceptError;

    if (data.status !== "accepted") {
      const message =
        data.status === "already_processed"
          ? "Această întrebare a fost deja procesată (acceptată sau respinsă)."
          : data.status === "trip_published"
            ? "Călătoria e deja publicată -- nu se mai pot accepta întrebări noi."
            : data.status === "stale_brief"
              ? "Brief-ul editorial s-a schimbat de la generarea acestei întrebări -- regenereaz-o."
              : data.status === "invalid"
                ? "Valorile introduse nu sunt valide."
                : "Întrebarea nu a fost găsită.";
      return NextResponse.json({ status: data.status, error: message }, { status: 409 });
    }

    const response = NextResponse.json({ status: data.status, draft: data.draft, questionId: data.question_id });
    if (auth.session.refreshed) setAccountSessionCookies(response, auth.session.refreshed);
    return response;
  } catch (err) {
    console.error("Accepting generated question draft failed", err);
    return NextResponse.json({ error: "Nu am putut accepta întrebarea. Încearcă din nou." }, { status: 500 });
  }
}

function optionsEqual(a: GeneratedOption[], b: GeneratedOption[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((opt, i) => opt.label === b[i]?.label && opt.is_correct === b[i]?.is_correct);
}
