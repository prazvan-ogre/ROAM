// Diacritics-aware slugify for a trip's destination (e.g. "Corfu, Grecia"
// -> "corfu-grecia"). Not cryptographically anything -- the actual
// collision safety for public trip creation comes from the random suffix
// appended in app/api/trips/create/route.ts, this just keeps the slug
// readable.
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
