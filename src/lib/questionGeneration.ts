import type {
  Database,
  GeneratedQuestionStatus,
  GenerationRunStatus,
  QuestionSlot,
  QuestionThemeCategory,
  TripContentStatus,
  TripDifficulty,
} from "./supabase/types";
import { toEditorialBrief, type EditorialBrief } from "./editorialBrief";

// R9 (20260910090000_r9_question_generation.sql): client-side fetch
// wrappers for the "Generare" tab (app/trip/[slug]/settings/page.tsx),
// same role src/lib/editorialBrief.ts plays for the brief tab -- one
// place that knows the API shape, mapped once into camelCase types the
// UI works with.

export interface GeneratedOption {
  label: string;
  is_correct: boolean;
}

export interface GeneratedDraft {
  id: string;
  dayNumber: number;
  slot: QuestionSlot;
  themeCategory: QuestionThemeCategory;
  difficulty: TripDifficulty;
  prompt: string;
  explanation: string;
  options: GeneratedOption[];
  status: GeneratedQuestionStatus;
  edited: boolean;
  resultingQuestionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationRun {
  id: string;
  status: GenerationRunStatus;
  errorMessage: string | null;
  requestedCount: number;
  draftCount: number;
  rejectedCount: number;
  startedAt: string;
  finishedAt: string | null;
}

export interface GenerationStatus {
  contentStatus: TripContentStatus;
  brief: EditorialBrief | null;
  drafts: GeneratedDraft[];
  lastRun: GenerationRun | null;
}

function toDraft(row: Database["public"]["Tables"]["trip_generated_question_drafts"]["Row"]): GeneratedDraft {
  return {
    id: row.id,
    dayNumber: row.day_number,
    slot: row.slot,
    themeCategory: row.theme_category,
    difficulty: row.difficulty,
    prompt: row.prompt,
    explanation: row.explanation,
    options: row.options,
    status: row.status,
    edited: row.edited,
    resultingQuestionId: row.resulting_question_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRun(row: Database["public"]["Tables"]["trip_question_generation_runs"]["Row"]): GenerationRun {
  return {
    id: row.id,
    status: row.status,
    errorMessage: row.error_message,
    requestedCount: row.requested_count,
    draftCount: row.draft_count,
    rejectedCount: row.rejected_count,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

async function parseJsonOrThrow(response: Response, fallbackMessage: string): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((body?.error as string | undefined) ?? fallbackMessage);
  }
  return body ?? {};
}

export async function getGenerationStatus(slug: string): Promise<GenerationStatus> {
  const response = await fetch(`/api/trips/${encodeURIComponent(slug)}/generate`);
  const body = await parseJsonOrThrow(response, "Nu am putut încărca starea generării. Încearcă din nou.");
  return {
    contentStatus: body.contentStatus as TripContentStatus,
    brief: body.brief ? toEditorialBrief(body.brief as Database["public"]["Tables"]["trip_editorial_briefs"]["Row"]) : null,
    drafts: (body.drafts as Database["public"]["Tables"]["trip_generated_question_drafts"]["Row"][]).map(toDraft),
    lastRun: body.lastRun ? toRun(body.lastRun as Database["public"]["Tables"]["trip_question_generation_runs"]["Row"]) : null,
  };
}

export type StartGenerationOutcome =
  | { status: "succeeded"; draftCount: number; rejectedCount: number }
  | { status: "failed"; reason: string }
  | { status: "already_running" | "already_published" | "no_brief" | "rate_limited"; error: string };

export async function startGeneration(slug: string, count: number): Promise<StartGenerationOutcome> {
  const response = await fetch(`/api/trips/${encodeURIComponent(slug)}/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ count }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok && response.status !== 200) {
    throw new Error((body?.error as string | undefined) ?? "Generarea a eșuat neașteptat. Încearcă din nou.");
  }
  return body as StartGenerationOutcome;
}

export interface AcceptDraftOverrides {
  prompt?: string;
  explanation?: string;
  options?: GeneratedOption[];
  themeCategory?: QuestionThemeCategory;
  difficulty?: TripDifficulty;
  dayNumber?: number;
  slot?: QuestionSlot;
}

export interface AcceptDraftResult {
  status: "accepted" | "not_found" | "already_processed" | "trip_published" | "stale_brief" | "invalid";
  draft?: GeneratedDraft;
  questionId?: string;
}

export async function acceptGeneratedDraft(slug: string, draftId: string, overrides: AcceptDraftOverrides = {}): Promise<AcceptDraftResult> {
  const response = await fetch(`/api/trips/${encodeURIComponent(slug)}/generate/drafts/${encodeURIComponent(draftId)}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(overrides),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok && response.status !== 409) {
    throw new Error((body?.error as string | undefined) ?? "Nu am putut accepta întrebarea. Încearcă din nou.");
  }
  return {
    status: body.status,
    draft: body.draft ? toDraft(body.draft) : undefined,
    questionId: body.questionId ?? undefined,
  };
}

export async function rejectGeneratedDraft(slug: string, draftId: string): Promise<GeneratedDraft> {
  const response = await fetch(`/api/trips/${encodeURIComponent(slug)}/generate/drafts/${encodeURIComponent(draftId)}/reject`, {
    method: "POST",
  });
  const body = await parseJsonOrThrow(response, "Nu am putut respinge întrebarea. Încearcă din nou.");
  return toDraft(body.draft as Database["public"]["Tables"]["trip_generated_question_drafts"]["Row"]);
}

export async function regenerateGeneratedDraft(slug: string, draftId: string): Promise<StartGenerationOutcome> {
  const response = await fetch(`/api/trips/${encodeURIComponent(slug)}/generate/drafts/${encodeURIComponent(draftId)}/regenerate`, {
    method: "POST",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok && response.status !== 200) {
    throw new Error((body?.error as string | undefined) ?? "Nu am putut regenera întrebarea. Încearcă din nou.");
  }
  return body as StartGenerationOutcome;
}
