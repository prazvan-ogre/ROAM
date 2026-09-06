-- R3 closure batch regression (2026-09-05 review, "Nu marca aceste
-- criterii închise doar pe baza structurii tranzacției"): record_answer()
-- (20260906140000_record_answer_authoritative.sql) runs the personal
-- `responses` write and the team `battle_scores` write inside a single
-- PL/pgSQL function body, which Postgres executes as part of the
-- caller's own transaction -- but that's a structural argument, not a
-- demonstration. This file forces a REAL failure between the two writes
-- and proves BOTH roll back, not just the second one.
--
-- Technique: a temporary BEFORE INSERT trigger on battle_scores,
-- created and dropped entirely inside this test's own transaction (never
-- committed, never touches any shipped migration or the record_answer
-- function itself), unconditionally raises an exception. record_answer's
-- own exception handler only catches `unique_violation` (see the
-- migration's `exception when unique_violation` block) -- a trigger-
-- raised exception is a different SQLSTATE, so it is NOT caught there
-- and propagates all the way out of the function call, aborting the
-- whole statement. If the responses insert that happened moments earlier
-- in the SAME function invocation survived that abort, atomicity would
-- be broken (an orphaned personal answer with no matching team
-- contribution) -- this is exactly the divergence hypothesis B/R3 was
-- about for the older record_battle_answer(). This test proves it is
-- impossible for record_answer() too.
--
-- Run against a scratch/dev database with all migrations applied (never
-- against real trip data) -- wrapped in a transaction rolled back at the
-- end, same setup as record_answer.test.sql (stub `auth` schema,
-- `anon`/`authenticated` roles with baseline grants).
--
--   PGDATABASE=<scratch> PGUSER=postgres PGHOST=localhost npm run test:sql:record-answer-rollback

\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000070a1');

-- R6: timezone pinned to 'UTC' so this fixture's `current_date`-based
-- start_date stays exactly "today" for record_answer's own timezone-aware
-- day computation, regardless of the wall-clock hour CI runs at -- see
-- record_answer.test.sql's own fixture comment for the full rationale.
insert into trips (id, slug, name, duration_days, start_date, timezone) values
  ('00000000-0000-0000-0000-000000007001', 'r3-rollback-trip', 'R3 Rollback Trip', 5, current_date, 'UTC');

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000007011', '00000000-0000-0000-0000-000000007001', 'dev-rollback', 'Rollback Adult', 'adult', '00000000-0000-0000-0000-0000000070a1');

insert into battles (id, trip_id, day_number, title, is_final) values
  ('00000000-0000-0000-0000-000000007041', '00000000-0000-0000-0000-000000007001', 1, 'Rollback Battle', false);

insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published, battle_id) values
  ('00000000-0000-0000-0000-000000007021', '00000000-0000-0000-0000-000000007001', 'battle', 1, null, 1, 'Rollback Q', 'single_choice', 10, true, true, '00000000-0000-0000-0000-000000007041');
insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-000000007031', '00000000-0000-0000-0000-000000007021', 1, 'Rollback Option A', true);

-- Fault injection: unconditionally reject the SECOND write (battle_scores)
-- record_answer() attempts, forcing exactly the failure window this test
-- exists to exercise, without touching record_answer()'s own source.
create function pg_temp.fail_battle_scores_insert() returns trigger
language plpgsql as $$
begin
  raise exception 'INJECTED TEST FAILURE: simulated battle_scores write failure';
end;
$$;
create trigger fail_battle_scores_insert
  before insert on battle_scores
  for each row execute function pg_temp.fail_battle_scores_insert();

set session request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a1';
set role authenticated;

do $$
declare
  caught boolean := false;
  err_message text;
begin
  begin
    perform record_answer(
      '00000000-0000-0000-0000-000000007011',
      '00000000-0000-0000-0000-000000007021',
      '00000000-0000-0000-0000-000000007031'
    );
  exception when others then
    caught := true;
    get stacked diagnostics err_message = message_text;
  end;

  if not caught then
    raise exception 'FAIL: record_answer() did not propagate the injected battle_scores failure -- the call succeeded when it should have aborted.';
  end if;
  if err_message not like '%INJECTED TEST FAILURE%' then
    raise exception 'FAIL: record_answer() raised an unexpected error instead of propagating the injected failure: %', err_message;
  end if;
  raise notice 'PASS: record_answer() propagated the injected battle_scores failure instead of swallowing it (only unique_violation is caught internally).';
end $$;

reset role;

-- The real proof: did the EARLIER responses insert, which had already
-- happened inside the same aborted function call, survive anyway? If
-- atomicity holds, it must not -- Postgres rolls back the entire
-- statement (the whole record_answer() call), not just the failing
-- battle_scores insert.
do $$
declare responses_count bigint; battle_scores_count bigint;
begin
  select count(*) into responses_count from responses
  where participant_id = '00000000-0000-0000-0000-000000007011'
    and question_id = '00000000-0000-0000-0000-000000007021';
  select count(*) into battle_scores_count from battle_scores
  where participant_id = '00000000-0000-0000-0000-000000007011';

  if responses_count <> 0 then
    raise exception 'REGRESSION: a responses row survived (count=%) even though the same call''s battle_scores write was forced to fail -- record_answer() is NOT atomic, an orphaned personal answer with no team contribution was left behind.', responses_count;
  end if;
  if battle_scores_count <> 0 then
    raise exception 'REGRESSION: a battle_scores row exists (count=%) despite the injected failure -- the fault injection itself did not work as intended.', battle_scores_count;
  end if;

  raise notice 'PASS: neither the responses write nor the battle_scores write survived the injected failure -- both rolled back together, proving real atomicity (not just transaction structure).';
end $$;

-- Sanity check: with the fault trigger gone, the SAME call now succeeds
-- normally and both rows land -- confirms the rollback above wasn't
-- because the call was broken in some other way.
drop trigger fail_battle_scores_insert on battle_scores;

set session request.jwt.claim.sub = '00000000-0000-0000-0000-0000000070a1';
set role authenticated;

do $$
declare responses_count bigint; battle_scores_count bigint;
begin
  perform record_answer(
    '00000000-0000-0000-0000-000000007011',
    '00000000-0000-0000-0000-000000007021',
    '00000000-0000-0000-0000-000000007031'
  );

  select count(*) into responses_count from responses
  where participant_id = '00000000-0000-0000-0000-000000007011'
    and question_id = '00000000-0000-0000-0000-000000007021';
  select count(*) into battle_scores_count from battle_scores
  where participant_id = '00000000-0000-0000-0000-000000007011';

  if responses_count <> 1 or battle_scores_count <> 1 then
    raise exception 'SANITY CHECK FAILED: expected exactly 1 responses row and 1 battle_scores row once the fault trigger was removed, got responses=% battle_scores=%.', responses_count, battle_scores_count;
  end if;

  raise notice 'PASS: with the injected fault removed, the same call now writes both rows normally.';
end $$;

reset role;

rollback;
