import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateTripContent } from "@/lib/ai/generateTripContent";
import { insertGeneratedContent } from "@/lib/ai/insertGeneratedContent";
import { slugify } from "@/lib/slug";

// Needs the Node runtime (service-role Supabase client + a long-running
// fetch to the Claude API) -- not edge-compatible.
export const runtime = "nodejs";

const MIN_DURATION_DAYS = 3;
const MAX_DURATION_DAYS = 10;
const MAX_TRIPS_PER_DEVICE_PER_DAY = 1;
// A circuit breaker on top of the per-device limit: this page is public
// and each submission is a real Claude API call, so this bounds the
// worst case cost even if someone works around the per-device check
// (e.g. by clearing localStorage between requests).
const MAX_TRIPS_GLOBAL_PER_DAY = 20;
const MAX_DESTINATION_LENGTH = 80;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  }

  const { destination, startDate, durationDays, deviceId, website } = (body ?? {}) as Record<string, unknown>;

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

  const destinationName = destination.trim();
  const tripYear = start.getFullYear();
  const baseSlug = slugify(destinationName) || "calatorie";
  const slug = `${baseSlug}-${tripYear}-${Math.random().toString(36).slice(2, 6)}`;

  const { data: trip, error: insertTripError } = await admin
    .from("trips")
    .insert({
      slug,
      name: `${destinationName} ${tripYear}`,
      language: "ro",
      start_date: start.toISOString().slice(0, 10),
      duration_days: duration,
      destination: destinationName,
      created_by_device_id: deviceId,
      content_status: "generating",
    })
    .select()
    .single();
  if (insertTripError) throw insertTripError;

  try {
    const content = await generateTripContent(destinationName, duration, tripYear);
    await insertGeneratedContent(admin, trip.id, content);
    await admin.from("trips").update({ content_status: "ready" }).eq("id", trip.id);
  } catch (err) {
    // Logged rather than swallowed -- this is the only place that will
    // ever explain why a given public trip's content_status is 'failed'.
    console.error("Trip content generation failed for", trip.id, trip.slug, err);
    await admin.from("trips").update({ content_status: "failed" }).eq("id", trip.id);
    return NextResponse.json(
      {
        error: "Călătoria a fost creată, dar generarea conținutului a eșuat. O poți deschide, dar întrebările nu sunt încă disponibile.",
        slug,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ slug });
}
