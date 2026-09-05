-- Fixes a score-integrity gap explicitly carved out of the 2026-09-05
-- architecture/security review's batch 2 (auth/ownership/RLS hardening,
-- which was scoped to identity/ownership/RLS -- "tranzacțiile de
-- răspuns/scor" was an explicit exclusion) and found while completing
-- that batch: neither answer-submission path re-derived correctness
-- server-side, so a caller talking to the Supabase REST endpoint with
-- the anon key directly -- not just through the app -- could claim any
-- answer was correct regardless of what `selected_option_id` it actually
-- submitted.
--
-- Discover (`submitResponse`, src/lib/discover.ts) inserted straight into
-- `responses` with `is_correct: selectedOption.is_correct` computed
-- client-side from an already-fetched `answer_options` row and sent
-- as-is. The table's own RLS INSERT policy
-- (20260906090000_auth_ownership.sql) only ever checked
-- `participant_is_self_or_legacy(participant_id)` -- ownership, not
-- correctness -- so nothing stopped a forged `is_correct: true` on a
-- wrong answer. This inflates both the individual "Clasamentul
-- familiei" leaderboard (getParticipantLeaderboard) and, more visibly,
-- the season-long "PĂRINȚI vs COPII" battle tally (battle_team_score/
-- trip_battle_win_tally) once a catch-up answer (getCatchUpQuestions)
-- carries a forged Battle question's points into that same table.
--
-- Battle (`record_battle_answer()`, 20260906120000_atomic_record_battle_answer.sql)
-- had the identical shape one level deeper: `p_is_correct` and `p_score`
-- were plain caller-supplied parameters to a SECURITY DEFINER function,
-- never checked against the actual correct `answer_options` row. That
-- migration's own ownership re-check (required because SECURITY DEFINER
-- bypasses RLS) covered *who* could write, not *what value* they could
-- write for correctness.
--
-- Fixed on both paths by never accepting correctness as an input at all:
--
-- 1. New `submit_response()` SECURITY DEFINER RPC, mirroring
--    `record_battle_answer()`'s existing ownership-recheck pattern: looks
--    up the actual correct `answer_options` row for
--    (p_question_id, p_selected_option_id) and computes `is_correct`
--    itself. `src/lib/discover.ts`'s `submitResponse` now calls this
--    instead of inserting directly.
-- 2. `record_battle_answer()` is replaced (different parameter list, so
--    the old 7-arg overload is dropped first) with a 5-arg version that
--    no longer takes `p_is_correct`/`p_score` -- it re-derives both
--    itself the same way: looks up the real correct option, then applies
--    the *same* scoring formula the client used to (10 points normally,
--    5 for a Final Battle question, 0 for a wrong answer) -- this is
--    unchanged scoring, just relocated. Whether the battle is final is
--    read from `battles.is_final` for the caller's own `p_battle_id`,
--    same table `getBattleWindowStatus`/the rest of this function
--    already trusts for other checks. Left unresolved (null) when
--    `p_battle_id` doesn't exist -- the function does not raise for that
--    itself, so the later `battle_scores` insert still fails with its
--    existing foreign_key_violation, preserving atomicity test 3's exact
--    failure mode (supabase/tests/record_battle_answer_atomicity.test.sql).
--
-- Since both RPCs are now the *only* legitimate way to write `responses`/
-- `battle_scores` (no app code inserts into either table directly any
-- more -- battle_scores never did), the direct-insert RLS policies and
-- the underlying table privileges are revoked below too: a forged
-- `is_correct`/`score` can no longer be smuggled in by skipping the RPC
-- and calling PostgREST's table endpoint directly with the anon key,
-- which the ownership-only INSERT policies alone never prevented.
--
-- supabase/tests/submit_response_server_side_correctness.test.sql and an
-- added case in supabase/tests/record_battle_answer_atomicity.test.sql
-- prove a forged "correct" submission for a wrong answer now stores
-- is_correct = false / score = 0 regardless of what the caller claims
-- (there is no longer a parameter to claim anything through).

-- ---------------------------------------------------------------------
-- Discover: submit_response() computes is_correct itself.
-- ---------------------------------------------------------------------
create or replace function public.submit_response(
  p_participant_id uuid,
  p_question_id uuid,
  p_selected_option_id uuid
)
returns responses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_correct boolean;
  v_response responses;
begin
  if not participant_is_self_or_legacy(p_participant_id) then
    raise exception 'not authorized to submit a response for this participant' using errcode = '42501';
  end if;

  select is_correct into v_is_correct
  from answer_options
  where id = p_selected_option_id and question_id = p_question_id;

  if not found then
    raise exception 'selected option does not belong to this question' using errcode = '22023';
  end if;

  insert into responses (participant_id, question_id, selected_option_id, is_correct)
  values (p_participant_id, p_question_id, p_selected_option_id, v_is_correct)
  returning * into v_response;

  return v_response;
end;
$$;

grant execute on function public.submit_response(uuid, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Battle: record_battle_answer() re-derives is_correct/score itself.
-- Different parameter list than the original -- drop before recreating.
-- ---------------------------------------------------------------------
drop function if exists public.record_battle_answer(uuid, uuid, uuid, boolean, uuid, battle_team, int);

create or replace function public.record_battle_answer(
  p_participant_id uuid,
  p_question_id uuid,
  p_selected_option_id uuid,
  p_battle_id uuid,
  p_team battle_team
)
returns responses
language plpgsql
security definer
set search_path = public
as $$
declare
  v_response responses;
  v_is_correct boolean;
  v_is_final boolean;
  v_score int;
  v_first_individual_at timestamptz;
begin
  if not participant_is_self_or_legacy(p_participant_id) then
    raise exception 'not authorized to submit a battle answer for this participant' using errcode = '42501';
  end if;

  select is_correct into v_is_correct
  from answer_options
  where id = p_selected_option_id and question_id = p_question_id;

  if not found then
    raise exception 'selected option does not belong to this question' using errcode = '22023';
  end if;

  -- Deliberately not raising when p_battle_id doesn't match any battle:
  -- v_is_final just stays null (treated as "not final" below) and the
  -- battle_scores insert further down still fails on its own foreign key
  -- constraint, preserving the exact atomicity behavior tested by
  -- record_battle_answer_atomicity.test.sql's forced-FK-violation case.
  select is_final into v_is_final from battles where id = p_battle_id;

  -- Same scoring formula the client used to apply (BATTLE_POINTS in
  -- src/lib/battle.ts), just no longer trusted from the caller: 10
  -- points for a correct answer, 5 for a correct Final Battle answer, 0
  -- for a wrong one.
  v_score := case
    when not coalesce(v_is_correct, false) then 0
    when coalesce(v_is_final, false) then 5
    else 10
  end;

  insert into responses (participant_id, question_id, selected_option_id, is_correct)
  values (p_participant_id, p_question_id, p_selected_option_id, v_is_correct)
  returning * into v_response;

  select min(created_at) into v_first_individual_at
  from battle_scores
  where battle_id = p_battle_id and participant_id is not null;

  -- Same window as getBattleWindowStatus(): countable if nobody has
  -- individually answered yet, or it's been under 15 minutes since
  -- whoever did.
  if v_first_individual_at is null or now() < v_first_individual_at + interval '15 minutes' then
    insert into battle_scores (battle_id, participant_id, team, score)
    values (p_battle_id, p_participant_id, p_team, v_score);
  end if;

  return v_response;
end;
$$;

grant execute on function public.record_battle_answer(uuid, uuid, uuid, uuid, battle_team) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Neither table is written directly by any app code any more (Discover
-- now calls submit_response(), Battle already called record_battle_answer()
-- exclusively) -- revoke the direct-insert privilege so the anon/
-- authenticated keys can no longer smuggle a forged is_correct/score
-- past these RPCs by calling PostgREST's table endpoint directly. Read
-- policies are untouched.
-- ---------------------------------------------------------------------
drop policy if exists "a session can submit a response only as its own participant" on responses;
revoke insert on responses from anon, authenticated;

drop policy if exists "a session can submit a battle score only as its own participant" on battle_scores;
revoke insert on battle_scores from anon, authenticated;
