// Time-of-day availability windows, per the product owner's explicit
// request (overriding the spec's own "don't spend time on exact unlock
// times" suggestion -- this is a deliberate product decision, not an
// oversight).
//
// R6 update: these windows are now computed in the TRIP's own IANA
// timezone (trips.timezone, falling back to DEFAULT_TRIP_TIMEZONE for a
// pre-R6 trip -- see src/lib/trip.ts's getTripTimezone), not the device's.
// The original header here argued the device's local clock was fine
// because "the whole group is on the same trip in the same place" -- true
// while everyone's phone is physically there, but false the moment
// anyone's device is set to a different zone (roaming, a phone that never
// updated its auto-timezone, a family member checking in from home) or
// simply has DST-adjusted differently than the destination. record_answer()
// (20260907140000_r6_trip_timezone_and_lifecycle.sql) already evaluates
// eligibility server-side against the trip's own zone; this file just
// needs to agree with it so the UI never shows a window as open/closed
// when the server would decide the opposite.
//
// To change the windows themselves, edit WINDOWS below and redeploy -- a
// pilot with a fixed daily schedule doesn't need these to be
// database-editable.

import { DEFAULT_TRIP_TIMEZONE, getZonedDateParts, zonedWallTimeToUtc } from "./timezone";

export type ScheduledSlot = "morning" | "lunch" | "battle";

interface Window {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

const WINDOWS: Record<ScheduledSlot, Window> = {
  morning: { startHour: 7, startMinute: 0, endHour: 11, endMinute: 59 },
  lunch: { startHour: 12, startMinute: 0, endHour: 17, endMinute: 0 },
  battle: { startHour: 19, startMinute: 0, endHour: 23, endMinute: 0 },
};

export type WindowStatus = "before" | "open" | "after";

export interface SlotAvailability {
  status: WindowStatus;
  opensAt: string;
  closesAt: string;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatTime(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

export function getSlotAvailability(
  slot: ScheduledSlot,
  timeZone: string = DEFAULT_TRIP_TIMEZONE,
  now: Date = new Date(),
): SlotAvailability {
  const w = WINDOWS[slot];
  const { hour, minute } = getZonedDateParts(now, timeZone);
  const nowMinutes = hour * 60 + minute;
  const startMinutes = w.startHour * 60 + w.startMinute;
  const endMinutes = w.endHour * 60 + w.endMinute;

  const status: WindowStatus =
    nowMinutes < startMinutes ? "before" : nowMinutes > endMinutes ? "after" : "open";

  return {
    status,
    opensAt: formatTime(w.startHour, w.startMinute),
    closesAt: formatTime(w.endHour, w.endMinute),
  };
}

const SLOT_ORDER: ScheduledSlot[] = ["morning", "lunch", "battle"];

export interface NextWindow {
  slot: ScheduledSlot;
  opensAt: Date;
}

// The next window to *open* -- if we're currently inside one, that one
// doesn't count (it's already open), so this always points strictly
// forward. Wraps to tomorrow's Morning once Battle's start has passed.
// `opensAt` is a real absolute instant (Date), converted back from the
// trip-local wall-clock target time via zonedWallTimeToUtc -- so a
// countdown built on it (app/trip/[slug]/page.tsx's NextChallengeCountdown)
// is correct no matter what zone the viewing device itself is in.
export function getNextWindowOpening(timeZone: string = DEFAULT_TRIP_TIMEZONE, now: Date = new Date()): NextWindow {
  const { year, month, day, hour, minute } = getZonedDateParts(now, timeZone);
  const nowMinutes = hour * 60 + minute;

  for (const slot of SLOT_ORDER) {
    const w = WINDOWS[slot];
    const startMinutes = w.startHour * 60 + w.startMinute;
    if (nowMinutes < startMinutes) {
      const opensAt = zonedWallTimeToUtc(
        { year, month, day, hour: w.startHour, minute: w.startMinute, second: 0 },
        timeZone,
      );
      return { slot, opensAt };
    }
  }

  // Every window today has already started -- wrap to tomorrow's Morning.
  // Tomorrow's trip-local Y/M/D is computed via plain UTC-day arithmetic
  // on today's zoned Y/M/D triple (never through a device-local Date
  // increment), then re-anchored to the trip's zone by zonedWallTimeToUtc
  // below, exactly like every other target time here.
  const tomorrowUtcMidnight = new Date(Date.UTC(year, month - 1, day + 1));
  const morning = WINDOWS.morning;
  const opensAt = zonedWallTimeToUtc(
    {
      year: tomorrowUtcMidnight.getUTCFullYear(),
      month: tomorrowUtcMidnight.getUTCMonth() + 1,
      day: tomorrowUtcMidnight.getUTCDate(),
      hour: morning.startHour,
      minute: morning.startMinute,
      second: 0,
    },
    timeZone,
  );
  return { slot: "morning", opensAt };
}
