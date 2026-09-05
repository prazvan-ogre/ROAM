// Verifies R1's hypothesis from the 2026-09-05 review: GET and PATCH
// /api/account read/mutate a creator_accounts row given only its id, with
// no proof the caller is the account's own holder. Runs the route
// handlers' real code against a fake admin client (see
// helpers/fakeSupabaseAdmin.ts) -- no network, no real database.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFakeAdminClient, type FakeAccountRow } from "./helpers/fakeSupabaseAdmin";

const victim: FakeAccountRow = {
  id: "11111111-1111-1111-1111-111111111111",
  phone_number: "0700111222",
  pin_hash: "victim-hash",
  is_admin: false,
  display_name: "Victim",
};

let rows: FakeAccountRow[];

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createFakeAdminClient(rows),
}));

beforeEach(() => {
  // Fresh row per test -- PATCH mutates in place.
  rows = [{ ...victim }];
});

describe("R1: /api/account ownership", () => {
  it("GET returns another account's phone number given only its id, with no caller identity check", async () => {
    const { GET } = await import("../../app/api/account/route");
    const request = new Request(`http://localhost/api/account?accountId=${victim.id}`);

    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    // The route has no notion of "who is asking" -- any caller holding
    // (or simply guessing/enumerating, since IDs are not secrets per the
    // review's evidence) this UUID gets the phone number back.
    expect(body.phoneNumber).toBe(victim.phone_number);
  });

  it("PATCH overwrites another account's phone/PIN given only its id, with no current-PIN or session check", async () => {
    const { PATCH } = await import("../../app/api/account/route");
    const request = new Request("http://localhost/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: victim.id, phoneNumber: "0799999999", pin: "999999" }),
    });

    const response = await PATCH(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.phoneNumber).toBe("0799999999");
    // The stored row was actually overwritten -- not just an echoed
    // response -- with no verification of the *previous* PIN or any
    // other proof this caller is the account's real holder.
    expect(rows[0].phone_number).toBe("0799999999");
    expect(rows[0].pin_hash).not.toBe(victim.pin_hash);
  });
});
