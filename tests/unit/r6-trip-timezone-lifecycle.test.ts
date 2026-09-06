// R6 regression/coverage: the trip calendar's timezone model --
// scheduled/active/ended lifecycle (src/lib/trip.ts), the Morning/Lunch/
// Battle windows computed in the trip's own IANA zone (src/lib/schedule.ts),
// and the shared zoned-date arithmetic both are built on
// (src/lib/timezone.ts). Every case here passes an explicit `now`/`date`
// argument rather than mocking the system clock -- every function under
// test already takes time as a parameter, so a controlled clock is just
// passing a fixed Date, no fake-timer setup needed.
//
// Mirrors (deliberately, not by accident) the day/status arithmetic in
// supabase/migrations/20260907140000_r6_trip_timezone_and_lifecycle.sql's
// record_answer() -- see supabase/tests/r6_trip_timezone_lifecycle.test.sql
// for the server-side counterpart of the scheduled/active/ended cases here.
import { describe, it, expect } from "vitest";
import {
  getTripTemporalState,
  currentTripDay,
  getTripTimezone,
  type Trip,
} from "@/lib/trip";
import { getSlotAvailability, getNextWindowOpening } from "@/lib/schedule";
import {
  getZonedDateParts,
  formatZonedDateKey,
  zonedWallTimeToUtc,
  parseDateOnly,
  daysBetweenDateOnly,
  DEFAULT_TRIP_TIMEZONE,
} from "@/lib/timezone";

function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: "trip-1",
    slug: "trip-1",
    name: "Test Trip",
    language: "ro",
    start_date: "2026-06-10",
    duration_days: 5,
    destination: null,
    location_info: null,
    content_status: "ready",
    is_active: true,
    is_demo: false,
    created_at: "2026-01-01T00:00:00Z",
    timezone: "Europe/Bucharest",
    ...overrides,
  };
}

describe("src/lib/timezone.ts -- zoned date/time primitives", () => {
  it("getZonedDateParts reads the correct wall clock in a positive-offset zone (UTC+2/+3)", () => {
    // 2026-06-10T10:00:00Z, mid-DST (EEST, UTC+3) -> 13:00 local.
    const parts = getZonedDateParts(new Date("2026-06-10T10:00:00Z"), "Europe/Bucharest");
    expect(parts).toEqual({ year: 2026, month: 6, day: 10, hour: 13, minute: 0, second: 0 });
  });

  it("getZonedDateParts reads the correct wall clock in a negative-offset zone (UTC-5, no DST)", () => {
    // America/Bogota is a fixed UTC-5, no DST -- a clean negative-offset case.
    const parts = getZonedDateParts(new Date("2026-06-10T10:00:00Z"), "America/Bogota");
    expect(parts).toEqual({ year: 2026, month: 6, day: 10, hour: 5, minute: 0, second: 0 });
  });

  it("a date-only string just after UTC midnight rolls back a calendar day in a negative-offset zone", () => {
    // This is exactly the failure mode the R6 report flags: naive local
    // getters on a UTC-parsed instant read back the PREVIOUS day west of
    // UTC. getZonedDateParts must show that correctly (Jun 9 local), not
    // hide it -- callers are expected to reason from trip-local parts, not
    // from the device's own local getters.
    const parts = getZonedDateParts(new Date("2026-06-10T02:00:00Z"), "America/Los_Angeles");
    expect(parts.day).toBe(9);
    expect(parts.hour).toBe(19); // 2026-06-09T19:00 PDT (UTC-7 in summer)
  });

  it("Europe/Bucharest and Europe/Athens agree (same EU DST rules, same offset)", () => {
    const instant = new Date("2026-06-10T10:00:00Z");
    expect(getZonedDateParts(instant, "Europe/Bucharest")).toEqual(getZonedDateParts(instant, "Europe/Athens"));
  });

  it("DST spring-forward (Europe/Bucharest, 2026-03-29): offset jumps from +2 to +3 at 01:00 UTC", () => {
    const before = getZonedDateParts(new Date("2026-03-29T00:30:00Z"), "Europe/Bucharest");
    const after = getZonedDateParts(new Date("2026-03-29T01:30:00Z"), "Europe/Bucharest");
    expect(before).toEqual({ year: 2026, month: 3, day: 29, hour: 2, minute: 30, second: 0 });
    expect(after).toEqual({ year: 2026, month: 3, day: 29, hour: 4, minute: 30, second: 0 });
  });

  it("DST fall-back (Europe/Bucharest, 2026-10-25): offset drops from +3 to +2 at 01:00 UTC, 03:xx repeats", () => {
    const beforeFallback = getZonedDateParts(new Date("2026-10-25T00:30:00Z"), "Europe/Bucharest"); // EEST, +3
    const afterFallback = getZonedDateParts(new Date("2026-10-25T01:30:00Z"), "Europe/Bucharest"); // EET, +2
    // Same wall-clock reading (03:30) for two real instants an hour apart --
    // this is the expected ambiguity of a fall-back transition, not a bug;
    // the point of this test is that neither call throws or silently jumps
    // a whole day, and the date itself stays 2026-10-25 on both sides.
    expect(beforeFallback).toEqual({ year: 2026, month: 10, day: 25, hour: 3, minute: 30, second: 0 });
    expect(afterFallback).toEqual({ year: 2026, month: 10, day: 25, hour: 3, minute: 30, second: 0 });
  });

  it("midnight local reads as hour 0, not 24", () => {
    // 2026-06-09T22:00:00Z is exactly midnight in Europe/Bucharest (+2 in
    // this case? mid-June is EEST/+3 -> 2026-06-10T01:00 local; use a UTC
    // instant that lands exactly on Bucharest midnight instead).
    const parts = getZonedDateParts(new Date("2026-06-09T21:00:00Z"), "Europe/Bucharest"); // +3 -> 00:00 local Jun 10
    expect(parts).toEqual({ year: 2026, month: 6, day: 10, hour: 0, minute: 0, second: 0 });
  });

  it("formatZonedDateKey and parseDateOnly/daysBetweenDateOnly round-trip without device-timezone influence", () => {
    const key = formatZonedDateKey(new Date("2026-06-10T10:00:00Z"), "Europe/Bucharest");
    expect(key).toBe("2026-06-10");
    const parsed = parseDateOnly(key);
    expect(parsed).toEqual({ year: 2026, month: 6, day: 10 });
    expect(daysBetweenDateOnly({ year: 2026, month: 6, day: 15 }, parsed)).toBe(5);
  });

  it("zonedWallTimeToUtc is the inverse of getZonedDateParts (round-trips a wall-clock target)", () => {
    const target = { year: 2026, month: 6, day: 10, hour: 7, minute: 0, second: 0 };
    const utc = zonedWallTimeToUtc(target, "Europe/Bucharest");
    expect(getZonedDateParts(utc, "Europe/Bucharest")).toEqual(target);
  });

  it("device timezone never leaks in -- two different zones read the same instant independently", () => {
    const instant = new Date("2026-06-10T12:00:00Z");
    const bucharest = getZonedDateParts(instant, "Europe/Bucharest"); // +3 -> 15:00
    const honolulu = getZonedDateParts(instant, "Pacific/Honolulu"); // -10, no DST -> 02:00 same day
    expect(bucharest.hour).toBe(15);
    expect(honolulu.hour).toBe(2);
    expect(honolulu.day).toBe(10);
  });
});

describe("src/lib/trip.ts -- getTripTemporalState / currentTripDay (scheduled/active/ended)", () => {
  it("before start -- scheduled, with daysUntilStart computed in the trip's own zone", () => {
    const trip = makeTrip({ start_date: "2026-06-10" });
    // Two days before, at 10:00 UTC (well inside the Bucharest calendar day).
    const state = getTripTemporalState(trip, new Date("2026-06-08T10:00:00Z"));
    expect(state.status).toBe("scheduled");
    expect(state.daysUntilStart).toBe(2);
    expect(state.day).toBe(1);
  });

  it("exactly the first instant of the start day (00:00 local) is already active, day 1", () => {
    const trip = makeTrip({ start_date: "2026-06-10", timezone: "Europe/Bucharest" });
    // 2026-06-10T00:00:00 Bucharest local = 2026-06-09T21:00:00Z (EEST, +3).
    const state = getTripTemporalState(trip, new Date("2026-06-09T21:00:00Z"));
    expect(state.status).toBe("active");
    expect(state.day).toBe(1);
  });

  it("one second before the start day begins (local) is still scheduled", () => {
    const trip = makeTrip({ start_date: "2026-06-10", timezone: "Europe/Bucharest" });
    const state = getTripTemporalState(trip, new Date("2026-06-09T20:59:59Z"));
    expect(state.status).toBe("scheduled");
  });

  it("exactly the last instant of the last day (23:59:59 local) is still active", () => {
    const trip = makeTrip({ start_date: "2026-06-10", duration_days: 5, timezone: "Europe/Bucharest" });
    // Last day is 2026-06-14. 23:59:59 Bucharest local (EEST, +3) = 2026-06-14T20:59:59Z.
    const state = getTripTemporalState(trip, new Date("2026-06-14T20:59:59Z"));
    expect(state.status).toBe("active");
    expect(state.day).toBe(5);
  });

  it("the first instant after the last day (00:00 local, day 6) is ended", () => {
    const trip = makeTrip({ start_date: "2026-06-10", duration_days: 5, timezone: "Europe/Bucharest" });
    const state = getTripTemporalState(trip, new Date("2026-06-14T21:00:00Z"));
    expect(state.status).toBe("ended");
    expect(state.day).toBe(5); // clamped -- the day it ended on
  });

  it("well after the last day stays ended (never re-opens)", () => {
    const trip = makeTrip({ start_date: "2026-06-10", duration_days: 5, timezone: "Europe/Bucharest" });
    const state = getTripTemporalState(trip, new Date("2026-08-01T00:00:00Z"));
    expect(state.status).toBe("ended");
  });

  it("a positive-UTC-offset zone (Europe/Bucharest, UTC+2/+3)", () => {
    const trip = makeTrip({ start_date: "2026-06-10", timezone: "Europe/Bucharest" });
    // 2026-06-10T21:30:00Z is already 2026-06-11 00:30 local -> day 2.
    const state = getTripTemporalState(trip, new Date("2026-06-10T21:30:00Z"));
    expect(state.day).toBe(2);
  });

  it("a negative-UTC-offset zone (America/Los_Angeles, UTC-7/-8)", () => {
    const trip = makeTrip({ start_date: "2026-06-10", timezone: "America/Los_Angeles" });
    // 2026-06-10T23:00:00Z is only 16:00 local on Jun 10 (PDT, -7) -- still day 1,
    // even though it's already Jun 11 in UTC and in most of the world.
    const state = getTripTemporalState(trip, new Date("2026-06-10T23:00:00Z"));
    expect(state.day).toBe(1);
    expect(state.status).toBe("active");
  });

  it("Europe/Athens behaves identically to Europe/Bucharest for the same trip dates", () => {
    const bucharest = makeTrip({ timezone: "Europe/Bucharest" });
    const athens = makeTrip({ timezone: "Europe/Athens" });
    const now = new Date("2026-06-12T22:30:00Z");
    expect(getTripTemporalState(bucharest, now)).toEqual(getTripTemporalState(athens, now));
  });

  it("DST spring-forward day still counts as exactly one calendar day, not zero or two", () => {
    // Trip spans the 2026-03-29 spring-forward in Europe/Bucharest.
    const trip = makeTrip({ start_date: "2026-03-28", duration_days: 5, timezone: "Europe/Bucharest" });
    const dayOfTransition = getTripTemporalState(trip, new Date("2026-03-29T12:00:00Z"));
    const dayAfter = getTripTemporalState(trip, new Date("2026-03-30T12:00:00Z"));
    expect(dayOfTransition.day).toBe(2);
    expect(dayAfter.day).toBe(3);
  });

  it("DST fall-back day still counts as exactly one calendar day", () => {
    const trip = makeTrip({ start_date: "2026-10-24", duration_days: 5, timezone: "Europe/Bucharest" });
    const dayOfTransition = getTripTemporalState(trip, new Date("2026-10-25T12:00:00Z"));
    const dayAfter = getTripTemporalState(trip, new Date("2026-10-26T12:00:00Z"));
    expect(dayOfTransition.day).toBe(2);
    expect(dayAfter.day).toBe(3);
  });

  it("start_date (date-only) never shifts a day under a negative-offset trip timezone", () => {
    // The historical bug this migration/report calls out: naive `new
    // Date(start_date)` + local getters could read the wrong day. Here the
    // trip itself is in a negative-offset zone and the check is exact: the
    // very first local instant of start_date must be day 1, not day 0/2.
    const trip = makeTrip({ start_date: "2026-01-01", timezone: "America/Los_Angeles" });
    // 2026-01-01T00:00:00 PST (UTC-8) = 2026-01-01T08:00:00Z.
    const justAfterMidnight = getTripTemporalState(trip, new Date("2026-01-01T08:00:00Z"));
    const justBeforeMidnight = getTripTemporalState(trip, new Date("2026-01-01T07:59:59Z"));
    expect(justAfterMidnight.status).toBe("active");
    expect(justAfterMidnight.day).toBe(1);
    expect(justBeforeMidnight.status).toBe("scheduled");
  });

  it("a device in a different timezone than the trip does not affect the result (no device tz is ever read)", () => {
    // getTripTemporalState never touches Date's own local getters or
    // Intl's default timezone -- only the explicit trip.timezone. Proven
    // here by checking two zones far apart at the exact same instant give
    // the day/status their OWN local calendars say, independent of each
    // other and of whatever zone this test process itself runs in.
    const instant = new Date("2026-06-10T23:30:00Z"); // already Jun 11 in Bucharest, still Jun 10 in Honolulu
    const bucharestTrip = makeTrip({ start_date: "2026-06-11", timezone: "Europe/Bucharest" });
    const honoluluTrip = makeTrip({ start_date: "2026-06-11", timezone: "Pacific/Honolulu" });
    expect(getTripTemporalState(bucharestTrip, instant).status).toBe("active");
    expect(getTripTemporalState(honoluluTrip, instant).status).toBe("scheduled");
  });

  it("missing timezone (pre-R6 trip) falls back to the documented default (Europe/Bucharest)", () => {
    const trip = makeTrip({ timezone: null });
    expect(getTripTimezone(trip)).toBe(DEFAULT_TRIP_TIMEZONE);
    expect(DEFAULT_TRIP_TIMEZONE).toBe("Europe/Bucharest");
    const withDefault = makeTrip({ start_date: "2026-06-10", timezone: null });
    const withExplicitBucharest = makeTrip({ start_date: "2026-06-10", timezone: "Europe/Bucharest" });
    const now = new Date("2026-06-10T10:00:00Z");
    expect(getTripTemporalState(withDefault, now)).toEqual(getTripTemporalState(withExplicitBucharest, now));
  });

  it("a trip with no start_date at all stays permanently active (no schedule to enforce)", () => {
    const trip = makeTrip({ start_date: null });
    expect(getTripTemporalState(trip, new Date("2099-01-01T00:00:00Z")).status).toBe("active");
  });

  it("currentTripDay is a thin back-compat wrapper around getTripTemporalState().day", () => {
    const trip = makeTrip({ start_date: "2026-06-10", duration_days: 5, timezone: "Europe/Bucharest" });
    const now = new Date("2026-06-12T10:00:00Z");
    expect(currentTripDay(trip, now)).toBe(getTripTemporalState(trip, now).day);
  });
});

describe("src/lib/schedule.ts -- Morning/Lunch/Battle windows in the trip's own timezone", () => {
  it("getSlotAvailability reads the trip's zone, not the device's", () => {
    // 09:00 Bucharest local (mid-DST, +3) = 06:00 UTC -- inside Morning's
    // 07:00-11:59 window in Bucharest, but would read as "before" if this
    // were (wrongly) evaluated in UTC or in a device set to e.g. UTC-5.
    const now = new Date("2026-06-10T06:00:00Z");
    expect(getSlotAvailability("morning", "Europe/Bucharest", now).status).toBe("open");
    expect(getSlotAvailability("morning", "America/New_York", now).status).toBe("before"); // 02:00 local there
  });

  it("boundary: the exact opening minute is open, the minute before is before", () => {
    const zone = "Europe/Bucharest";
    // 2026-06-10T04:00:00Z = 07:00 local (EEST, +3) -- Morning's opening minute.
    expect(getSlotAvailability("morning", zone, new Date("2026-06-10T03:59:59Z")).status).toBe("before");
    expect(getSlotAvailability("morning", zone, new Date("2026-06-10T04:00:00Z")).status).toBe("open");
  });

  it("boundary: the exact closing minute is still open, the minute after is after", () => {
    const zone = "Europe/Bucharest";
    // Morning closes at 11:59 local = 2026-06-10T08:59:00Z (EEST, +3).
    expect(getSlotAvailability("morning", zone, new Date("2026-06-10T08:59:00Z")).status).toBe("open");
    expect(getSlotAvailability("morning", zone, new Date("2026-06-10T09:00:00Z")).status).toBe("after");
  });

  it("Battle's window (19:00-23:00 local) around a DST spring-forward day is unaffected (well clear of the 01:00-04:00 transition)", () => {
    const zone = "Europe/Bucharest";
    // 2026-03-29 is the spring-forward day (EEST/+3 from 01:00 UTC on).
    // 20:00 local = 17:00 UTC.
    expect(getSlotAvailability("battle", zone, new Date("2026-03-29T17:00:00Z")).status).toBe("open");
  });

  it("Battle's window around a DST fall-back day is unaffected", () => {
    const zone = "Europe/Bucharest";
    // 2026-10-25 is the fall-back day (EET/+2 from 01:00 UTC on).
    // 20:00 local = 18:00 UTC.
    expect(getSlotAvailability("battle", zone, new Date("2026-10-25T18:00:00Z")).status).toBe("open");
  });

  it("getNextWindowOpening wraps to tomorrow's Morning, in the trip's own zone, after Battle's start has passed", () => {
    const zone = "Europe/Bucharest";
    // 2026-06-10T21:00:00Z = 2026-06-11T00:00 local -- after Battle (19:00)
    // has started; next window is tomorrow's (Jun 11) Morning at 07:00 local.
    const now = new Date("2026-06-10T21:00:00Z");
    const next = getNextWindowOpening(zone, now);
    expect(next.slot).toBe("morning");
    expect(getZonedDateParts(next.opensAt, zone)).toEqual({
      year: 2026,
      month: 6,
      day: 11,
      hour: 7,
      minute: 0,
      second: 0,
    });
  });

  it("getNextWindowOpening returns a real absolute instant, correct no matter what zone it's read back in", () => {
    const zone = "America/Los_Angeles";
    const now = new Date("2026-06-10T10:00:00Z"); // 03:00 local -- before Morning
    const next = getNextWindowOpening(zone, now);
    expect(next.slot).toBe("morning");
    expect(getZonedDateParts(next.opensAt, zone).hour).toBe(7);
    // The instant itself is zone-independent -- reading it back in a wholly
    // different zone must agree it's the same real moment (07:00 PDT ==
    // 17:00 EEST on the same day, a fixed 10h difference in June).
    expect(getZonedDateParts(next.opensAt, "Europe/Bucharest").hour).toBe(17);
  });
});
