-- Fixes hypothesis B from the 2026-09-05 architecture/security review
-- (confirmed by tests/unit/battle-score-divergence.test.ts): recordBattleAnswer
-- (src/lib/battle.ts) wrote the personal `responses` row and the team
-- `battle_scores` row as two separate, sequential client-side calls, with
-- no shared transaction between them. A failure on the second write
-- (dropped connection, RLS rejection, anything) left the first one
-- already committed -- the participant's personal answer was saved with
-- no way to tell, from the thrown error alone, that the team never got
-- credit for it. Worse: `responses` has `unique (question_id,
-- participant_id)`, so a naive retry of the same submission after a
-- partial failure would itself fail with a duplicate-key error -- the
-- app had no clean way to recover once this happened.
--
-- Fixed by moving both writes into a single plpgsql function. A Postgres
-- function body runs inside the same transaction as the statement that
-- invoked it: if anything inside raises (including the `battle_scores`
-- insert), the whole function -- the `responses` insert included --
-- rolls back atomically. There is no window where one write can be
-- committed without the other.
--
-- Also moves the "is this battle's 15-minute result window still open?"
-- check (previously src/lib/battle.ts's getBattleWindowStatus, called
-- separately and racily between the two writes, comparing a client-side
-- Date.now() against a value fetched slightly earlier) into the same
-- transaction, evaluated against the database's own now() at the exact
-- moment of insert -- getBattleWindowStatus() itself is untouched and
-- stays in use for its other purpose (BattleFlow.tsx's "done" screen
-- display), just no longer part of the write path.
--
-- SECURITY DEFINER (required for a single call to write both tables
-- regardless of which one the RLS-restricted caller could individually
-- reach) means this function itself bypasses the RLS policies R1 put on
-- `responses`/`battle_scores`
-- (20260906100000_participants_self_read_fix.sql), not just for reads
-- like battle_team_score()/trip_battle_win_tally() but for these
-- inserts too -- so it re-checks the same ownership rule those tables'
-- own INSERT policies enforce (participant_is_self_or_legacy) itself,
-- explicitly, before writing anything. Without this, any caller holding
-- an anon/authenticated key could submit a response or battle score as
-- an arbitrary participant_id via this RPC alone, undoing exactly what
-- R1 was for.
create or replace function public.record_battle_answer(
  p_participant_id uuid,
  p_question_id uuid,
  p_selected_option_id uuid,
  p_is_correct boolean,
  p_battle_id uuid,
  p_team battle_team,
  p_score int
)
returns responses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_response responses;
  v_first_individual_at timestamptz;
begin
  if not participant_is_self_or_legacy(p_participant_id) then
    raise exception 'not authorized to submit a battle answer for this participant' using errcode = '42501';
  end if;

  insert into responses (participant_id, question_id, selected_option_id, is_correct)
  values (p_participant_id, p_question_id, p_selected_option_id, p_is_correct)
  returning * into v_response;

  select min(created_at) into v_first_individual_at
  from battle_scores
  where battle_id = p_battle_id and participant_id is not null;

  -- Same window as getBattleWindowStatus(): countable if nobody has
  -- individually answered yet, or it's been under 15 minutes since
  -- whoever did.
  if v_first_individual_at is null or now() < v_first_individual_at + interval '15 minutes' then
    insert into battle_scores (battle_id, participant_id, team, score)
    values (p_battle_id, p_participant_id, p_team, p_score);
  end if;

  return v_response;
end;
$$;

grant execute on function public.record_battle_answer(uuid, uuid, uuid, boolean, uuid, battle_team, int) to anon, authenticated;
