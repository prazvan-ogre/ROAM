-- Regression test for hypothesis B/R3's fix (2026-09-05 review):
-- record_battle_answer() (20260906120000_atomic_record_battle_answer.sql)
-- replaced recordBattleAnswer's two separate, sequential client-side
-- inserts (responses, then battle_scores) with a single atomic function
-- call. Verifies:
--   1. the success path writes both rows;
--   2. the ownership check (participant_is_self_or_legacy) rejects a
--      caller submitting as a participant it doesn't own -- required
--      because SECURITY DEFINER bypasses the RLS policies that would
--      otherwise catch this on a direct table insert;
--   3. atomicity itself: forcing the *second* insert (battle_scores) to
--      fail (via a bogus battle_id, an FK violation) leaves *no*
--      orphaned responses row -- the exact divergence hypothesis B was
--      about, now impossible.
--
-- Run against a scratch/dev database with all migrations applied (never
-- against real trip data) -- wrapped in a transaction that is rolled
-- back at the end. Needs the ci-bootstrap.sql auth.users/auth.uid()
-- stub (or a real Supabase project) for set_config('request.jwt.claim.sub', ...)
-- to be visible to auth.uid().
--
--   PGDATABASE=<scratch> PGUSER=postgres PGHOST=localhost npm run test:sql:record-battle-answer

begin;

insert into trips (id, slug, name, duration_days)
values ('00000000-0000-0000-0000-000000000501', 'record-battle-answer-test', 'Record Battle Answer Test', 5);

-- Two separate sessions/families on the same trip -- b511 belongs to
-- session c1, b512 to session c2, so a swap between them proves the
-- ownership check, not just "some auth_user_id is set".
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000c2');

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000501', 'dev-1', 'Adult 1', 'adult', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-000000000512', '00000000-0000-0000-0000-000000000501', 'dev-2', 'Adult 2', 'adult', '00000000-0000-0000-0000-0000000000c2');

insert into battles (id, trip_id, title) values
  ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000501', 'Record Battle Answer Battle');

insert into questions (id, trip_id, kind, battle_id, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-000000000501', 'battle', '00000000-0000-0000-0000-000000000521', 1, null, 1, 'Q1?', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-000000000532', '00000000-0000-0000-0000-000000000501', 'battle', '00000000-0000-0000-0000-000000000521', 1, null, 2, 'Q2?', 'single_choice', 10, true, true);

insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-000000000541', '00000000-0000-0000-0000-000000000531', 1, 'A', true),
  ('00000000-0000-0000-0000-000000000542', '00000000-0000-0000-0000-000000000532', 1, 'A', true);

-- ========================================================================
-- Test 1: success path -- as the actual owning session.
-- ========================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

do $$
declare
  v_resp responses;
  v_responses_count int;
  v_battle_scores_count int;
begin
  select * into v_resp from record_battle_answer(
    '00000000-0000-0000-0000-000000000511'::uuid,
    '00000000-0000-0000-0000-000000000531'::uuid,
    '00000000-0000-0000-0000-000000000541'::uuid,
    true,
    '00000000-0000-0000-0000-000000000521'::uuid,
    'adults',
    10
  );

  select count(*) into v_responses_count from responses where participant_id = '00000000-0000-0000-0000-000000000511';
  select count(*) into v_battle_scores_count from battle_scores where participant_id = '00000000-0000-0000-0000-000000000511';

  if v_resp.participant_id is distinct from '00000000-0000-0000-0000-000000000511'::uuid
    or v_responses_count <> 1 or v_battle_scores_count <> 1 then
    raise exception 'FAILED (success path): expected 1 responses row and 1 battle_scores row, got % and %', v_responses_count, v_battle_scores_count;
  end if;

  raise notice 'PASS: success path writes both rows together';
end $$;

-- ========================================================================
-- Test 2: ownership -- session c2 tries to submit AS participant 511
-- (owned by c1). SECURITY DEFINER means this can only be caught by the
-- function's own explicit check, not by responses/battle_scores' RLS.
-- ========================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c2', true);

do $$
begin
  perform record_battle_answer(
    '00000000-0000-0000-0000-000000000511'::uuid,
    '00000000-0000-0000-0000-000000000531'::uuid,
    '00000000-0000-0000-0000-000000000541'::uuid,
    true,
    '00000000-0000-0000-0000-000000000521'::uuid,
    'adults',
    10
  );
  raise exception 'FAILED (ownership): should have been rejected, was not';
exception
  when others then
    if sqlerrm <> 'not authorized to submit a battle answer for this participant' then
      raise exception 'FAILED (ownership): rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS: cross-session submission rejected';
end $$;

-- ========================================================================
-- Test 3: atomicity -- force the second insert (battle_scores) to fail
-- via a nonexistent battle_id (FK violation). The exact bug hypothesis B
-- was about: does the responses insert survive anyway?
-- ========================================================================
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);

do $$
declare v_orphaned_count int;
begin
  begin
    perform record_battle_answer(
      '00000000-0000-0000-0000-000000000511'::uuid,
      '00000000-0000-0000-0000-000000000532'::uuid,
      '00000000-0000-0000-0000-000000000542'::uuid,
      true,
      '00000000-0000-0000-0000-000000000999'::uuid, -- nonexistent battle_id
      'adults',
      10
    );
    raise exception 'FAILED (atomicity): expected a foreign key violation, call succeeded instead';
  exception
    when foreign_key_violation then
      null; -- expected
  end;

  select count(*) into v_orphaned_count
  from responses
  where participant_id = '00000000-0000-0000-0000-000000000511'
    and question_id = '00000000-0000-0000-0000-000000000532';

  if v_orphaned_count <> 0 then
    raise exception 'FAILED (atomicity): a responses row survived despite the battle_scores insert failing -- the exact divergence hypothesis B was about is back.';
  end if;

  raise notice 'PASS: a failed battle_scores insert leaves no orphaned responses row (atomic rollback)';
end $$;

rollback;
