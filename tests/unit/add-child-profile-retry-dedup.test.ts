// R4 regression (2026-09-06 batch): "retry reușit fără duplicare" for
// adding a child profile. addChildProfile (src/lib/participant.ts) used
// to be a plain insert -- a lost confirmation (the insert commits, the
// response never reaches the caller) meant a retry from the onboarding
// wizard or Setări's "Adaugă profil copil" created a second child with
// the same name. Fixed with an app-level (no migration) check: an exact
// name+age match created by this same device in the last 15 seconds is
// recognized as the caller's own retry and returned directly, instead of
// inserting again.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/device", () => ({
  getDeviceId: () => "device-1",
  ensureAuthSession: async () => "auth-user-1",
}));

let rows: Array<{
  id: string;
  trip_id: string;
  device_id: string;
  display_name: string;
  role: string;
  age: number | null;
  created_at: string;
  managed_by_participant_id: string | null;
  auth_user_id: string;
}>;
let nextId = 1;

function matchesFilters(row: Record<string, unknown>, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      if (table !== "participants") throw new Error(`unexpected table "${table}"`);
      return {
        select: (_cols: string) => {
          const filters: Record<string, unknown> = {};
          let ageIsNull = false;
          let minCreatedAt: string | null = null;
          const builder = {
            eq(column: string, value: unknown) {
              filters[column] = value;
              return builder;
            },
            is(column: string, _value: null) {
              if (column === "age") ageIsNull = true;
              return builder;
            },
            gte(column: string, value: string) {
              if (column === "created_at") minCreatedAt = value;
              return builder;
            },
            order() {
              return builder;
            },
            limit() {
              return builder;
            },
            async maybeSingle() {
              const match = rows.find((r) => {
                if (!matchesFilters(r as unknown as Record<string, unknown>, filters)) return false;
                if (ageIsNull && r.age !== null) return false;
                if (minCreatedAt && r.created_at < minCreatedAt) return false;
                return true;
              });
              return { data: match ?? null, error: null };
            },
          };
          return builder;
        },
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              const created = { id: `child-${nextId++}`, created_at: new Date().toISOString(), ...row };
              rows.push(created as (typeof rows)[number]);
              return { data: created, error: null };
            },
          }),
        }),
      };
    },
  },
}));

describe("R4 regression: addChildProfile de-duplicates an exact-match retry", () => {
  it("two different children (different names) both get their own row", async () => {
    const { addChildProfile } = await import("@/lib/participant");
    rows = [];
    nextId = 1;

    const a = await addChildProfile("trip-1", "Ana", 7);
    const b = await addChildProfile("trip-1", "Bogdan", 9);

    expect(a.id).not.toBe(b.id);
    expect(rows).toHaveLength(2);
  });

  it("a retry with the SAME name+age within the window returns the existing row, not a duplicate", async () => {
    const { addChildProfile } = await import("@/lib/participant");
    rows = [];
    nextId = 1;

    const first = await addChildProfile("trip-1", "Ana", 7);
    const retry = await addChildProfile("trip-1", "Ana", 7);

    expect(retry.id).toBe(first.id);
    expect(rows).toHaveLength(1);
  });

  it("a null age is handled correctly (not coerced to matching every age)", async () => {
    const { addChildProfile } = await import("@/lib/participant");
    rows = [];
    nextId = 1;

    const first = await addChildProfile("trip-1", "Ana", null);
    const retry = await addChildProfile("trip-1", "Ana", null);

    expect(retry.id).toBe(first.id);
    expect(rows).toHaveLength(1);
  });
});
