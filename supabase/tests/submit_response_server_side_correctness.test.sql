-- Regression test for the score-integrity gap deliberately excluded from
-- the 2026-09-05 architecture/security review's batch 2 (auth/ownership/
-- RLS hardening was scoped to identity/ownership/RLS, not "tranzacțiile
-- de răspuns/scor") and fixed by
-- 20260906130000_server_side_answer_correctness.sql: Discover's
-- submitResponse (src/lib/discover.ts) used to insert straight into
-- `responses` with `is_correct` computed client-side and sent as-is --
-- the table's RLS INSERT policy only ever checked
-- `participant_is_self_or_legacy(participant_id)` (ownership), never
-- correctness, so a caller hitting the Supabase REST endpoint directly
-- with the anon key could claim any answer was correct regardless of
-- what `selected_option_id` it actually submitted, inflating both the
-- individual leaderboard and (via catch-up answers to Battle questions)
-- the season-long "PĂRINȚI vs COPII" tally.
--
-- Fixed by a new `submit_response()` SECURITY DEFINER RPC, mirroring
-- record_battle_answer()'s existing ownership-recheck pattern
-- (20260906120000_atomic_record_battle_answer.sql): it looks up the
-- question's actual correct answer_options row itself and computes
-- is_correct server-side -- there is no `p_is_correct` parameter at all
-- for a caller to forge. The direct-insert RLS policy and table
-- privilege on `responses` are revoked in the same migration, so this
-- RPC is the only way to write a response any more.
--
-- Verifies:
--   1. the actually-correct option is stored as is_correct = true;
--   2. the actually-wrong option is stored as is_correct = false --
--      there is no parameter through which a caller could claim
--      otherwise;
--   3. the ownership check (participant_is_self_or_legacy) rejects a
--      caller submitting as a participant it doesn't own -- required
--      because SECURITY DEFINER bypasses responses' own RLS policy;
--   4. a selected_option_id that belongs to a *different* question is
--      rejected outright, rather than silently misattributing
--      correctness from the wrong question's answer_options row.
--
-- Run against a scratch/dev database with all migrations applied (never
-- against real trip data) -- wrapped in a transaction that is rolled
-- back at the end. Needs the ci-bootstrap.sql auth.users/auth.uid()
-- stub (or a real Supabase project) for set_config('request.jwt.claim.sub', ...)
-- to be visible to auth.uid().
--
--   PGDATABASE=<scratch> PGUSER=postgres PGHOST=localhost npm run test:sql:submit-response

begin;

insert into trips (id, slug, name, duration_days)
values ('00000000-0000-0000-0000-000000000601', 'submit-response-test', 'Submit Response Test', 5);

-- Two separate sessions/families on the same trip -- b611 belongs to
-- session c1, b612 to session c2, so a swap between them proves the
-- ownership check, not just "some auth_user_id is set".
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000d2');

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000000611', '00000000-0000-0000-0000-000000000601', 'dev-1', 'Adult 1', 'adult', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-000000000612', '00000000-0000-0000-0000-000000000601', 'dev-2', 'Adult 2', 'adult', '00000000-0000-0000-0000-0000000000d2');

insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000000631', '00000000-0000-0000-0000-000000000601', 'discover', 1, 'morning', 1, 'Q1?', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-000000000632', '00000000-0000-0000-0000-000000000601', 'discover', 1, 'morning', 2, 'Q2?', 'single_choice', 10, true, true);

insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-000000000641', '00000000-0000-0000-0000-000000000631', 1, 'Correct', true),
  ('00000000-0000-0000-0000-000000000642', '00000000-0000-0000-0000-000000000631', 2, 'Wrong', false),
  ('00000000-0000-0000-0000-000000000643', '00000000-0000-0000-0000-000000000632', 1, 'Other question option', true);

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);

-- ========================================================================
-- Test 1: the actually-correct option is stored as correct.
-- ========================================================================
do $$
declare v_resp responses;
begin
  select * into v_resp from submit_response(
    '00000000-0000-0000-0000-000000000611'::uuid,
    '00000000-0000-0000-0000-000000000631'::uuid,
    '00000000-0000-0000-0000-000000000641'::uuid
  );

  if v_resp.is_correct is distinct from true then
    raise exception 'FAILED (correct option): expected is_correct = true, got %', v_resp.is_correct;
  end if;

  raise notice 'PASS: the actually-correct option is stored as correct';
end $$;

-- ========================================================================
-- Test 2: the actually-wrong option is stored as incorrect -- the exact
-- forgery this fix closes. A second participant is used here (not a
-- second question for the same one) since responses has
-- unique (question_id, participant_id) -- submitting as its own owning
-- session (d2), same as Test 1 did for d1/participant 611.
-- ========================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);

do $$
declare v_resp responses;
begin
  select * into v_resp from submit_response(
    '00000000-0000-0000-0000-000000000612'::uuid,
    '00000000-0000-0000-0000-000000000631'::uuid,
    '00000000-0000-0000-0000-000000000642'::uuid
  );

  if v_resp.is_correct is distinct from false then
    raise exception 'FAILED (wrong option): expected is_correct = false, got % -- a forged correct answer got through', v_resp.is_correct;
  end if;

  raise notice 'PASS: an actually-wrong answer is stored as incorrect -- there is no parameter left to forge a correct one through';
end $$;

-- ========================================================================
-- Test 3: ownership -- session d2 tries to submit AS participant 611
-- (owned by d1). SECURITY DEFINER means this can only be caught by the
-- function's own explicit check, not by responses' own RLS.
-- ========================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d2', true);

do $$
begin
  perform submit_response(
    '00000000-0000-0000-0000-000000000611'::uuid,
    '00000000-0000-0000-0000-000000000632'::uuid,
    '00000000-0000-0000-0000-000000000643'::uuid
  );
  raise exception 'FAILED (ownership): should have been rejected, was not';
exception
  when others then
    if sqlerrm <> 'not authorized to submit a response for this participant' then
      raise exception 'FAILED (ownership): rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS: cross-session submission rejected';
end $$;

-- ========================================================================
-- Test 4: a selected_option_id from a *different* question is rejected,
-- rather than silently looking up correctness against the wrong
-- question's answer_options row.
-- ========================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', true);

do $$
begin
  perform submit_response(
    '00000000-0000-0000-0000-000000000611'::uuid,
    '00000000-0000-0000-0000-000000000632'::uuid,
    '00000000-0000-0000-0000-000000000641'::uuid -- belongs to question 631, not 632
  );
  raise exception 'FAILED (mismatched option): should have been rejected, was not';
exception
  when others then
    if sqlerrm <> 'selected option does not belong to this question' then
      raise exception 'FAILED (mismatched option): rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS: an option belonging to a different question is rejected';
end $$;

rollback;
