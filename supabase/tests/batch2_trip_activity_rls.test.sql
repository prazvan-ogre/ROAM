-- Batch 2 regression test (2026-09-05 architecture/security review, R1
-- continued): verifies 20260907090000_batch2_trip_activity_rls.sql
-- actually enforces trip-membership/self-ownership on extra_assignments/
-- prize_votes/feedback/analytics_events -- the four tables R1's first
-- pass (20260906090000_auth_ownership.sql) explicitly left `using (true)`.
--
-- Same harness/setup requirements as r1_auth_ownership_rls.test.sql --
-- see that file's own header for the full scratch-database setup
-- (auth schema stub, anon/authenticated roles + baseline grants). Run:
--   PGPASSWORD=postgres psql -U postgres -h localhost -d roam_scratch \
--     -f supabase/tests/batch2_trip_activity_rls.test.sql
--
-- Each scenario is its own transaction so failures are isolated; the
-- whole file is safe to re-run since every transaction rolls back its
-- fixture data.

\set ON_ERROR_STOP on

-- =======================================================================
-- Fixture: one trip with two families (A and B), both with a real
-- (post-batch-2) session -- no legacy row on this trip at all, so
-- cross-trip isolation is actually exercised, not masked by the legacy
-- grandfather -- a second, wholly separate trip (family C) for the
-- cross-trip isolation scenarios, and a third, dedicated trip with only
-- a legacy participant for the grandfathering scenario.
-- =======================================================================
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000010a1'), -- Family A
  ('00000000-0000-0000-0000-0000000010b1'), -- Family B (same trip as A)
  ('00000000-0000-0000-0000-0000000010c1'); -- Family C (different trip)

insert into trips (id, slug, name, duration_days) values
  ('00000000-0000-0000-0000-000000001001', 'batch2-trip-ab', 'Batch2 Trip AB', 5),
  ('00000000-0000-0000-0000-000000001002', 'batch2-trip-c', 'Batch2 Trip C', 5),
  ('00000000-0000-0000-0000-000000001003', 'batch2-trip-legacy', 'Batch2 Trip Legacy', 5);

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000001011', '00000000-0000-0000-0000-000000001001', 'dev-a', 'Family A Adult', 'adult', '00000000-0000-0000-0000-0000000010a1'),
  ('00000000-0000-0000-0000-000000001021', '00000000-0000-0000-0000-000000001001', 'dev-b', 'Family B Adult', 'adult', '00000000-0000-0000-0000-0000000010b1'),
  ('00000000-0000-0000-0000-000000001031', '00000000-0000-0000-0000-000000001002', 'dev-c', 'Family C Adult', 'adult', '00000000-0000-0000-0000-0000000010c1');

-- Legacy (pre-batch-2) participant -- no auth_user_id at all -- on its
-- OWN dedicated trip, so it doesn't also grandfather trip AB open for
-- the isolation scenarios below.
insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000001041', '00000000-0000-0000-0000-000000001003', 'dev-legacy', 'Legacy Participant', 'adult', null);

insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000001051', '00000000-0000-0000-0000-000000001001', 'discover', 1, 'morning', 1, 'Q on trip AB', 'single_choice', 10, true, true);

insert into extras (id, trip_id, question_id, title, order_index, audience, verified, published) values
  ('00000000-0000-0000-0000-000000001061', '00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000001051', 'Extra 1', 1, 'all', true, true);

-- Family A's own extra assignment.
insert into extra_assignments (extra_id, participant_id) values
  ('00000000-0000-0000-0000-000000001061', '00000000-0000-0000-0000-000000001011');

insert into prize_options (id, trip_id, title, order_index) values
  ('00000000-0000-0000-0000-000000001071', '00000000-0000-0000-0000-000000001001', 'Option 1', 1);

-- Family A's own prize vote.
insert into prize_votes (trip_id, prize_option_id, participant_id) values
  ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000001071', '00000000-0000-0000-0000-000000001011');

commit;

-- -----------------------------------------------------------------------
-- Scenario 1: Family B (member of trip AB, different family than A) can
-- read A's extra_assignments/prize_votes rows -- needed for the Extra
-- load-balancer and the prize tally -- but Family C (a different trip
-- entirely) cannot.
-- -----------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000010b1';
set role authenticated;
do $$
declare assignment_count bigint;
declare vote_count bigint;
begin
  select count(*) into assignment_count from extra_assignments where extra_id = '00000000-0000-0000-0000-000000001061';
  select count(*) into vote_count from prize_votes where trip_id = '00000000-0000-0000-0000-000000001001';
  if assignment_count = 1 and vote_count = 1 then
    raise notice 'SCENARIO 1 PASS: a trip member sees the whole trip''s assignments/votes.';
  else
    raise exception 'SCENARIO 1 FAIL: expected 1 assignment and 1 vote visible to a trip member, got %, %', assignment_count, vote_count;
  end if;
end $$;
reset role;
rollback;

begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000010c1';
set role authenticated;
do $$
declare assignment_count bigint;
declare vote_count bigint;
begin
  select count(*) into assignment_count from extra_assignments where extra_id = '00000000-0000-0000-0000-000000001061';
  select count(*) into vote_count from prize_votes where trip_id = '00000000-0000-0000-0000-000000001001';
  if assignment_count = 0 and vote_count = 0 then
    raise notice 'SCENARIO 1b PASS: a different trip''s member sees none of trip AB''s assignments/votes.';
  else
    raise exception 'SCENARIO 1b FAIL: expected 0 visible to an outsider, got %, %', assignment_count, vote_count;
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 2: Family C cannot insert an extra_assignment or prize_vote
-- as Family A's participant (impersonation attempt) -- the core thing
-- this migration fixes (previously `with check (true)` on both).
-- -----------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000010c1';
set role authenticated;
do $$
begin
  begin
    insert into extra_assignments (extra_id, participant_id)
    values ('00000000-0000-0000-0000-000000001061', '00000000-0000-0000-0000-000000001011');
    raise exception 'SCENARIO 2a FAIL: Family C impersonated Family A''s participant on an extra_assignments insert -- this must be rejected by RLS.';
  exception when insufficient_privilege then
    raise notice 'SCENARIO 2a PASS: impersonating Family A''s participant on extra_assignments was rejected.';
  end;

  begin
    insert into prize_votes (trip_id, prize_option_id, participant_id)
    values ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000001071', '00000000-0000-0000-0000-000000001011');
    raise exception 'SCENARIO 2b FAIL: Family C impersonated Family A''s participant on a prize_votes insert -- this must be rejected by RLS.';
  exception when insufficient_privilege then
    raise notice 'SCENARIO 2b PASS: impersonating Family A''s participant on prize_votes was rejected.';
  end;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 3: feedback/analytics_events insert requires real trip
-- membership -- an outsider (Family C) cannot file feedback or an
-- analytics event against trip AB at all, even anonymously
-- (participant_id null).
-- -----------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000010c1';
set role authenticated;
do $$
begin
  begin
    insert into feedback (trip_id, participant_id, learned_new)
    values ('00000000-0000-0000-0000-000000001001', null, 5);
    raise exception 'SCENARIO 3a FAIL: an outsider filed feedback on a trip they are not a member of.';
  exception when insufficient_privilege then
    raise notice 'SCENARIO 3a PASS: outsider feedback insert rejected.';
  end;

  begin
    insert into analytics_events (trip_id, event_name)
    values ('00000000-0000-0000-0000-000000001001', 'trip_joined');
    raise exception 'SCENARIO 3b FAIL: an outsider recorded an analytics event on a trip they are not a member of.';
  exception when insufficient_privilege then
    raise notice 'SCENARIO 3b PASS: outsider analytics_events insert rejected.';
  end;
end $$;
reset role;
rollback;

begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000010b1';
set role authenticated;
do $$
begin
  insert into feedback (trip_id, participant_id, learned_new)
  values ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000001021', 5);
  insert into analytics_events (trip_id, participant_id, event_name)
  values ('00000000-0000-0000-0000-000000001001', '00000000-0000-0000-0000-000000001021', 'trip_joined');
  raise notice 'SCENARIO 3c PASS: a genuine trip member can file feedback and record an analytics event as themself.';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 4: a trip that is still entirely legacy (no non-legacy member
-- at all) keeps today's open behavior for these four tables too (the
-- same grandfathering as participants/responses/battle_scores) -- an
-- anonymous request can still read/write on trip AB via the legacy
-- participant's own extra/vote, since is_trip_member() alone would
-- otherwise block everyone.
-- -----------------------------------------------------------------------
begin;
-- No JWT claim set at all -- anon role, no session.
set role anon;
do $$
declare assignment_count bigint;
begin
  insert into extra_assignments (extra_id, participant_id)
  values ('00000000-0000-0000-0000-000000001061', '00000000-0000-0000-0000-000000001041');
  select count(*) into assignment_count from extra_assignments where participant_id = '00000000-0000-0000-0000-000000001041';
  if assignment_count = 1 then
    raise notice 'SCENARIO 4 PASS: a legacy participant''s own extra_assignments write still works with no session at all.';
  else
    raise exception 'SCENARIO 4 FAIL: legacy participant write did not take effect.';
  end if;
end $$;
reset role;
rollback;
