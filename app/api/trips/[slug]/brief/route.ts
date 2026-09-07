import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTripCreatorOrAdmin } from "@/lib/security/tripAuthorAccess";
import { setAccountSessionCookies } from "@/lib/security/session";
import { validateEditorialBrief, type EditorialBriefRawInput } from "@/lib/editorialBrief";

// Needs the Node runtime for the service-role Supabase client.
export const runtime = "nodejs";

// Trip editorial brief: GET returns the trip's current brief (or null
// for a trip with none -- a legacy trip, or a new one whose creation
// request somehow never got one -- both stay fully functional, see
// docs/DATABASE.md), plus whether it's read-only right now (the trip is
// already published). Creator-or-admin only -- src/lib/security/
// tripAuthorAccess.ts's requireTripCreatorOrAdmin re-derives this from
// the verified account session server-side every call, never a
// client-supplied flag.
export async function GET(request: Request, { params }: { params: { slug: string } }) {
  try {
    const auth = await requireTripCreatorOrAdmin(request, params.slug);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = createAdminClient();
    const { data: brief, error: briefError } = await admin
      .from("trip_editorial_briefs")
      .select("*")
      .eq("trip_id", auth.trip.id)
      .maybeSingle();
    if (briefError) throw briefError;

    const response = NextResponse.json({ brief, readOnly: auth.trip.contentStatus === "ready" });
    if (auth.session.refreshed) setAccountSessionCookies(response, auth.session.refreshed);
    return response;
  } catch (err) {
    console.error("Trip editorial brief fetch failed", err);
    return NextResponse.json({ error: "Nu am putut încărca brief-ul. Încearcă din nou." }, { status: 500 });
  }
}

// PUT saves the brief -- creator-or-admin only, and only before the
// trip is published (or while content is being generated -- reserved
// for a future process, never set by any current code path, but
// respected here regardless). save_trip_editorial_brief() re-checks
// this itself, under a row lock shared with publish_trip(), so a
// publish racing this save (in either order) can never let an edit land
// on an already-published trip -- see that function's own header for
// the full guarantee. This route never writes content_status, and never
// forwards any request field it doesn't itself recognize onto the
// trips row or the brief row -- only the 7 validated brief fields ever
// reach save_trip_editorial_brief.
export async function PUT(request: Request, { params }: { params: { slug: string } }) {
  try {
    const auth = await requireTripCreatorOrAdmin(request, params.slug);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
    }
    const raw = (body ?? {}) as Record<string, unknown>;
    const input: EditorialBriefRawInput = {
      difficulty: raw.difficulty,
      style: raw.style,
      narratorCharacterName: raw.narratorCharacterName,
      themeHistory: raw.themeHistory,
      themePlaces: raw.themePlaces,
      themeFood: raw.themeFood,
      themeCuriosities: raw.themeCuriosities,
    };
    const validated = validateEditorialBrief(input);
    if (!validated.ok) {
      return NextResponse.json({ error: "Verifică valorile introduse.", fieldErrors: validated.errors }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data, error: saveError } = await admin.rpc("save_trip_editorial_brief", {
      p_trip_id: auth.trip.id,
      p_difficulty: validated.value.difficulty,
      p_style: validated.value.style,
      p_narrator_character_name: validated.value.narratorCharacterName,
      p_theme_history: validated.value.themeHistory,
      p_theme_places: validated.value.themePlaces,
      p_theme_food: validated.value.themeFood,
      p_theme_curiosities: validated.value.themeCuriosities,
    });
    if (saveError) throw saveError;

    // 'rejected_published'/'rejected_generating' mean nothing was
    // written -- a real, expected outcome (the trip published, or a
    // generation run started, between this tab loading and the person
    // clicking save), not a server error, so it's reported as 409
    // Conflict rather than 500.
    if (data.status !== "saved") {
      const message =
        data.status === "rejected_published"
          ? "Brief-ul e disponibil doar pentru citire după publicarea călătoriei."
          : "Pregătirea conținutului e în curs -- brief-ul nu poate fi modificat acum.";
      return NextResponse.json({ status: data.status, error: message }, { status: 409 });
    }

    const response = NextResponse.json({ status: data.status, brief: data.brief });
    if (auth.session.refreshed) setAccountSessionCookies(response, auth.session.refreshed);
    return response;
  } catch (err) {
    console.error("Trip editorial brief save failed", err);
    return NextResponse.json({ error: "Nu am putut salva brief-ul. Încearcă din nou." }, { status: 500 });
  }
}
