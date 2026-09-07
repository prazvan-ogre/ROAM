import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireTripCreatorOrAdmin } from "@/lib/security/tripAuthorAccess";
import { setAccountSessionCookies } from "@/lib/security/session";
import { runGeneration } from "@/lib/ai/generationService";
import { MAX_GENERATED_QUESTIONS_PER_REQUEST, MIN_GENERATED_QUESTIONS_PER_REQUEST } from "@/lib/constants";

// Needs the Node runtime for the service-role Supabase client and the
// Anthropic SDK. Generous maxDuration -- this route runs the whole
// generation job synchronously (provider call + validation + persisting
// drafts), same posture as app/api/trips/create/route.ts; a request that
// still gets killed before finishing leaves the trip recoverable (see
// start_trip_question_generation's own "stale run" reclaim, 20260910090000_
// r9_question_generation.sql).
export const runtime = "nodejs";
export const maxDuration = 60;

// POST starts (and runs, synchronously) a generation job -- creator-or-
// admin only. A concurrent second request while one is already running
// gets that SAME run's current state back (200), never a duplicate job
// -- see start_trip_question_generation's own row lock/unique-index
// guarantee. requestedCount is capped both here (fail fast, before
// spending a provider call) and by the database's own CHECK constraint.
export async function POST(request: Request, { params }: { params: { slug: string } }) {
  try {
    const auth = await requireTripCreatorOrAdmin(request, params.slug);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const rawCount = (body as Record<string, unknown> | null)?.count;
    const count = typeof rawCount === "number" ? Math.trunc(rawCount) : NaN;
    if (!Number.isFinite(count) || count < MIN_GENERATED_QUESTIONS_PER_REQUEST || count > MAX_GENERATED_QUESTIONS_PER_REQUEST) {
      return NextResponse.json(
        { error: `Numărul de întrebări trebuie să fie între ${MIN_GENERATED_QUESTIONS_PER_REQUEST} și ${MAX_GENERATED_QUESTIONS_PER_REQUEST}.` },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    const { data: startResult, error: startError } = await admin.rpc("start_trip_question_generation", {
      p_trip_id: auth.trip.id,
      p_account_id: auth.session.accountId,
      p_requested_count: count,
    });
    if (startError) throw startError;

    if (startResult.status !== "started") {
      const message =
        startResult.status === "already_running"
          ? "O generare este deja în desfășurare pentru această călătorie."
          : startResult.status === "already_published"
            ? "Călătoria e deja publicată -- generarea nu mai este permisă."
            : startResult.status === "no_brief"
              ? "Completează mai întâi brief-ul editorial al călătoriei."
              : "Poți porni o nouă generare doar la cel puțin 30 de secunde de la ultima încercare.";
      return NextResponse.json(
        { status: startResult.status, error: message, run: startResult.run },
        { status: startResult.status === "already_running" ? 200 : 409 },
      );
    }

    const outcome = await runGeneration(auth.trip.id, startResult.run!.id, count);

    const response = NextResponse.json(outcome);
    if (auth.session.refreshed) setAccountSessionCookies(response, auth.session.refreshed);
    return response;
  } catch (err) {
    console.error("Trip question generation failed", err);
    return NextResponse.json({ error: "Generarea a eșuat neașteptat. Încearcă din nou." }, { status: 500 });
  }
}

// GET returns the trip's current generation state for the admin UI:
// content_status (pending/generating/ready/failed -- reused directly,
// see the migration's own header for why), the brief snapshot actually
// in effect (so the UI can show "brief used" even after it later
// changes), and every draft, newest first. Never reachable by a
// participant -- creator-or-admin only, same as every other route here.
export async function GET(request: Request, { params }: { params: { slug: string } }) {
  try {
    const auth = await requireTripCreatorOrAdmin(request, params.slug);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const admin = createAdminClient();
    const [{ data: trip, error: tripError }, { data: brief, error: briefError }, { data: drafts, error: draftsError }, { data: runs, error: runsError }] =
      await Promise.all([
        admin.from("trips").select("content_status").eq("id", auth.trip.id).single(),
        admin.from("trip_editorial_briefs").select("*").eq("trip_id", auth.trip.id).maybeSingle(),
        admin.from("trip_generated_question_drafts").select("*").eq("trip_id", auth.trip.id),
        admin.from("trip_question_generation_runs").select("*").eq("trip_id", auth.trip.id),
      ]);
    if (tripError) throw tripError;
    if (briefError) throw briefError;
    if (draftsError) throw draftsError;
    if (runsError) throw runsError;

    const sortedDrafts = [...(drafts ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const sortedRuns = [...(runs ?? [])].sort((a, b) => (a.started_at < b.started_at ? 1 : -1));

    const response = NextResponse.json({
      contentStatus: trip.content_status,
      brief,
      drafts: sortedDrafts,
      lastRun: sortedRuns[0] ?? null,
    });
    if (auth.session.refreshed) setAccountSessionCookies(response, auth.session.refreshed);
    return response;
  } catch (err) {
    console.error("Trip question generation status fetch failed", err);
    return NextResponse.json({ error: "Nu am putut încărca starea generării. Încearcă din nou." }, { status: 500 });
  }
}
