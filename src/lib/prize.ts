import { supabase } from "./supabase/client";
import type { Database } from "./supabase/types";

export type PrizeOption = Database["public"]["Tables"]["prize_options"]["Row"];
export type PrizeResolutionMethod = Database["public"]["Tables"]["prize_results"]["Row"]["resolution_method"];

export interface PrizeStatus {
  options: PrizeOption[];
  // R8 (20260908090000_r8_prize_voting_rules.sql): false when the trip
  // has fewer than 2 distinct, non-blank prize options -- the product
  // rule that at least 2 real choices must exist before a vote means
  // anything. votingOpen/winner/resolutionMethod are always
  // false/null/null while this is false.
  configured: boolean;
  votingOpen: boolean;
  winner: PrizeOption | null;
  resolutionMethod: PrizeResolutionMethod | null;
  // Only set while votingOpen is true -- the instant voting closes, in
  // UTC (render it in the trip's own destination timezone, same rule as
  // every other "available at HH:MM" label in this app -- see
  // getTripTimezone).
  closesAt: Date | null;
}

// R8: voting state and the winner are now resolved and PERSISTED
// server-side (get_prize_status RPC) -- never recomputed on the client.
// Before this, getPrizeStatus computed "closes 12h after the first vote,
// most votes wins, ties broken by order_index" entirely on every read:
// a trip with zero votes never closed at all, and a random tie-break
// (this batch's whole point) could never have been introduced safely
// that way, since two reads moments apart could otherwise land on two
// different "winners". See the migration header for the full contract:
// voting closes at the end of the trip's first day, in its own
// destination timezone; the winner, once resolved, is stored and never
// re-rolled.
export async function getPrizeStatus(tripId: string): Promise<PrizeStatus> {
  const [{ data: options, error: optionsError }, { data: status, error: statusError }] = await Promise.all([
    supabase.from("prize_options").select("*").eq("trip_id", tripId).order("order_index", { ascending: true }),
    supabase.rpc("get_prize_status", { p_trip_id: tripId }),
  ]);
  if (optionsError) throw optionsError;
  if (statusError) throw statusError;

  const opts = options ?? [];
  const winner = status.winner_option_id ? (opts.find((o) => o.id === status.winner_option_id) ?? null) : null;

  return {
    options: opts,
    configured: status.configured,
    votingOpen: status.voting_open,
    winner,
    resolutionMethod: status.resolution_method,
    closesAt: status.closes_at ? new Date(status.closes_at) : null,
  };
}

export type PrizeVoteResult = Database["public"]["Functions"]["cast_prize_vote"]["Returns"]["status"];

// R8: the only way to cast a vote now -- cast_prize_vote (SECURITY
// DEFINER) is atomic and idempotent, and enforces every rule server-side:
// one vote per participant ever (never changeable once recorded -- a
// second, different choice comes back 'conflict', not applied), the
// option must belong to the SAME trip as the participant ('invalid_option'
// otherwise -- the old RLS `with check` never verified this), a
// genuinely new vote is rejected once voting has closed ('voting_closed'),
// and a trip with fewer than 2 configured options never accepts a
// meaningless single-option "vote" ('not_configured').
//
// No tripId parameter -- the RPC derives it from the participant's own
// row, so there is no way to pass a mismatched trip/participant pair
// through this function at all (unlike the old client-side insert, which
// took trip_id as a bare, trusted argument).
export async function castPrizeVote(participantId: string, prizeOptionId: string): Promise<PrizeVoteResult> {
  const { data, error } = await supabase.rpc("cast_prize_vote", {
    p_participant_id: participantId,
    p_prize_option_id: prizeOptionId,
  });
  if (error) throw error;
  return data.status;
}
