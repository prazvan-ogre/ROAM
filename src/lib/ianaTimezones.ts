// R6 follow-up: the trip's timezone belongs to the DESTINATION, not to
// whoever fills in the creation form -- app/page.tsx's picker below must
// never default to the browser's own Intl-resolved zone
// (Intl.DateTimeFormat().resolvedOptions().timeZone), which is the
// CREATOR's device, not the place the trip is actually happening.
//
// This is a curated MVP list, not a geocoding service: every real-world
// destination has a timezone, but mapping arbitrary free-text destination
// strings to one precisely would need an actual place lookup (out of
// scope for this batch -- see the R6 follow-up report's "cazuri
// speciale" section). suggestTimezoneForDestination below is a best-
// effort, deterministic keyword hint ONLY -- it pre-selects an option in
// the picker below, never submits on its own; the person creating the
// trip always sees the selection and can change it before submitting.

export interface TimezoneOption {
  value: string; // IANA identifier, e.g. "Europe/Athens"
  label: string; // shown in the picker
}

// Grouped roughly by how often ROAM trips actually go there (Romanian
// audience, per docs/DATABASE.md -- 'ro' is the only hardcoded language),
// then by region. Add to this list as new destinations come up; it's a
// flat lookup table, not a schema, so extending it is a one-line change.
export const COMMON_DESTINATION_TIMEZONES: TimezoneOption[] = [
  { value: "Europe/Bucharest", label: "România — Europe/Bucharest" },
  { value: "Europe/Athens", label: "Grecia — Europe/Athens" },
  { value: "Europe/Istanbul", label: "Turcia — Europe/Istanbul" },
  { value: "Europe/Rome", label: "Italia — Europe/Rome" },
  { value: "Europe/Madrid", label: "Spania — Europe/Madrid" },
  { value: "Europe/Lisbon", label: "Portugalia — Europe/Lisbon" },
  { value: "Europe/Paris", label: "Franța — Europe/Paris" },
  { value: "Europe/London", label: "Marea Britanie — Europe/London" },
  { value: "Europe/Berlin", label: "Germania — Europe/Berlin" },
  { value: "Europe/Vienna", label: "Austria — Europe/Vienna" },
  { value: "Europe/Zurich", label: "Elveția — Europe/Zurich" },
  { value: "Europe/Zagreb", label: "Croația — Europe/Zagreb" },
  { value: "Europe/Sofia", label: "Bulgaria — Europe/Sofia" },
  { value: "Europe/Budapest", label: "Ungaria — Europe/Budapest" },
  { value: "Europe/Prague", label: "Cehia — Europe/Prague" },
  { value: "Europe/Warsaw", label: "Polonia — Europe/Warsaw" },
  { value: "Europe/Amsterdam", label: "Olanda — Europe/Amsterdam" },
  { value: "Africa/Cairo", label: "Egipt — Africa/Cairo" },
  { value: "Asia/Dubai", label: "Emiratele Arabe Unite — Asia/Dubai" },
  { value: "Asia/Bangkok", label: "Thailanda — Asia/Bangkok" },
  { value: "Asia/Makassar", label: "Indonezia (Bali) — Asia/Makassar" },
  { value: "Asia/Singapore", label: "Singapore — Asia/Singapore" },
  { value: "Asia/Tokyo", label: "Japonia — Asia/Tokyo" },
  { value: "America/New_York", label: "SUA (Est) — America/New_York" },
  { value: "America/Chicago", label: "SUA (Central) — America/Chicago" },
  { value: "America/Denver", label: "SUA (Munte) — America/Denver" },
  { value: "America/Los_Angeles", label: "SUA (Pacific) — America/Los_Angeles" },
  { value: "America/Cancun", label: "Mexic — America/Cancun" },
  { value: "Australia/Sydney", label: "Australia — Australia/Sydney" },
  { value: "Pacific/Auckland", label: "Noua Zeelandă — Pacific/Auckland" },
  { value: "UTC", label: "UTC" },
];

// Ordered, first match wins -- deliberately simple substring/regex
// matching on the raw destination text, no external lookup. A miss
// returns null and the picker is left exactly as it was (the person
// picks manually); this never blocks submission on its own.
const DESTINATION_TIMEZONE_HINTS: Array<{ pattern: RegExp; timezone: string }> = [
  {
    pattern: /grecia|greece|corfu|creta|crete|rodos|rhodes|santorini|athena|athens|halkidiki|kassandra|mykonos|zakynthos|corint/i,
    timezone: "Europe/Athens",
  },
  { pattern: /turcia|turkey|antalya|istanbul|bodrum|alanya/i, timezone: "Europe/Istanbul" },
  { pattern: /italia|italy|roma\b|rome|venetia|venice|sicilia|sardinia|toscana/i, timezone: "Europe/Rome" },
  { pattern: /spania|spain|barcelona|madrid|mallorca|tenerife|canare/i, timezone: "Europe/Madrid" },
  { pattern: /portugalia|portugal|lisabona|lisbon|algarve|madeira/i, timezone: "Europe/Lisbon" },
  { pattern: /franta|france|\bparis\b|nisa|nice|provence/i, timezone: "Europe/Paris" },
  { pattern: /anglia|england|regatul unit|united kingdom|londra|london|scotia|scotland/i, timezone: "Europe/London" },
  { pattern: /germania|germany|berlin|munchen|münchen|munich/i, timezone: "Europe/Berlin" },
  { pattern: /austria|viena|vienna/i, timezone: "Europe/Vienna" },
  { pattern: /elvetia|elveția|switzerland|zurich|geneva/i, timezone: "Europe/Zurich" },
  { pattern: /croatia|croația|zagreb|dubrovnik|split/i, timezone: "Europe/Zagreb" },
  { pattern: /bulgaria|sofia|sunny beach|nisipurile de aur/i, timezone: "Europe/Sofia" },
  { pattern: /ungaria|hungary|budapesta|budapest/i, timezone: "Europe/Budapest" },
  { pattern: /cehia|czech|praga|prague/i, timezone: "Europe/Prague" },
  { pattern: /polonia|poland|varsovia|warsaw|cracovia|krakow/i, timezone: "Europe/Warsaw" },
  { pattern: /olanda|netherlands|amsterdam/i, timezone: "Europe/Amsterdam" },
  { pattern: /egipt|egypt|hurghada|sharm/i, timezone: "Africa/Cairo" },
  { pattern: /dubai|emirate|abu dhabi|\buae\b/i, timezone: "Asia/Dubai" },
  { pattern: /thailanda|thailand|phuket|bangkok/i, timezone: "Asia/Bangkok" },
  { pattern: /\bbali\b/i, timezone: "Asia/Makassar" },
  { pattern: /singapore/i, timezone: "Asia/Singapore" },
  { pattern: /japonia|japan|tokyo|osaka|kyoto/i, timezone: "Asia/Tokyo" },
  { pattern: /california|los angeles/i, timezone: "America/Los_Angeles" },
  { pattern: /mexic|mexico|cancun/i, timezone: "America/Cancun" },
  { pattern: /new york|florida|miami|statele unite|\busa\b|\bs\.?u\.?a\.?\b/i, timezone: "America/New_York" },
  { pattern: /australia|sydney/i, timezone: "Australia/Sydney" },
  { pattern: /noua zeelanda|noua zeelandă|new zealand|auckland/i, timezone: "Pacific/Auckland" },
];

export function suggestTimezoneForDestination(destination: string): string | null {
  const normalized = destination.trim();
  if (!normalized) return null;
  for (const hint of DESTINATION_TIMEZONE_HINTS) {
    if (hint.pattern.test(normalized)) return hint.timezone;
  }
  return null;
}
