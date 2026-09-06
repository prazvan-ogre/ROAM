// R4 correction (2026-09-06 batch, review round 2): addChildProfile
// (src/lib/participant.ts) no longer recognizes a retry by a 15-second
// exact-match window (replaced because a slower retry still duplicated,
// and two honestly separate identical adds -- twins -- submitted close
// together could be wrongly collapsed into one). It now uses a real
// idempotency key: the caller generates one id per distinct attempt and
// keeps it stable across a retry of THAT attempt (see OnboardingWizard/
// Settings' own callers) -- this file tests the library function's own
// contract for that key, independent of timing.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/device", () => ({
  getDeviceId: () => "device-1",
  ensureAuthSession: async () => "auth-user-1",
}));

type Row = {
  id: string;
  trip_id: string;
  device_id: string;
  display_name: string;
  role: string;
  age: number | null;
  created_at: string;
  managed_by_participant_id: string | null;
  auth_user_id: string;
  client_request_id: string | null;
};

let rows: Row[];
let nextId = 1;

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "participants") throw new Error(`unexpected table "${table}"`);
      return {
        // Reconciliation read: addChildProfile only ever selects by
        // client_request_id after a 23505.
        select: (_cols: string) => {
          const filters: Record<string, unknown> = {};
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            async single() {
              const match = rows.find((r) => Object.entries(filters).every(([k, v]) => (r as never)[k] === v));
              if (!match) return { data: null, error: { code: "PGRST116", message: "no rows" } };
              return { data: match, error: null };
            },
          };
          return builder;
        },
        // Synchronous check-then-push (no await between them) so that
        // two "concurrent" calls -- which only actually interleave at
        // each other's own earlier `await ensureAuthSession()` -- still
        // serialize correctly here, exactly like a real unique index
        // would: whichever call's insert step happens to run first wins,
        // the other observes the row and reports 23505.
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const requestId = row.client_request_id as string | null;
              if (requestId && rows.some((r) => r.client_request_id === requestId)) {
                return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
              }
              const created = { id: `child-${nextId++}`, created_at: new Date().toISOString(), ...row } as Row;
              rows.push(created);
              return { data: created, error: null };
            },
          }),
        }),
      };
    },
  },
}));

describe("R4 regression: addChildProfile keys off a real idempotency id, not timing", () => {
  it("two different children (different request ids, different names) both get their own row", async () => {
    const { addChildProfile } = await import("@/lib/participant");
    rows = [];
    nextId = 1;

    const a = await addChildProfile("trip-1", "Ana", 7, "req-1");
    const b = await addChildProfile("trip-1", "Bogdan", 9, "req-2");

    expect(a.id).not.toBe(b.id);
    expect(rows).toHaveLength(2);
  });

  it("two DIFFERENT request ids with IDENTICAL name+age both succeed -- twins stay possible", async () => {
    const { addChildProfile } = await import("@/lib/participant");
    rows = [];
    nextId = 1;

    const twin1 = await addChildProfile("trip-1", "Ana", 7, "req-twin-1");
    const twin2 = await addChildProfile("trip-1", "Ana", 7, "req-twin-2");

    expect(twin1.id).not.toBe(twin2.id);
    expect(rows).toHaveLength(2);
  });

  it("a retry with the SAME request id well over 15s later still returns the original row, not a duplicate", async () => {
    const { addChildProfile } = await import("@/lib/participant");
    rows = [];
    nextId = 1;

    const first = await addChildProfile("trip-1", "Ana", 7, "req-slow-retry");
    // No 15s-window logic exists anymore to expire -- simulate a much
    // later retry by advancing the row's own created_at into the past,
    // proving the match isn't time-bounded at all.
    rows[0].created_at = new Date(Date.now() - 5 * 60_000).toISOString();
    const retry = await addChildProfile("trip-1", "Ana", 7, "req-slow-retry");

    expect(retry.id).toBe(first.id);
    expect(rows).toHaveLength(1);
  });

  it("two concurrent calls with the SAME request id resolve to the same row, not two rows", async () => {
    const { addChildProfile } = await import("@/lib/participant");
    rows = [];
    nextId = 1;

    const [a, b] = await Promise.all([
      addChildProfile("trip-1", "Ana", 7, "req-concurrent"),
      addChildProfile("trip-1", "Ana", 7, "req-concurrent"),
    ]);

    expect(a.id).toBe(b.id);
    expect(rows).toHaveLength(1);
  });

  it("a null age is handled correctly (not coerced to matching every age)", async () => {
    const { addChildProfile } = await import("@/lib/participant");
    rows = [];
    nextId = 1;

    const first = await addChildProfile("trip-1", "Ana", null, "req-null-age");
    const retry = await addChildProfile("trip-1", "Ana", null, "req-null-age");

    expect(retry.id).toBe(first.id);
    expect(rows).toHaveLength(1);
  });
});
