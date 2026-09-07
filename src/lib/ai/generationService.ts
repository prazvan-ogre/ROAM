import { createAdminClient } from "@/lib/supabase/admin";
import { getQuestionGenerationProvider, AiProviderError, type GenerationSlotRequest } from "./questionGenerationProvider";
import { validateGeneratedQuestionsResponse } from "@/lib/generatedQuestions";
import type { QuestionThemeCategory, QuestionSlot, TripQuestionStyle } from "@/lib/supabase/types";

// R9 (20260910090000_r9_question_generation.sql): the orchestrator
// between the SQL state machine (start/finish_trip_question_generation)
// and the AI provider module. Runs synchronously inside one API request
// -- same posture as public trip creation (app/api/trips/create), which
// also does its work inside a single awaited route handler rather than
// a background job/queue this codebase has no infrastructure for. The
// route sets `maxDuration` generously (see app/api/trips/[slug]/
// generate/route.ts) to give this room to finish; a request that's
// killed mid-flight anyway leaves the trip recoverable -- see
// start_trip_question_generation's own "stale run" reclaim logic.

export type RunGenerationOutcome =
  | { status: "succeeded"; draftCount: number; rejectedCount: number }
  | { status: "failed"; reason: string };

// Deterministic day/slot targeting: fills gaps (day/slot pairs with no
// existing Discover question at all, regardless of verified/published
// state) first, then cycles through every day/slot pair again if more
// questions were requested than there are gaps -- never left to the AI
// to invent, so every returned item's day/slot is checked against an
// already-known-valid set (see validateGeneratedQuestionsResponse).
export function buildDaySlotSequence(
  durationDays: number,
  count: number,
  occupied: Set<string>,
): { dayNumber: number; slot: QuestionSlot }[] {
  const allPairs: { dayNumber: number; slot: QuestionSlot }[] = [];
  for (let day = 1; day <= durationDays; day++) {
    allPairs.push({ dayNumber: day, slot: "morning" }, { dayNumber: day, slot: "lunch" });
  }
  const gaps = allPairs.filter((p) => !occupied.has(`${p.dayNumber}|${p.slot}`));
  const ordered = [...gaps, ...allPairs.filter((p) => occupied.has(`${p.dayNumber}|${p.slot}`))];
  const result: { dayNumber: number; slot: QuestionSlot }[] = [];
  for (let i = 0; i < count; i++) result.push(ordered[i % ordered.length]);
  return result;
}

// Allocates `count` items across the 4 theme categories proportionally
// to the brief's own percentages (largest-remainder rounding, so the
// allocation always sums to exactly `count`), then interleaves them
// round-robin rather than grouping same-category items together.
export function allocateThemeCategorySequence(
  count: number,
  theme: { history: number; places: number; food: number; curiosities: number },
): QuestionThemeCategory[] {
  const cats: QuestionThemeCategory[] = ["history", "places", "food", "curiosities"];
  const raw = cats.map((c) => (theme[c] / 100) * count);
  const floors = raw.map((r) => Math.floor(r));
  const allocated = floors.reduce((s, n) => s + n, 0);
  let remainder = count - allocated;
  const fractionalOrder = cats
    .map((c, i) => ({ c, frac: raw[i] - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const counts: Record<QuestionThemeCategory, number> = { history: floors[0], places: floors[1], food: floors[2], curiosities: floors[3] };
  for (let i = 0; i < remainder && i < fractionalOrder.length; i++) counts[fractionalOrder[i].c]++;
  remainder = count - cats.reduce((s, c) => s + counts[c], 0);
  // Safety net for a pathological all-zero theme split (shouldn't occur
  // -- the brief's own CHECK constraint requires the 4 percentages to
  // sum to 100 -- kept as defense-in-depth, not a real expected path).
  let i = 0;
  while (remainder > 0) {
    counts[cats[i % cats.length]]++;
    remainder--;
    i++;
  }

  const sequence: QuestionThemeCategory[] = [];
  const remaining = { ...counts };
  while (sequence.length < count) {
    for (const c of cats) {
      if (remaining[c] > 0) {
        sequence.push(c);
        remaining[c]--;
      }
      if (sequence.length >= count) break;
    }
  }
  return sequence;
}

// The shared core both bulk generation and single-question regeneration
// run through: call the provider for the given (already fully-decided)
// slots, validate the response, persist valid items as drafts, and
// finish the run either way. Never throws for an ordinary provider
// failure (timeout/rate-limit/error) -- those are reported as a normal
// "failed" outcome, exactly like a validation failure; only a genuine
// programming/DB error propagates.
async function executeGenerationRun(
  tripId: string,
  runId: string,
  slots: GenerationSlotRequest[],
  context: { destination: string; style: TripQuestionStyle; narratorCharacterName: string | null; briefVersion: string; durationDays: number },
): Promise<RunGenerationOutcome> {
  const admin = createAdminClient();

  let raw: string;
  try {
    const provider = getQuestionGenerationProvider();
    const result = await provider.generateQuestions({
      destination: context.destination,
      style: context.style,
      narratorCharacterName: context.narratorCharacterName,
      slots,
    });
    raw = result.raw;
  } catch (err) {
    const reason =
      err instanceof AiProviderError
        ? err.kind === "timeout"
          ? "Furnizorul AI nu a răspuns la timp. Încearcă din nou."
          : err.kind === "rate_limited"
            ? "Limită de utilizare a furnizorului AI depășită. Încearcă din nou peste câteva minute."
            : err.kind === "not_configured"
              ? "Furnizorul AI nu este configurat."
              : "Furnizorul AI a returnat o eroare. Încearcă din nou."
        : "Generarea a eșuat neașteptat. Încearcă din nou.";
    // Never log err's own message/body here -- for AiProviderError it is
    // already a safe, generic string, but a non-AiProviderError could be
    // an SDK error echoing request content. Log only the error kind.
    console.error("Question generation provider call failed", err instanceof AiProviderError ? err.kind : "unknown");
    await admin.rpc("finish_trip_question_generation", {
      p_run_id: runId,
      p_success: false,
      p_error_message: reason,
      p_draft_count: 0,
      p_rejected_count: slots.length,
    });
    return { status: "failed", reason };
  }

  const { valid, rejectedCount, rejectedReasons } = validateGeneratedQuestionsResponse(raw, slots, context.durationDays);

  if (valid.length > 0) {
    const { error: insertError } = await admin.from("trip_generated_question_drafts").insert(
      valid.map((q) => ({
        trip_id: tripId,
        generation_run_id: runId,
        brief_version: context.briefVersion,
        day_number: q.dayNumber,
        slot: q.slot,
        theme_category: q.themeCategory,
        difficulty: q.difficulty,
        prompt: q.prompt,
        explanation: q.explanation,
        options: q.options,
      })),
    );
    if (insertError) throw insertError;
  }

  const reason = valid.length === 0 ? rejectedReasons.slice(0, 3).join(" ") || "Niciun rezultat valid." : null;
  await admin.rpc("finish_trip_question_generation", {
    p_run_id: runId,
    p_success: valid.length > 0,
    p_error_message: reason,
    p_draft_count: valid.length,
    p_rejected_count: rejectedCount,
  });

  if (valid.length === 0) {
    return { status: "failed", reason: "Furnizorul AI nu a produs niciun rezultat valid. Încearcă din nou." };
  }
  return { status: "succeeded", draftCount: valid.length, rejectedCount };
}

// Bulk generation: builds the deterministic day/slot/category plan from
// the trip's own gaps and the brief's theme split, then runs it.
export async function runGeneration(tripId: string, runId: string, requestedCount: number): Promise<RunGenerationOutcome> {
  const admin = createAdminClient();

  const [{ data: trip, error: tripError }, { data: brief, error: briefError }, { data: existing, error: existingError }] = await Promise.all([
    admin.from("trips").select("destination, duration_days").eq("id", tripId).single(),
    admin.from("trip_editorial_briefs").select("*").eq("trip_id", tripId).single(),
    admin.from("questions").select("day_number, slot").eq("trip_id", tripId).eq("kind", "discover"),
  ]);
  if (tripError) throw tripError;
  if (briefError) throw briefError;
  if (existingError) throw existingError;

  const occupied = new Set((existing ?? []).map((q) => `${q.day_number}|${q.slot}`));
  const daySlots = buildDaySlotSequence(trip.duration_days, requestedCount, occupied);
  const categories = allocateThemeCategorySequence(requestedCount, {
    history: brief.theme_history,
    places: brief.theme_places,
    food: brief.theme_food,
    curiosities: brief.theme_curiosities,
  });
  const slots: GenerationSlotRequest[] = daySlots.map((ds, i) => ({
    dayNumber: ds.dayNumber,
    slot: ds.slot,
    themeCategory: categories[i],
    difficulty: brief.difficulty,
  }));

  return executeGenerationRun(tripId, runId, slots, {
    destination: trip.destination ?? "",
    style: brief.style,
    narratorCharacterName: brief.narrator_character_name,
    briefVersion: brief.updated_at,
    durationDays: trip.duration_days,
  });
}

// Single-question regeneration: reuses the exact same slot (day/slot/
// category/difficulty) an already-rejected draft targeted, rather than
// re-running the whole gap-filling plan -- "regenerate this one without
// losing my other changes" (Section 1 of the request). The caller
// (the regenerate route) is responsible for rejecting the old draft
// first, via reject_generated_question_draft -- this function only runs
// the generation itself.
export async function runSingleSlotRegeneration(tripId: string, runId: string, slot: GenerationSlotRequest): Promise<RunGenerationOutcome> {
  const admin = createAdminClient();

  const [{ data: trip, error: tripError }, { data: brief, error: briefError }] = await Promise.all([
    admin.from("trips").select("destination, duration_days").eq("id", tripId).single(),
    admin.from("trip_editorial_briefs").select("*").eq("trip_id", tripId).single(),
  ]);
  if (tripError) throw tripError;
  if (briefError) throw briefError;

  return executeGenerationRun(tripId, runId, [slot], {
    destination: trip.destination ?? "",
    style: brief.style,
    narratorCharacterName: brief.narrator_character_name,
    briefVersion: brief.updated_at,
    durationDays: trip.duration_days,
  });
}
