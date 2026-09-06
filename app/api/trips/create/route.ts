import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { slugify } from "@/lib/slug";
import { checkAndRecordIpAttempt, getClientIp } from "@/lib/security/ipRateLimit";
import { resolveBearerAuthUserId } from "@/lib/security/session";

// Needs the Node runtime for the service-role Supabase client -- not
// edge-compatible.
export const runtime = "nodejs";

const MIN_DURATION_DAYS = 3;
const MAX_DURATION_DAYS = 10;
const MAX_TRIPS_PER_DEVICE_PER_DAY = 1;
// A circuit breaker on top of the per-device limit: this page is public,
// and every trip it creates lands in a manual content-review queue (see
// below) -- this bounds how many can pile up in a day even if someone
// works around the per-device check (e.g. by clearing localStorage
// between requests).
const MAX_TRIPS_GLOBAL_PER_DAY = 20;
const MAX_DESTINATION_LENGTH = 80;
// Batch 2 (2026-09-05 review, R1 continued): device_id is a plain
// client-asserted string (src/lib/device.ts) -- clearing localStorage
// resets the per-device limit above for free. This IP-keyed limit
// (src/lib/security/ipRateLimit.ts) doesn't reset that way; looser than
// the per-device cap (a shared home/office IP can host more than one
// real family creating a trip) but still bounds a scripted attacker
// cycling device ids from one machine.
const MAX_TRIPS_PER_IP_PER_DAY = 3;
const IP_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    return await handleCreate(request);
  } catch (err) {
    // Logged rather than swallowed -- without this, any unhandled error
    // here (a missing SUPABASE_SERVICE_ROLE_KEY, a migration not yet
    // applied to production, ...) returned a generic non-JSON 500 page,
    // which the client only ever saw as "Nu am putut crea călătoria" --
    // impossible to diagnose from a phone. Check Vercel's function logs
    // for this route to see the real cause.
    console.error("Trip creation failed", err);
    return NextResponse.json({ error: "Nu am putut crea călătoria. Încearcă din nou." }, { status: 500 });
  }
}

async function handleCreate(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  }

  const { destination, startDate, durationDays, deviceId, requestId, website } = (body ?? {}) as Record<
    string,
    unknown
  >;

  // Honeypot: a field real visitors never see or fill in (see app/page.tsx).
  // Rejected with the same generic message as a real validation failure,
  // so a bot filling it doesn't learn it tripped a trap specifically.
  if (typeof website === "string" && website.trim() !== "") {
    return NextResponse.json({ error: "Nu am putut crea călătoria. Încearcă din nou." }, { status: 400 });
  }

  if (typeof destination !== "string" || !destination.trim() || destination.trim().length > MAX_DESTINATION_LENGTH) {
    return NextResponse.json(
      { error: `Introdu o destinație validă (max. ${MAX_DESTINATION_LENGTH} de caractere).` },
      { status: 400 },
    );
  }
  if (typeof deviceId !== "string" || !deviceId.trim()) {
    return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  }
  if (typeof requestId !== "string" || !requestId.trim()) {
    return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  }

  // R5: who actually created this trip is now a server-verified identity,
  // not the client-asserted deviceId string above (that stays only for
  // the per-device rate limit below, its original and only purpose --
  // see the migration's own comment for why it was never fit to be an
  // ownership proof). The client always has an anonymous Supabase Auth
  // session by this point (src/lib/publicTripCreation.ts calls
  // ensureAuthSession() before this request, the same "no form, no
  // password" mechanism every participant already uses) -- requiring it
  // here closes the gap that let app/api/account/route.ts's own linking
  // trust a bare deviceId match as proof of ownership.
  const authUserId = await resolveBearerAuthUserId(request);
  if (!authUserId) {
    return NextResponse.json({ error: "Nu am putut verifica sesiunea. Încearcă din nou." }, { status: 401 });
  }

  const duration = Number(durationDays);
  if (!Number.isInteger(duration) || duration < MIN_DURATION_DAYS || duration > MAX_DURATION_DAYS) {
    return NextResponse.json(
      { error: `Durata trebuie să fie între ${MIN_DURATION_DAYS} și ${MAX_DURATION_DAYS} zile.` },
      { status: 400 },
    );
  }

  const start = typeof startDate === "string" ? new Date(startDate) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Introdu o dată de start validă." }, { status: 400 });
  }
  const twoYearsFromNow = new Date();
  twoYearsFromNow.setFullYear(twoYearsFromNow.getFullYear() + 2);
  if (start.getTime() > twoYearsFromNow.getTime()) {
    return NextResponse.json({ error: "Data de start e prea departe în viitor." }, { status: 400 });
  }

  const admin = createAdminClient();

  // R5: a retry of THIS SAME creation attempt (a lost confirmation --
  // the insert committed, the response never reached the client) must
  // return the trip that already exists, never re-run the rate limits
  // below or create a second one. Checked before anything else so a
  // true retry never spends a day's rate-limit allowance twice.
  const { data: existingByRequestId, error: existingLookupError } = await admin
    .from("trips")
    .select("slug")
    .eq("client_request_id", requestId)
    .maybeSingle();
  if (existingLookupError) throw existingLookupError;
  if (existingByRequestId) {
    return NextResponse.json({ slug: existingByRequestId.slug });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [deviceCountResult, globalCountResult] = await Promise.all([
    admin.from("trips").select("id", { count: "exact", head: true }).eq("created_by_device_id", deviceId).gte("created_at", since),
    admin.from("trips").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);
  if (deviceCountResult.error) throw deviceCountResult.error;
  if (globalCountResult.error) throw globalCountResult.error;

  if ((deviceCountResult.count ?? 0) >= MAX_TRIPS_PER_DEVICE_PER_DAY) {
    return NextResponse.json(
      { error: "Poți crea o singură călătorie nouă pe zi de pe acest dispozitiv. Încearcă din nou mâine." },
      { status: 429 },
    );
  }
  if ((globalCountResult.count ?? 0) >= MAX_TRIPS_GLOBAL_PER_DAY) {
    return NextResponse.json(
      { error: "Am atins limita zilnică de călătorii noi. Încearcă din nou mâine." },
      { status: 503 },
    );
  }

  const clientIp = getClientIp(request);
  if (clientIp) {
    const ipStatus = await checkAndRecordIpAttempt(admin, clientIp, "trip_create", {
      maxAttempts: MAX_TRIPS_PER_IP_PER_DAY,
      windowMs: IP_WINDOW_MS,
    });
    if (!ipStatus.allowed) {
      return NextResponse.json(
        { error: "Poți crea o singură călătorie nouă pe zi de pe acest dispozitiv. Încearcă din nou mâine." },
        { status: 429, headers: { "Retry-After": String(ipStatus.retryAfterSeconds ?? 86400) } },
      );
    }
  }

  const destinationName = destination.trim();
  const tripYear = start.getFullYear();
  const baseSlug = slugify(destinationName) || "calatorie";
  const slug = `${baseSlug}-${tripYear}-${Math.random().toString(36).slice(2, 6)}`;

  // Content generation is a deliberate manual step (product owner
  // decision, reversing the earlier live-Claude-API-call design) -- this
  // route only ever creates the bare trip shell, left at 'pending'.
  // Someone (today: asking an assistant to draft it, the same way
  // Kassandra's content was written) drafts and inserts the
  // Discover/Battle content afterward as an additive migration, then
  // flips content_status to 'ready' as part of that same migration. See
  // docs/DATABASE.md "Security model" point 6 and docs/ARCHITECTURE.md
  // "Public trip creation".
  const { data: created, error: insertTripError } = await admin
    .from("trips")
    .insert({
      slug,
      name: `${destinationName} ${tripYear}`,
      language: "ro",
      start_date: start.toISOString().slice(0, 10),
      duration_days: duration,
      destination: destinationName,
      created_by_device_id: deviceId,
      created_by_auth_user_id: authUserId,
      client_request_id: requestId,
      content_status: "pending",
    })
    .select("slug")
    .single();

  if (insertTripError) {
    if (insertTripError.code === "23505") {
      // Either this exact requestId raced itself (two concurrent
      // submissions) -- reconcile onto whichever won -- or, far less
      // likely, the random slug suffix collided with an unrelated trip.
      // Only the first case is this route's own retry contract; the
      // second still surfaces as a real error, same as before.
      const { data: winner, error: selectError } = await admin
        .from("trips")
        .select("slug")
        .eq("client_request_id", requestId)
        .maybeSingle();
      if (selectError) throw selectError;
      if (winner) return NextResponse.json({ slug: winner.slug });
    }
    throw insertTripError;
  }

  return NextResponse.json({ slug: created.slug });
}
