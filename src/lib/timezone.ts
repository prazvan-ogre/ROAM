// R6: shared IANA-timezone-aware date/time helpers for the trip calendar.
// A JS `Date` always represents one absolute instant -- "which day/hour it
// is" only means something once you pick a zone to read it in.
// Everything here reads it in an explicit IANA zone (via
// Intl.DateTimeFormat's `timeZone` option), never the device's own -- so a
// participant travelling with their phone set to a different zone than the
// trip's still sees the trip's own day/hour, and a device clock/timezone
// change can never shift which window looks open.

export const DEFAULT_TRIP_TIMEZONE = "Europe/Bucharest";

export interface ZonedDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

export function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  // Some engines render midnight as "24" under hour12: false -- normalized
  // back to 0 so minute-of-day arithmetic downstream isn't off by a day.
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

export function formatZonedDateKey(date: Date, timeZone: string): string {
  const { year, month, day } = getZonedDateParts(date, timeZone);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

// Converts a wall-clock date/time meant to be read IN `timeZone` into the
// real UTC instant it corresponds to -- the inverse of getZonedDateParts.
// Standard two-pass approach: guess the instant by treating the wall clock
// as if it were already UTC, see what `timeZone` actually reads at that
// guess, then correct by the difference between the two. One correction is
// enough except within the handful of minutes spanning a DST transition
// itself, which this feature (countdown display only) doesn't need to
// resolve to the second.
export function zonedWallTimeToUtc(parts: ZonedDateParts, timeZone: string): Date {
  const guessMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const guessZoned = getZonedDateParts(new Date(guessMs), timeZone);
  const guessZonedMs = Date.UTC(
    guessZoned.year,
    guessZoned.month - 1,
    guessZoned.day,
    guessZoned.hour,
    guessZoned.minute,
    guessZoned.second,
  );
  return new Date(guessMs + (guessMs - guessZonedMs));
}

// Parses a date-only "YYYY-MM-DD" string (e.g. trips.start_date) into its
// literal calendar components -- never through `new Date(str)`, whose
// local-timezone getters (getFullYear/getMonth/getDate) can read back a
// different calendar day than the string itself says when the runtime's
// own local timezone has a negative UTC offset.
export function parseDateOnly(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split("-").map(Number);
  return { year, month, day };
}

export function daysBetweenDateOnly(
  a: { year: number; month: number; day: number },
  b: { year: number; month: number; day: number },
): number {
  return Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000);
}
