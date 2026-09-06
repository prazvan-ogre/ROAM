// R8 (20260908090000_r8_prize_voting_rules.sql): prize voting state and
// the winner are now resolved server-side by cast_prize_vote()/
// get_prize_status() (both RPCs, SECURITY DEFINER) instead of a direct
// insert into prize_votes + a client-side "12h after the first vote"
// computation. This file replaces the old direct-insert-based tests
// (R4, "reconciles a duplicate vote instead of blindly confirming it")
// with the equivalent RPC-based contract: castPrizeVote/getPrizeStatus
// (src/lib/prize.ts) now call cast_prize_vote/get_prize_status and pass
// their result straight through -- these tests prove exactly that
// pass-through, not the SQL functions' own logic (that's
// supabase/tests/r8_prize_voting.test.sql, run against a real Postgres
// instance).
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();
const fromMock = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

function makeOptionsQuery(result: { data: unknown; error: unknown }) {
  return {
    select: () => ({
      eq: () => ({
        order: () => Promise.resolve(result),
      }),
    }),
  };
}

const OPTIONS = [
  { id: "option-1", trip_id: "trip-1", title: "A", description: null, order_index: 1, created_at: "2026-01-01T00:00:00Z" },
  { id: "option-2", trip_id: "trip-1", title: "B", description: null, order_index: 2, created_at: "2026-01-01T00:00:00Z" },
];

beforeEach(() => {
  rpcMock.mockReset();
  fromMock.mockReset();
  fromMock.mockReturnValue(makeOptionsQuery({ data: OPTIONS, error: null }));
});

describe("R8: castPrizeVote passes cast_prize_vote's status straight through", () => {
  it("a genuinely new vote reports 'recorded' and calls the RPC with the right args", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { status: "recorded", vote: { id: "vote-1", trip_id: "trip-1", prize_option_id: "option-1", participant_id: "participant-1", created_at: "2026-01-01T00:00:00Z" } },
      error: null,
    });
    const { castPrizeVote } = await import("@/lib/prize");

    await expect(castPrizeVote("participant-1", "option-1")).resolves.toBe("recorded");
    expect(rpcMock).toHaveBeenCalledWith("cast_prize_vote", { p_participant_id: "participant-1", p_prize_option_id: "option-1" });
  });

  it.each([
    ["already_recorded"],
    ["conflict"],
    ["voting_closed"],
    ["invalid_option"],
    ["not_configured"],
  ] as const)("passes through status '%s' unchanged", async (status) => {
    rpcMock.mockResolvedValueOnce({ data: { status, vote: null }, error: null });
    const { castPrizeVote } = await import("@/lib/prize");

    await expect(castPrizeVote("participant-1", "option-1")).resolves.toBe(status);
  });

  it("an RPC-level error is thrown, never swallowed", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { code: "500", message: "internal error" } });
    const { castPrizeVote } = await import("@/lib/prize");

    await expect(castPrizeVote("participant-1", "option-1")).rejects.toMatchObject({ code: "500" });
  });
});

describe("R8: getPrizeStatus maps get_prize_status's result and resolves the winner option", () => {
  it("voting still open: no winner, closesAt parsed as a Date", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { configured: true, voting_open: true, closes_at: "2026-06-02T00:00:00Z", winner_option_id: null, resolution_method: null },
      error: null,
    });
    const { getPrizeStatus } = await import("@/lib/prize");

    const status = await getPrizeStatus("trip-1");
    expect(status.configured).toBe(true);
    expect(status.votingOpen).toBe(true);
    expect(status.winner).toBeNull();
    expect(status.resolutionMethod).toBeNull();
    expect(status.closesAt).toEqual(new Date("2026-06-02T00:00:00Z"));
    expect(status.options).toEqual(OPTIONS);
  });

  it("voting closed with a winner: the winner option is resolved from the options list by id", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { configured: true, voting_open: false, closes_at: null, winner_option_id: "option-2", resolution_method: "plurality" },
      error: null,
    });
    const { getPrizeStatus } = await import("@/lib/prize");

    const status = await getPrizeStatus("trip-1");
    expect(status.votingOpen).toBe(false);
    expect(status.winner).toEqual(OPTIONS[1]);
    expect(status.resolutionMethod).toBe("plurality");
    expect(status.closesAt).toBeNull();
  });

  it("not configured (fewer than 2 options): configured is false, no winner", async () => {
    rpcMock.mockResolvedValueOnce({
      data: { configured: false, voting_open: false, closes_at: null, winner_option_id: null, resolution_method: null },
      error: null,
    });
    const { getPrizeStatus } = await import("@/lib/prize");

    const status = await getPrizeStatus("trip-1");
    expect(status.configured).toBe(false);
    expect(status.votingOpen).toBe(false);
    expect(status.winner).toBeNull();
  });

  it("an options-fetch error is thrown", async () => {
    fromMock.mockReturnValue(makeOptionsQuery({ data: null, error: { message: "network down" } }));
    rpcMock.mockResolvedValueOnce({
      data: { configured: true, voting_open: true, closes_at: null, winner_option_id: null, resolution_method: null },
      error: null,
    });
    const { getPrizeStatus } = await import("@/lib/prize");

    await expect(getPrizeStatus("trip-1")).rejects.toMatchObject({ message: "network down" });
  });

  it("a get_prize_status RPC error is thrown", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "internal error" } });
    const { getPrizeStatus } = await import("@/lib/prize");

    await expect(getPrizeStatus("trip-1")).rejects.toMatchObject({ message: "internal error" });
  });
});
