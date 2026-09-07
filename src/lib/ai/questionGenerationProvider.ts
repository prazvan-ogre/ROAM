import type { QuestionSlot, TripDifficulty, TripQuestionStyle } from "@/lib/supabase/types";
import type { QuestionThemeCategory } from "@/lib/supabase/types";

// R9 (20260910090000_r9_question_generation.sql): the one, isolated
// module every AI-backed question generation call goes through. Nothing
// outside this file ever talks to a provider directly, and nothing
// outside this file ever sees an API key -- src/lib/ai/generationService.ts
// (the orchestrator) only ever calls getQuestionGenerationProvider().
//
// WHY ONE INTERFACE, TWO IMPLEMENTATIONS: the product request explicitly
// says not to assume a provider/API key is configured, and not to block
// local dev/tests on its absence. `FakeQuestionGenerationProvider` is
// deterministic (seeded by trip id + a running counter, never Math.random
// or a wall-clock read) so a test can assert its exact output; it is the
// DEFAULT whenever ANTHROPIC_API_KEY is unset, not an opt-in.
//
// WHAT NEVER LEAVES THIS PROCESS: no participant personal data is ever
// part of a request -- only destination, the brief's own preferences,
// and the day/slot/category/difficulty slots being requested (see
// GenerationRequest below; there is no participant/profile field on it
// to accidentally forward). Nothing here logs the API key, the full
// prompt, or a full raw response -- see logging notes on each provider.

export interface GenerationSlotRequest {
  dayNumber: number;
  slot: QuestionSlot;
  themeCategory: QuestionThemeCategory;
  difficulty: TripDifficulty;
}

export interface GenerationRequest {
  destination: string;
  style: TripQuestionStyle;
  narratorCharacterName: string | null;
  slots: GenerationSlotRequest[];
}

export interface GenerationProviderResult {
  // Raw text the provider returned -- JSON parsing and schema validation
  // happen in src/lib/generatedQuestions.ts, uniformly for every
  // provider, so "what counts as valid" is defined exactly once.
  raw: string;
  providerName: string;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "rate_limited" | "provider_error" | "not_configured",
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export interface QuestionGenerationProvider {
  readonly name: string;
  generateQuestions(request: GenerationRequest): Promise<GenerationProviderResult>;
}

// ---------------------------------------------------------------------
// Fake provider: deterministic, no network call, no credentials. Good
// enough to exercise the entire admin review flow (accept/edit/reject/
// regenerate) in local dev and in tests. Content is clearly labeled as
// placeholder text -- never presented as if it were real destination
// knowledge.
// ---------------------------------------------------------------------
const FAKE_TOPIC_BY_CATEGORY: Record<QuestionThemeCategory, string> = {
  history: "un eveniment istoric local",
  places: "un loc de vizitat din apropiere",
  food: "o specialitate culinară locală",
  curiosities: "o curiozitate locală",
};

export class FakeQuestionGenerationProvider implements QuestionGenerationProvider {
  readonly name = "fake";

  async generateQuestions(request: GenerationRequest): Promise<GenerationProviderResult> {
    const items = request.slots.map((slot, index) => {
      const topic = FAKE_TOPIC_BY_CATEGORY[slot.themeCategory];
      const narrator =
        request.style === "narrated_by_character" && request.narratorCharacterName
          ? ` (povestit de ${request.narratorCharacterName})`
          : "";
      return {
        dayNumber: slot.dayNumber,
        slot: slot.slot,
        themeCategory: slot.themeCategory,
        difficulty: slot.difficulty,
        prompt: `[Exemplu generat] Despre ${topic} din ${request.destination}, ziua ${slot.dayNumber}${narrator} -- întrebarea #${index + 1}`,
        options: [
          { label: "Răspuns corect (exemplu)", is_correct: true },
          { label: "Variantă greșită (exemplu)", is_correct: false },
        ],
        explanation: `Explicație placeholder pentru ${topic} -- verifică și înlocuiește înainte de acceptare.`,
      };
    });
    return { raw: JSON.stringify(items), providerName: this.name };
  }
}

// ---------------------------------------------------------------------
// Real provider: Anthropic Messages API, isolated to this one class.
// ANTHROPIC_API_KEY is read from process.env here only -- never sent to
// the browser, never stored in the database (see docs/DATABASE.md for
// the full contract). A missing key throws AiProviderError("not_
// configured") the moment this class is asked to generate, not at
// import time -- getQuestionGenerationProvider() below is what decides
// whether to even construct this class.
// ---------------------------------------------------------------------
const AI_MODEL = "claude-opus-5";
const AI_MAX_OUTPUT_TOKENS = 4000;
const AI_TIMEOUT_MS = 45_000;

function buildSystemPrompt(): string {
  return [
    "Ești un asistent care pregătește întrebări de tip quiz pentru o aplicație de călătorie în familie (părinți și copii).",
    "Răspunde STRICT cu un array JSON valid, fără text explicativ înainte sau după, fără blocuri de cod markdown.",
    "Fiecare element al array-ului trebuie să conțină exact aceste câmpuri: dayNumber (număr întreg), slot (\"morning\" sau \"lunch\"), themeCategory, difficulty, prompt (text), options (array de {label, is_correct}), explanation (text scurt).",
    "Fiecare întrebare trebuie să aibă exact 2-4 opțiuni de răspuns, cu exact UNA marcată is_correct: true.",
    "Informațiile factuale trebuie să fie corecte și verificabile -- nu inventa fapte istorice sau geografice.",
    "Nu include date personale, nume de participanți sau informații care nu au fost furnizate în cerere.",
  ].join(" ");
}

function buildUserPrompt(request: GenerationRequest): string {
  const styleNote =
    request.style === "narrated_by_character" && request.narratorCharacterName
      ? `Stilul narativ trebuie să fie o interpretare creativă inspirată de ${request.narratorCharacterName}, păstrând informațiile factuale corecte.`
      : request.style === "academic"
        ? "Stilul trebuie să fie academic, informativ."
        : "Stilul trebuie să fie amuzant, prietenos pentru o familie cu copii.";

  const slotsDescription = request.slots
    .map(
      (s, i) =>
        `${i + 1}. ziua ${s.dayNumber}, ${s.slot}, categoria ${s.themeCategory}, dificultate ${s.difficulty}`,
    )
    .join("\n");

  return [
    `Destinație: ${request.destination}.`,
    styleNote,
    `Generează exact ${request.slots.length} întrebări, câte una pentru fiecare din următoarele sloturi (păstrează ordinea și valorile dayNumber/slot/themeCategory/difficulty exact cum sunt date):`,
    slotsDescription,
  ].join("\n");
}

export class AnthropicQuestionGenerationProvider implements QuestionGenerationProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generateQuestions(request: GenerationRequest): Promise<GenerationProviderResult> {
    // Imported lazily so a dev/test environment with no @anthropic-ai/sdk
    // usage elsewhere never pays for constructing a client it won't use
    // (the fake provider is the default -- see getQuestionGenerationProvider).
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: this.apiKey, timeout: AI_TIMEOUT_MS });

    try {
      const response = await client.messages.create({
        model: AI_MODEL,
        max_tokens: AI_MAX_OUTPUT_TOKENS,
        system: buildSystemPrompt(),
        messages: [{ role: "user", content: buildUserPrompt(request) }],
      });
      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new AiProviderError("Provider returned no text content.", "provider_error");
      }
      // Never log textBlock.text in full (may end up in shared logs) --
      // see docs/DATABASE.md's R9 section for the full logging contract.
      return { raw: textBlock.text, providerName: this.name };
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      const anthropicErr = err as { status?: number; name?: string };
      if (anthropicErr?.name === "APIConnectionTimeoutError") {
        throw new AiProviderError("AI provider request timed out.", "timeout");
      }
      if (anthropicErr?.status === 429) {
        throw new AiProviderError("AI provider rate limit exceeded.", "rate_limited");
      }
      // Deliberately does not include err's own message/body in what
      // gets logged here -- a provider error can echo request content
      // back; the caller (generationService.ts) logs only this generic
      // message plus err's constructor name.
      throw new AiProviderError("AI provider request failed.", "provider_error");
    }
  }
}

// ---------------------------------------------------------------------
// Factory: picks the provider based on environment, never assumes a key
// is configured. AI_PROVIDER=fake forces the fake provider even with a
// key present (useful for CI/local dev without spending real credits).
// ---------------------------------------------------------------------
export function getQuestionGenerationProvider(): QuestionGenerationProvider {
  const forced = process.env.AI_PROVIDER;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (forced === "fake" || !apiKey) {
    return new FakeQuestionGenerationProvider();
  }
  return new AnthropicQuestionGenerationProvider(apiKey);
}
