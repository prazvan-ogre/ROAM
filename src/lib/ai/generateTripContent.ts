// Server-only: calls the Claude API to draft a new public trip's full
// Discover/Battle content (product owner request -- "platforma ar trebui
// sa genereze intrebarile automat, pastrand aceeasi logica si obiectiv
// de invatare ca pentru Kassandra"). Everything this returns is inserted
// with the schema's own defaults, verified=false/published=false --
// exactly the same "AI-authored content stays hidden until a human
// reviews it" rule Kassandra's seed content followed. This module only
// drafts and validates the content; app/api/trips/create/route.ts does
// the actual inserting.

export const BATTLE_QUESTIONS_PER_DAY = 3;
export const FINAL_BATTLE_QUESTIONS = 5;
const OPTIONS_PER_QUESTION = 4;

const EXTRA_TYPES = ["know", "think", "connect", "ask", "explore"] as const;
type ExtraType = (typeof EXTRA_TYPES)[number];

export interface GeneratedOption {
  label: string;
  isCorrect: boolean;
}

export interface GeneratedExtra {
  type: ExtraType;
  title: string;
  description: string;
}

export interface GeneratedExploreLink {
  title: string;
  url: string;
}

export interface GeneratedDiscoverQuestion {
  prompt: string;
  options: GeneratedOption[];
  commonCore: string;
  oneThing: string;
  extra: GeneratedExtra;
  exploreLinks: GeneratedExploreLink[];
}

export interface GeneratedBattleQuestion {
  prompt: string;
  options: GeneratedOption[];
  extra: GeneratedExtra;
}

export interface GeneratedDay {
  morning: GeneratedDiscoverQuestion;
  lunch: GeneratedDiscoverQuestion;
  battleTitle: string;
  battleQuestions: GeneratedBattleQuestion[];
}

export interface GeneratedPrizeOption {
  title: string;
  description: string;
}

export interface GeneratedTripContent {
  tripName: string;
  prizeOptions: GeneratedPrizeOption[];
  days: GeneratedDay[];
  finalBattleTitle: string;
  finalBattleQuestions: GeneratedBattleQuestion[];
}

const MODEL = "claude-sonnet-5";

function buildPrompt(destination: string, durationDays: number, tripYear: number): string {
  return `Generezi conținutul pentru o nouă călătorie ROAM: un joc de familie tip trivia despre destinația "${destination}", pe ${durationDays} zile, anul ${tripYear}. Tonul e curios și cald, potrivit pentru părinți și copii deopotrivă, iar întrebările trebuie să fie corecte din punct de vedere factual (geografie, istorie, cultură, gastronomie, natură ale destinației) -- un om va revizui totul înainte de publicare, dar informația de bază trebuie să fie reală, nu inventată.

Structura pe care trebuie să o respecți exact, ca fiecare zi să aibă:
- o întrebare "Descoperă" de dimineață și una de prânz (aceeași formă amândouă)
- o "Bătălie" (Battle) de seară cu ${BATTLE_QUESTIONS_PER_DAY} întrebări
În ultima zi, pe lângă cele de mai sus, mai există și o "Bătălie finală" cu ${FINAL_BATTLE_QUESTIONS} întrebări, puțin mai grele, ca o încheiere de sezon.

Fiecare întrebare Descoperă are, pe lângă întrebare și ${OPTIONS_PER_QUESTION} variante de răspuns (exact una corectă):
- "commonCore": 2-3 propoziții care explică pe scurt răspunsul corect, ca un adult să poată extinde conversația
- "oneThing": un singur fapt suplimentar, memorabil, de o propoziție
- "extra": un bonus scurt de tip "ȘTIAI CĂ"/"GÂNDEȘTE-TE"/"CONEXIUNE"/"ÎNTREABĂ"/"EXPLOREAZĂ" (type = know/think/connect/ask/explore), cu un titlu și 1-2 propoziții
- "exploreLinks": 0-2 linkuri reale către surse publice relevante (ex. Wikipedia) despre subiect -- poți lăsa listă goală dacă nu ești sigur de un link real

Fiecare întrebare de Bătălie (normală sau finală) are doar întrebarea, ${OPTIONS_PER_QUESTION} variante (exact una corectă) și un "extra" (aceeași formă ca mai sus) -- fără commonCore/oneThing/exploreLinks.

Mai ai nevoie de:
- "tripName": un nume scurt pentru călătorie, gen "${destination} ${tripYear}"
- "prizeOptions": exact 3 opțiuni de premiu pentru echipa câștigătoare (Adulți vs Copii), fiecare cu titlu scurt și o propoziție de descriere -- ceva ce o familie chiar ar putea face/oferi (nu bani)

Răspunde STRICT cu un singur obiect JSON, fără text în plus, fără explicații, fără code fences, respectând exact această formă (typescript ca referință):

{
  "tripName": string,
  "prizeOptions": [{ "title": string, "description": string }, ... exact 3],
  "days": [
    {
      "morning": { "prompt": string, "options": [{ "label": string, "isCorrect": boolean }, ... exact ${OPTIONS_PER_QUESTION}], "commonCore": string, "oneThing": string, "extra": { "type": "know"|"think"|"connect"|"ask"|"explore", "title": string, "description": string }, "exploreLinks": [{ "title": string, "url": string }, ...] },
      "lunch": { ...aceeași formă ca "morning"... },
      "battleTitle": string,
      "battleQuestions": [{ "prompt": string, "options": [...], "extra": {...} }, ... exact ${BATTLE_QUESTIONS_PER_DAY}]
    }, ... exact ${durationDays} zile, în ordine
  ],
  "finalBattleTitle": string,
  "finalBattleQuestions": [{ "prompt": string, "options": [...], "extra": {...} }, ... exact ${FINAL_BATTLE_QUESTIONS}]
}`;
}

async function callClaude(prompt: string, durationDays: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Missing ANTHROPIC_API_KEY -- required to generate trip content.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: Math.min(2000 + durationDays * 1300, 16000),
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Claude API error ${response.status}: ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as { content?: { type: string; text?: string }[] };
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) {
    throw new Error("Claude API response had no text content.");
  }
  return text;
}

// Models sometimes wrap JSON in a ```json fence despite instructions not
// to -- stripped defensively rather than trusting the prompt alone.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : trimmed;
}

function assertOptions(options: unknown, where: string): asserts options is GeneratedOption[] {
  if (!Array.isArray(options) || options.length !== OPTIONS_PER_QUESTION) {
    throw new Error(`${where}: expected exactly ${OPTIONS_PER_QUESTION} options.`);
  }
  let correctCount = 0;
  for (const o of options) {
    if (typeof o?.label !== "string" || !o.label.trim() || typeof o?.isCorrect !== "boolean") {
      throw new Error(`${where}: malformed option.`);
    }
    if (o.isCorrect) correctCount += 1;
  }
  if (correctCount !== 1) {
    throw new Error(`${where}: expected exactly one correct option, got ${correctCount}.`);
  }
}

function assertExtra(extra: unknown, where: string): asserts extra is GeneratedExtra {
  const e = extra as Partial<GeneratedExtra> | undefined;
  if (
    !e ||
    !EXTRA_TYPES.includes(e.type as ExtraType) ||
    typeof e.title !== "string" ||
    !e.title.trim() ||
    typeof e.description !== "string" ||
    !e.description.trim()
  ) {
    throw new Error(`${where}: malformed extra.`);
  }
}

function assertExploreLinks(links: unknown, where: string): asserts links is GeneratedExploreLink[] {
  if (!Array.isArray(links)) {
    throw new Error(`${where}: exploreLinks must be an array.`);
  }
  for (const l of links) {
    if (typeof l?.title !== "string" || !l.title.trim() || typeof l?.url !== "string" || !/^https?:\/\//.test(l.url)) {
      throw new Error(`${where}: malformed exploreLink.`);
    }
  }
}

function assertBattleQuestion(q: unknown, where: string): asserts q is GeneratedBattleQuestion {
  const bq = q as Partial<GeneratedBattleQuestion> | undefined;
  if (!bq || typeof bq.prompt !== "string" || !bq.prompt.trim()) {
    throw new Error(`${where}: missing prompt.`);
  }
  assertOptions(bq.options, `${where}.options`);
  assertExtra(bq.extra, `${where}.extra`);
}

function assertDiscoverQuestion(q: unknown, where: string): asserts q is GeneratedDiscoverQuestion {
  const dq = q as Partial<GeneratedDiscoverQuestion> | undefined;
  if (
    !dq ||
    typeof dq.prompt !== "string" ||
    !dq.prompt.trim() ||
    typeof dq.commonCore !== "string" ||
    !dq.commonCore.trim() ||
    typeof dq.oneThing !== "string" ||
    !dq.oneThing.trim()
  ) {
    throw new Error(`${where}: missing required text field.`);
  }
  assertOptions(dq.options, `${where}.options`);
  assertExtra(dq.extra, `${where}.extra`);
  assertExploreLinks(dq.exploreLinks, `${where}.exploreLinks`);
}

// Throws with a specific reason on any structural mismatch -- the caller
// (app/api/trips/create/route.ts) catches this, marks the trip's
// content_status 'failed', and logs the message; nothing here is ever
// inserted half-validated.
function validate(raw: unknown, durationDays: number): GeneratedTripContent {
  const content = raw as Partial<GeneratedTripContent> | undefined;
  if (!content || typeof content.tripName !== "string" || !content.tripName.trim()) {
    throw new Error("Missing tripName.");
  }
  if (!Array.isArray(content.prizeOptions) || content.prizeOptions.length !== 3) {
    throw new Error("Expected exactly 3 prizeOptions.");
  }
  for (const p of content.prizeOptions) {
    if (typeof p?.title !== "string" || !p.title.trim() || typeof p?.description !== "string") {
      throw new Error("Malformed prizeOption.");
    }
  }
  if (!Array.isArray(content.days) || content.days.length !== durationDays) {
    throw new Error(`Expected exactly ${durationDays} days, got ${(content.days as unknown[])?.length}.`);
  }
  content.days.forEach((day, i) => {
    const d = day as Partial<GeneratedDay> | undefined;
    if (!d || typeof d.battleTitle !== "string" || !d.battleTitle.trim()) {
      throw new Error(`days[${i}]: missing battleTitle.`);
    }
    assertDiscoverQuestion(d.morning, `days[${i}].morning`);
    assertDiscoverQuestion(d.lunch, `days[${i}].lunch`);
    if (!Array.isArray(d.battleQuestions) || d.battleQuestions.length !== BATTLE_QUESTIONS_PER_DAY) {
      throw new Error(`days[${i}].battleQuestions: expected exactly ${BATTLE_QUESTIONS_PER_DAY}.`);
    }
    d.battleQuestions.forEach((q, j) => assertBattleQuestion(q, `days[${i}].battleQuestions[${j}]`));
  });
  if (typeof content.finalBattleTitle !== "string" || !content.finalBattleTitle.trim()) {
    throw new Error("Missing finalBattleTitle.");
  }
  if (!Array.isArray(content.finalBattleQuestions) || content.finalBattleQuestions.length !== FINAL_BATTLE_QUESTIONS) {
    throw new Error(`Expected exactly ${FINAL_BATTLE_QUESTIONS} finalBattleQuestions.`);
  }
  content.finalBattleQuestions.forEach((q, j) => assertBattleQuestion(q, `finalBattleQuestions[${j}]`));

  return content as GeneratedTripContent;
}

export async function generateTripContent(
  destination: string,
  durationDays: number,
  tripYear: number,
): Promise<GeneratedTripContent> {
  const prompt = buildPrompt(destination, durationDays, tripYear);
  const text = await callClaude(prompt, durationDays);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new Error(`Claude response was not valid JSON: ${text.slice(0, 500)}`);
  }

  return validate(parsed, durationDays);
}
