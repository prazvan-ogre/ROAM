import { MAX_NARRATOR_CHARACTER_NAME_LENGTH } from "@/lib/constants";
import type { EditorialBriefFieldErrors } from "@/lib/editorialBrief";
import type { TripDifficulty, TripQuestionStyle } from "@/lib/supabase/types";

// Shared form fields for the trip editorial brief -- difficulty,
// thematic distribution, writing style -- used identically by the
// public creation form (app/page.tsx) and the pre-publish edit form
// (app/trip/[slug]/settings/page.tsx's "Brief editorial" tab), so the
// two never drift into looking or behaving differently. A pure,
// controlled component: every value and every change handler is owned
// by the caller, which also owns calling validateEditorialBrief
// (src/lib/editorialBrief.ts) and passing back its field errors.

const DIFFICULTY_OPTIONS: { value: TripDifficulty; label: string }[] = [
  { value: "easy", label: "Ușor" },
  { value: "medium", label: "Mediu" },
  { value: "hard", label: "Dificil" },
];

const STYLE_OPTIONS: { value: TripQuestionStyle; label: string }[] = [
  { value: "fun", label: "Amuzant" },
  { value: "academic", label: "Academic" },
  { value: "narrated_by_character", label: "Narat de un personaj istoric" },
];

// Reused for the read-only post-publish summary (app/trip/[slug]/
// settings/page.tsx) so the label text never drifts from the picker's
// own option labels above.
export const DIFFICULTY_LABEL: Record<TripDifficulty, string> = Object.fromEntries(
  DIFFICULTY_OPTIONS.map((o) => [o.value, o.label]),
) as Record<TripDifficulty, string>;
export const STYLE_LABEL: Record<TripQuestionStyle, string> = Object.fromEntries(
  STYLE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<TripQuestionStyle, string>;

const THEME_FIELDS = [
  { key: "history", label: "Istorie" },
  { key: "places", label: "Locuri de vizitat" },
  { key: "food", label: "Gastronomie locală" },
  { key: "curiosities", label: "Curiozități locale" },
] as const;

export const THEME_FIELD_LABELS: Record<(typeof THEME_FIELDS)[number]["key"], string> = Object.fromEntries(
  THEME_FIELDS.map((f) => [f.key, f.label]),
) as Record<(typeof THEME_FIELDS)[number]["key"], string>;

export interface EditorialBriefFieldsValue {
  difficulty: TripDifficulty;
  style: TripQuestionStyle;
  narratorCharacterName: string;
  themeHistory: string;
  themePlaces: string;
  themeFood: string;
  themeCuriosities: string;
}

export interface EditorialBriefFieldsProps {
  value: EditorialBriefFieldsValue;
  onChange: (next: EditorialBriefFieldsValue) => void;
  errors: EditorialBriefFieldErrors;
  disabled?: boolean;
}

function themePercentToString(n: number): string {
  return String(n);
}

export function themeDefaultsAsStrings(defaults: { history: number; places: number; food: number; curiosities: number }) {
  return {
    themeHistory: themePercentToString(defaults.history),
    themePlaces: themePercentToString(defaults.places),
    themeFood: themePercentToString(defaults.food),
    themeCuriosities: themePercentToString(defaults.curiosities),
  };
}

export function EditorialBriefFields({ value, onChange, errors, disabled }: EditorialBriefFieldsProps) {
  const themeValues: Record<(typeof THEME_FIELDS)[number]["key"], string> = {
    history: value.themeHistory,
    places: value.themePlaces,
    food: value.themeFood,
    curiosities: value.themeCuriosities,
  };
  const themeErrors: Record<(typeof THEME_FIELDS)[number]["key"], string | undefined> = {
    history: errors.themeHistory,
    places: errors.themePlaces,
    food: errors.themeFood,
    curiosities: errors.themeCuriosities,
  };
  const themeTotal = THEME_FIELDS.reduce((sum, f) => sum + (Number(themeValues[f.key]) || 0), 0);

  function setTheme(key: (typeof THEME_FIELDS)[number]["key"], v: string) {
    onChange({
      ...value,
      themeHistory: key === "history" ? v : value.themeHistory,
      themePlaces: key === "places" ? v : value.themePlaces,
      themeFood: key === "food" ? v : value.themeFood,
      themeCuriosities: key === "curiosities" ? v : value.themeCuriosities,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">Dificultate</p>
        <div className="flex rounded-[10px] bg-secondary p-1">
          {DIFFICULTY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, difficulty: opt.value })}
              className={`flex-1 rounded-[7px] py-2 text-[14px] font-semibold transition-all duration-200 disabled:opacity-60 ${
                value.difficulty === opt.value
                  ? "bg-card text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.10)]"
                  : "text-muted-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {errors.difficulty && <p className="mt-1.5 text-[12px] text-destructive">{errors.difficulty}</p>}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[13px] font-medium text-muted-foreground">Distribuție tematică</p>
          <p className={`text-[12px] font-semibold ${themeTotal === 100 ? "text-muted-foreground" : "text-destructive"}`}>
            Total: {themeTotal}%
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {THEME_FIELDS.map((f) => (
            <div key={f.key}>
              <label htmlFor={`theme-${f.key}`} className="mb-1 block text-[12px] text-muted-foreground">
                {f.label}
              </label>
              <div className="relative">
                <input
                  id={`theme-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  disabled={disabled}
                  value={themeValues[f.key]}
                  onChange={(e) => setTheme(f.key, e.target.value)}
                  className="w-full rounded-xl border border-border bg-card px-3 py-3 pr-7 text-[15px] text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-disabled">%</span>
              </div>
              {themeErrors[f.key] && <p className="mt-1 text-[11px] text-destructive">{themeErrors[f.key]}</p>}
            </div>
          ))}
        </div>
        {errors.themeTotal && <p className="mt-1.5 text-[12px] text-destructive">{errors.themeTotal}</p>}
        <p className="mt-1.5 text-[12px] text-disabled">O categorie poate avea 0% -- procentele trebuie doar să însumeze exact 100%.</p>
      </div>

      <div>
        <p className="mb-1.5 text-[13px] font-medium text-muted-foreground">Stil de formulare</p>
        <div className="flex flex-col gap-2">
          {STYLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange({ ...value, style: opt.value })}
              className={`rounded-2xl border px-4 py-3 text-left text-[15px] font-medium transition-all disabled:opacity-60 ${
                value.style === opt.value ? "border-primary bg-accent text-foreground" : "border-border bg-card text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {errors.style && <p className="mt-1.5 text-[12px] text-destructive">{errors.style}</p>}
      </div>

      {value.style === "narrated_by_character" && (
        <div>
          <label htmlFor="narratorCharacterName" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
            Numele personajului istoric
          </label>
          <input
            id="narratorCharacterName"
            value={value.narratorCharacterName}
            onChange={(e) => onChange({ ...value, narratorCharacterName: e.target.value })}
            placeholder="ex. Ștefan cel Mare"
            maxLength={MAX_NARRATOR_CHARACTER_NAME_LENGTH}
            disabled={disabled}
            className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-[15px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary disabled:opacity-60"
          />
          {errors.narratorCharacterName && (
            <p className="mt-1.5 text-[12px] text-destructive">{errors.narratorCharacterName}</p>
          )}
          <p className="mt-1.5 text-[12px] text-disabled">
            Stilul narativ e o interpretare creativă inspirată de personaj -- informațiile factuale rămân corecte.
          </p>
        </div>
      )}
    </div>
  );
}
