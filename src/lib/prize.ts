import { supabase } from "./supabase/client";
import type { Database } from "./supabase/types";

export type PrizeOption = Database["public"]["Tables"]["prize_options"]["Row"];

export interface PrizeStatus {
  options: PrizeOption[];
  votingOpen: boolean;
  winner: PrizeOption | null;
  closesAt: Date | null;
}

const VOTING_WINDOW_MS = 12 * 60 * 60 * 1000;

// Product owner spec: 3 prize options, each participant votes for their
// favourite once (unique(participant_id) enforces this server-side).
// Voting closes 12 hours after the *first* vote is cast (computed here on
// every read, not by a background job) -- before the first vote, or with
// no options seeded, voting is simply open indefinitely.
export async function getPrizeStatus(tripId: string): Promise<PrizeStatus> {
  const [{ data: options, error: optionsError }, { data: votes, error: votesError }] = await Promise.all([
    supabase.from("prize_options").select("*").eq("trip_id", tripId).order("order_index", { ascending: true }),
    supabase.from("prize_votes").select("prize_option_id, created_at").eq("trip_id", tripId),
  ]);
  if (optionsError) throw optionsError;
  if (votesError) throw votesError;

  const opts = options ?? [];
  const allVotes = votes ?? [];

  if (allVotes.length === 0) {
    return { options: opts, votingOpen: true, winner: null, closesAt: null };
  }

  const firstVoteMs = Math.min(...allVotes.map((v) => new Date(v.created_at).getTime()));
  const closesAt = new Date(firstVoteMs + VOTING_WINDOW_MS);
  const votingOpen = Date.now() < closesAt.getTime();

  if (votingOpen) {
    return { options: opts, votingOpen: true, winner: null, closesAt };
  }

  const counts = new Map<string, number>();
  for (const v of allVotes) {
    counts.set(v.prize_option_id, (counts.get(v.prize_option_id) ?? 0) + 1);
  }
  const winner =
    opts
      .slice()
      .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.order_index - b.order_index)[0] ?? null;

  return { options: opts, votingOpen: false, winner, closesAt };
}

export async function castPrizeVote(
  tripId: string,
  participantId: string,
  prizeOptionId: string,
): Promise<void> {
  const { error } = await supabase.from("prize_votes").insert({
    trip_id: tripId,
    prize_option_id: prizeOptionId,
    participant_id: participantId,
  });
  if (error) throw error;
}
