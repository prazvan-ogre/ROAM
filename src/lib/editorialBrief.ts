import type { Database, TripDifficulty, TripQuestionStyle } from "./supabase/types";
import {
  DEFAULT_THEME_DISTRIBUTION,
  DEFAULT_TRIP_DIFFICULTY,
  DEFAULT_TRIP_QUESTION_STYLE,
  MAX_NARRATOR_CHARACTER_NAME_LENGTH,
  TRIP_DIFFICULTIES,
  TRIP_QUESTION_STYLES,
} from "./constants";

// Trip editorial brief (20260909090000_trip_editorial_brief.sql): a
// small, persistent set of preferences -- difficulty, thematic
// distribution, writing style -- recorded before a trip's Discover/
// Battle content is drafted. Read today by whoever prepares that
// content by hand; a future generator (explicitly out of scope for this
// batch -- see the migration's own header) would read the exact same
// row via the exact same shape, keyed by trip_id.
//
// This module is the SINGLE place both the creation form
// (app/page.tsx) and the pre-publish edit form (app/trip/[slug]/
// settings/page.tsx's "Brief editorial" tab) validate against -- real
// application-layer validation (not just parsed-back Postgres CHECK
// error text), because the product request specifically asks for clear,
// field-scoped messages near each input, which a bare constraint-
// violation error can't give cleanly. The database's own CHECK
// constraints (same migration) are the non-bypassable backstop for this
// -- simple, single-row, single-table rules that are easy to keep in
// lockstep with these -- unlike R7's validate_trip_content, whose
// relational checks span multiple tables and were deliberately kept in
// SQL alone to avoid two independently-computed sources disagreeing.

export type { TripDifficulty, TripQuestionStyle };

export interface ThemeDistribution {
  history: number;
  places: number;
  food: number;
  curiosities: number;
}

export interface EditorialBrief {
  difficulty: TripDifficulty;
  style: TripQuestionStyle;
  narratorCharacterName: string | null;
  theme: ThemeDistribution;
  updatedAt: string;
}

// The form's own starting values -- visible and editable, never a claim
// about any trip's actual recorded preferences (a trip with no saved
// brief shows "Preferințe nespecificate" instead -- see the two forms
// above).
export const DEFAULT_EDITORIAL_BRIEF_INPUT: EditorialBriefRawInput = {
  difficulty: DEFAULT_TRIP_DIFFICULTY,
  style: DEFAULT_TRIP_QUESTION_STYLE,
  narratorCharacterName: "",
  themeHistory: DEFAULT_THEME_DISTRIBUTION.history,
  themePlaces: DEFAULT_THEME_DISTRIBUTION.places,
  themeFood: DEFAULT_THEME_DISTRIBUTION.food,
  themeCuriosities: DEFAULT_THEME_DISTRIBUTION.curiosities,
};

// The raw shape both forms keep as local component state and both API
// routes read off a parsed JSON body -- everything `unknown`-ish on
// purpose (form inputs are strings/numbers from the DOM; a request body
// is untyped JSON), so validateEditorialBrief is the one place that
// actually narrows it.
export interface EditorialBriefRawInput {
  difficulty: unknown;
  style: unknown;
  narratorCharacterName: unknown;
  themeHistory: unknown;
  themePlaces: unknown;
  themeFood: unknown;
  themeCuriosities: unknown;
}

export interface EditorialBriefFieldErrors {
  difficulty?: string;
  style?: string;
  narratorCharacterName?: string;
  themeHistory?: string;
  themePlaces?: string;
  themeFood?: string;
  themeCuriosities?: string;
  // Shown near the running total, only when every individual percent is
  // itself in range but the four don't add up to exactly 100.
  themeTotal?: string;
}

export interface EditorialBriefValidated {
  difficulty: TripDifficulty;
  style: TripQuestionStyle;
  narratorCharacterName: string | null;
  themeHistory: number;
  themePlaces: number;
  themeFood: number;
  themeCuriosities: number;
}

export type EditorialBriefValidationResult =
  | { ok: true; value: EditorialBriefValidated }
  | { ok: false; errors: EditorialBriefFieldErrors };

function toPercent(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

// Server-side validation, reused by app/api/trips/create/route.ts (the
// initial brief, submitted alongside a new trip) and app/api/trips/
// [slug]/brief/route.ts (an edit to an existing one) -- exactly one set
// of rules for both. Never trust a client to have already validated
// this: both routes call this themselves before writing anything.
export function validateEditorialBrief(input: EditorialBriefRawInput): EditorialBriefValidationResult {
  const errors: EditorialBriefFieldErrors = {};

  const difficulty = typeof input.difficulty === "string" ? input.difficulty : "";
  if (!TRIP_DIFFICULTIES.includes(difficulty as TripDifficulty)) {
    errors.difficulty = "Alege un nivel de dificultate valid.";
  }

  const style = typeof input.style === "string" ? input.style : "";
  if (!TRIP_QUESTION_STYLES.includes(style as TripQuestionStyle)) {
    errors.style = "Alege un stil de formulare valid.";
  }

  // Required ONLY for the narrated-by-character style -- never for the
  // other two, even if a name was typed and then the style changed away
  // from it (the form is expected to just not submit it in that case;
  // this validator doesn't care either way once style isn't that one).
  let narratorCharacterName: string | null = null;
  if (style === "narrated_by_character") {
    const raw = typeof input.narratorCharacterName === "string" ? input.narratorCharacterName : "";
    // Normalize: collapse internal whitespace runs to one space, trim
    // the ends -- "  Ștefan   cel  Mare " and "Ștefan cel Mare" must save
    // (and compare, on reload) identically.
    const normalized = raw.replace(/\s+/g, " ").trim();
    if (!normalized) {
      errors.narratorCharacterName = "Introdu numele personajului istoric.";
    } else if (normalized.length > MAX_NARRATOR_CHARACTER_NAME_LENGTH) {
      errors.narratorCharacterName = `Numele poate avea cel mult ${MAX_NARRATOR_CHARACTER_NAME_LENGTH} de caractere.`;
    } else {
      narratorCharacterName = normalized;
    }
  }

  const themeHistory = toPercent(input.themeHistory);
  const themePlaces = toPercent(input.themePlaces);
  const themeFood = toPercent(input.themeFood);
  const themeCuriosities = toPercent(input.themeCuriosities);

  const percentFields: [number | null, keyof EditorialBriefFieldErrors][] = [
    [themeHistory, "themeHistory"],
    [themePlaces, "themePlaces"],
    [themeFood, "themeFood"],
    [themeCuriosities, "themeCuriosities"],
  ];
  for (const [value, field] of percentFields) {
    if (value === null || value < 0 || value > 100) {
      errors[field] = "Introdu un procent întreg între 0 și 100.";
    }
  }

  const allInRange = themeHistory !== null && themePlaces !== null && themeFood !== null && themeCuriosities !== null
    && !errors.themeHistory && !errors.themePlaces && !errors.themeFood && !errors.themeCuriosities;
  if (allInRange) {
    const total = (themeHistory as number) + (themePlaces as number) + (themeFood as number) + (themeCuriosities as number);
    if (total !== 100) {
      errors.themeTotal = `Suma procentelor trebuie să fie exact 100% (acum ${total}%).`;
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      difficulty: difficulty as TripDifficulty,
      style: style as TripQuestionStyle,
      narratorCharacterName,
      themeHistory: themeHistory as number,
      themePlaces: themePlaces as number,
      themeFood: themeFood as number,
      themeCuriosities: themeCuriosities as number,
    },
  };
}

// ---------------------------------------------------------------------
// Client-side fetch wrappers -- app/trip/[slug]/settings/page.tsx's
// Brief editorial tab. Authorization is entirely server-side (the
// httpOnly account session cookie + trips.created_by_account_id/
// creator_accounts.is_admin, see src/lib/security/tripAuthorAccess.ts);
// neither call sends an accountId or an isAdmin flag of its own, same
// pattern as src/lib/adminContent.ts's R7 calls.
// ---------------------------------------------------------------------

export interface GetEditorialBriefResult {
  brief: EditorialBrief | null;
  // True once the trip is published -- the tab renders a read-only
  // summary instead of the form in that case. The PUT route below
  // enforces this independently (via save_trip_editorial_brief's own
  // row-locked check) regardless of what this flag says.
  readOnly: boolean;
}

function toEditorialBrief(row: Database["public"]["Tables"]["trip_editorial_briefs"]["Row"]): EditorialBrief {
  return {
    difficulty: row.difficulty,
    style: row.style,
    narratorCharacterName: row.narrator_character_name,
    theme: {
      history: row.theme_history,
      places: row.theme_places,
      food: row.theme_food,
      curiosities: row.theme_curiosities,
    },
    updatedAt: row.updated_at,
  };
}

export async function getTripEditorialBrief(slug: string): Promise<GetEditorialBriefResult> {
  const response = await fetch(`/api/trips/${encodeURIComponent(slug)}/brief`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut încărca brief-ul. Încearcă din nou.");
  }
  return { brief: body.brief ? toEditorialBrief(body.brief) : null, readOnly: Boolean(body.readOnly) };
}

export type SaveEditorialBriefStatus = "saved" | "rejected_published" | "rejected_generating";

export interface SaveEditorialBriefResult {
  status: SaveEditorialBriefStatus;
  brief: EditorialBrief | null;
}

export async function saveTripEditorialBrief(
  slug: string,
  input: EditorialBriefValidated,
): Promise<SaveEditorialBriefResult> {
  const response = await fetch(`/api/trips/${encodeURIComponent(slug)}/brief`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok && response.status !== 409) {
    throw new Error(body?.error ?? "Nu am putut salva brief-ul. Încearcă din nou.");
  }
  return { status: body.status, brief: body.brief ? toEditorialBrief(body.brief) : null };
}

// Trip creation (app/page.tsx -> app/api/trips/create) sends the brief
// fields as plain extra keys on that same request body -- no separate
// call, and no ownership concept yet (the trip doesn't exist until this
// request creates it). EditorialBriefValidated's own shape (the output
// of validateEditorialBrief) IS that payload; app/page.tsx spreads it
// straight into the request body it already builds.
