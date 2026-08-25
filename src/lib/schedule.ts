// Time-of-day availability windows, per the product owner's explicit
// request (overriding the spec's own "don't spend time on exact unlock
// times" suggestion -- this is a deliberate product decision, not an
// oversight). Uses the device's local clock: the whole group is on the
// same trip in the same place, so there's no need for a stored timezone.
//
// To change the windows, edit this file and redeploy -- a five-day pilot
// with a fixed schedule doesn't need these to be database-editable.

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

export function getSlotAvailability(slot: ScheduledSlot, now: Date = new Date()): SlotAvailability {
  const w = WINDOWS[slot];
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
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
