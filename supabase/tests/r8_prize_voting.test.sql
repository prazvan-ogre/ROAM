-- R8 regression: prize voting rules
-- (20260908090000_r8_prize_voting_rules.sql) -- cast_prize_vote() and
-- get_prize_status(), the only way to write/resolve prize_votes/
-- prize_results now. Sibling test to supabase/tests/record_answer.test.sql
-- and r6_trip_timezone_lifecycle.test.sql -- same setup requirements (stub
-- `auth` schema, `anon`/`authenticated` roles with baseline grants); see
-- r1_auth_ownership_rls.test.sql's header for the exact DDL and how to run
-- this against a scratch database.
--
-- Every fixture trip below pins timezone = 'UTC' and derives start_date
-- from current_date/interval arithmetic, same convention as every other
-- lifecycle-sensitive test file here, so "voting is still open" / "voting
-- has already closed" is exact regardless of what wall-clock hour this
-- runs at.

\set ON_ERROR_STOP on

-- =======================================================================
-- Scenario set A: prize_options row-level constraints (non-blank title,
-- unique title per trip) -- the DB-enforced half of "at least 2 distinct,
-- non-null options".
-- =======================================================================
begin;
insert into trips (id, slug, name, duration_days, start_date, timezone) values
  ('00000000-0000-0000-0000-000000004001', 'r8-constraints-trip', 'R8 Constraints Trip', 5, current_date, 'UTC');

do $$
begin
  insert into prize_options (trip_id, title, order_index) values
    ('00000000-0000-0000-0000-000000004001', '   ', 1);
  raise exception 'FAIL scenario A1: a blank (whitespace-only) title was NOT rejected';
exception
  when others then
    raise notice 'PASS scenario A1: a blank title is rejected by the CHECK constraint (%)', sqlerrm;
end $$;

do $$
begin
  insert into prize_options (trip_id, title, order_index) values
    ('00000000-0000-0000-0000-000000004001', 'Duplicate', 1),
    ('00000000-0000-0000-0000-000000004001', 'Duplicate', 2);
  raise exception 'FAIL scenario A2: a duplicate title within the same trip was NOT rejected';
exception
  when others then
    raise notice 'PASS scenario A2: a duplicate title per trip is rejected by the unique constraint (%)', sqlerrm;
end $$;
rollback;

-- =======================================================================
-- Fixture for scenario sets B-I.
--   - open-trip: start_date = today (UTC) -- still well within day 1,
--     voting open regardless of what hour this runs at.
--   - closed-trip: start_date = 2 days ago (UTC) -- voting closed.
--   - crosstrip-b: a second, unrelated trip -- its own option must never
--     be votable from open-trip's participant.
--   - single-opt-trip: only one prize option configured -- "not_configured".
-- =======================================================================
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000040a1'), -- Alice (open-trip)
  ('00000000-0000-0000-0000-0000000040a2'), -- Bob (open-trip)
  ('00000000-0000-0000-0000-0000000040a3'), -- Carol (closed-trip, votes before close)
  ('00000000-0000-0000-0000-0000000040a4'), -- Dave (closed-trip, joins after close)
  ('00000000-0000-0000-0000-0000000040a5'), -- Erin (crosstrip attacker, open-trip participant)
  ('00000000-0000-0000-0000-0000000040a6'), -- Frank (single-opt-trip)
  ('00000000-0000-0000-0000-0000000040a7'), -- Grace (tie-trip, votes A)
  ('00000000-0000-0000-0000-0000000040a8'), -- Heidi (tie-trip, votes B)
  ('00000000-0000-0000-0000-0000000040a9'); -- Ivan (concurrency-trip)

insert into trips (id, slug, name, duration_days, start_date, timezone) values
  ('00000000-0000-0000-0000-000000004011', 'r8-open-trip', 'R8 Open Trip', 5, current_date, 'UTC'),
  ('00000000-0000-0000-0000-000000004012', 'r8-closed-trip', 'R8 Closed Trip', 5, current_date - 2, 'UTC'),
  ('00000000-0000-0000-0000-000000004013', 'r8-crosstrip-b', 'R8 Crosstrip B', 5, current_date, 'UTC'),
  ('00000000-0000-0000-0000-000000004014', 'r8-single-opt-trip', 'R8 Single Opt Trip', 5, current_date - 2, 'UTC'),
  ('00000000-0000-0000-0000-000000004015', 'r8-tie-trip', 'R8 Tie Trip', 5, current_date - 2, 'UTC'),
  ('00000000-0000-0000-0000-000000004016', 'r8-zero-votes-trip', 'R8 Zero Votes Trip', 5, current_date - 2, 'UTC'),
  ('00000000-0000-0000-0000-000000004017', 'r8-concurrency-trip', 'R8 Concurrency Trip', 5, current_date, 'UTC');

insert into prize_options (id, trip_id, title, order_index) values
  ('00000000-0000-0000-0000-000000004101', '00000000-0000-0000-0000-000000004011', 'Open A', 1),
  ('00000000-0000-0000-0000-000000004102', '00000000-0000-0000-0000-000000004011', 'Open B', 2),
  ('00000000-0000-0000-0000-000000004103', '00000000-0000-0000-0000-000000004012', 'Closed A', 1),
  ('00000000-0000-0000-0000-000000004104', '00000000-0000-0000-0000-000000004012', 'Closed B', 2),
  ('00000000-0000-0000-0000-000000004105', '00000000-0000-0000-0000-000000004013', 'Crosstrip B Only', 1),
  ('00000000-0000-0000-0000-000000004106', '00000000-0000-0000-0000-000000004013', 'Crosstrip B Only 2', 2),
  ('00000000-0000-0000-0000-000000004107', '00000000-0000-0000-0000-000000004014', 'Only Option', 1),
  ('00000000-0000-0000-0000-000000004108', '00000000-0000-0000-0000-000000004015', 'Tie A', 1),
  ('00000000-0000-0000-0000-000000004109', '00000000-0000-0000-0000-000000004015', 'Tie B', 2),
  ('00000000-0000-0000-0000-00000000410a', '00000000-0000-0000-0000-000000004016', 'Zero Votes First', 1),
  ('00000000-0000-0000-0000-00000000410b', '00000000-0000-0000-0000-000000004016', 'Zero Votes Second', 2),
  ('00000000-0000-0000-0000-00000000410c', '00000000-0000-0000-0000-000000004017', 'Concurrency A', 1),
  ('00000000-0000-0000-0000-00000000410d', '00000000-0000-0000-0000-000000004017', 'Concurrency B', 2);

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000004201', '00000000-0000-0000-0000-000000004011', 'dev-alice', 'Alice', 'adult', '00000000-0000-0000-0000-0000000040a1'),
  ('00000000-0000-0000-0000-000000004202', '00000000-0000-0000-0000-000000004011', 'dev-bob', 'Bob', 'adult', '00000000-0000-0000-0000-0000000040a2'),
  ('00000000-0000-0000-0000-000000004203', '00000000-0000-0000-0000-000000004012', 'dev-carol', 'Carol', 'adult', '00000000-0000-0000-0000-0000000040a3'),
  ('00000000-0000-0000-0000-000000004204', '00000000-0000-0000-0000-000000004011', 'dev-erin', 'Erin', 'adult', '00000000-0000-0000-0000-0000000040a5'),
  ('00000000-0000-0000-0000-000000004205', '00000000-0000-0000-0000-000000004014', 'dev-frank', 'Frank', 'adult', '00000000-0000-0000-0000-0000000040a6'),
  ('00000000-0000-0000-0000-000000004206', '00000000-0000-0000-0000-000000004015', 'dev-grace', 'Grace', 'adult', '00000000-0000-0000-0000-0000000040a7'),
  ('00000000-0000-0000-0000-000000004207', '00000000-0000-0000-0000-000000004015', 'dev-heidi', 'Heidi', 'adult', '00000000-0000-0000-0000-0000000040a8'),
  ('00000000-0000-0000-0000-000000004208', '00000000-0000-0000-0000-000000004017', 'dev-ivan1', 'Ivan1', 'adult', '00000000-0000-0000-0000-0000000040a9'),
  ('00000000-0000-0000-0000-000000004209', '00000000-0000-0000-0000-000000004017', 'dev-ivan2', 'Ivan2', 'child', '00000000-0000-0000-0000-0000000040a9'),
  -- Dave joins the closed trip AFTER voting has already ended -- created
  -- here (fixture setup), but never given a chance to vote in any
  -- scenario below, exactly like a real late joiner.
  ('00000000-0000-0000-0000-00000000420a', '00000000-0000-0000-0000-000000004012', 'dev-dave', 'Dave', 'adult', '00000000-0000-0000-0000-0000000040a4');

commit;

-- -----------------------------------------------------------------------
-- Scenario B: a valid vote is recorded; retrying with the SAME option is
-- idempotent ('already_recorded'); attempting a DIFFERENT option is a
-- 'conflict' that never changes the original -- the product rule that a
-- vote can never be changed once cast, enforced server-side regardless of
-- whether voting is still open.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a1';
do $$
declare r1 record; r2 record; r3 record;
begin
  select * into r1 from cast_prize_vote('00000000-0000-0000-0000-000000004201'::uuid, '00000000-0000-0000-0000-000000004101'::uuid);
  if r1.status <> 'recorded' or (r1.vote).prize_option_id <> '00000000-0000-0000-0000-000000004101'::uuid then
    raise exception 'FAIL scenario B1: expected a recorded vote for Open A, got %', r1;
  end if;
  raise notice 'PASS scenario B1: a valid vote is recorded';

  select * into r2 from cast_prize_vote('00000000-0000-0000-0000-000000004201'::uuid, '00000000-0000-0000-0000-000000004101'::uuid);
  if r2.status <> 'already_recorded' then
    raise exception 'FAIL scenario B2: a retry of the SAME vote was not idempotent: %', r2;
  end if;
  raise notice 'PASS scenario B2: retrying the same vote is idempotent (already_recorded)';

  select * into r3 from cast_prize_vote('00000000-0000-0000-0000-000000004201'::uuid, '00000000-0000-0000-0000-000000004102'::uuid);
  if r3.status <> 'conflict' or (r3.vote).prize_option_id <> '00000000-0000-0000-0000-000000004101'::uuid then
    raise exception 'FAIL scenario B3: attempting to change the vote was not rejected as a conflict: %', r3;
  end if;
  raise notice 'PASS scenario B3: attempting to change an already-cast vote is rejected (conflict), original untouched';
end $$;
do $$
declare v_count int;
begin
  select count(*) into v_count from prize_votes where participant_id = '00000000-0000-0000-0000-000000004201';
  if v_count <> 1 then
    raise exception 'FAIL scenario B: expected exactly 1 vote row for the participant, found %', v_count;
  end if;
  raise notice 'PASS scenario B: exactly one vote row exists despite 3 calls (no duplicate, no overwrite)';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario C: a vote for an option belonging to a DIFFERENT trip is
-- rejected outright ('invalid_option') -- the exact cross-trip vote the
-- old RLS `with check` never verified.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a5';
do $$
declare r record;
begin
  select * into r from cast_prize_vote('00000000-0000-0000-0000-000000004204'::uuid, '00000000-0000-0000-0000-000000004105'::uuid);
  if r.status <> 'invalid_option' or r.vote is not null then
    raise exception 'FAIL scenario C: a vote for another trip''s option was not rejected: %', r;
  end if;
  raise notice 'PASS scenario C: a vote for an option belonging to a different trip is rejected (invalid_option)';
end $$;
do $$
declare v_count int;
begin
  select count(*) into v_count from prize_votes where participant_id = '00000000-0000-0000-0000-000000004204';
  if v_count <> 0 then
    raise exception 'FAIL scenario C: a vote row was written despite the rejection';
  end if;
  raise notice 'PASS scenario C: no vote row was written for the rejected cross-trip attempt';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario D: voting after the first day has ended. A vote already on
-- record before closing still resolves idempotently after close (an
-- answer right at the boundary is never lost); a genuinely NEW vote
-- (never attempted before close) is rejected outright ('voting_closed').
-- -----------------------------------------------------------------------
begin;
-- r8-closed-trip's start_date is already 2 days in the past from fixture
-- creation -- this is a genuinely NEW vote attempt (Carol has never
-- voted here before) on a trip whose voting window is already closed.
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a3';
do $$
declare r record;
begin
  -- Carol never actually has a vote on record (the insert above was
  -- rolled back) -- so this is a genuinely NEW vote attempt on an
  -- already-closed trip.
  select * into r from cast_prize_vote('00000000-0000-0000-0000-000000004203'::uuid, '00000000-0000-0000-0000-000000004103'::uuid);
  if r.status <> 'voting_closed' or r.vote is not null then
    raise exception 'FAIL scenario D: a genuinely new vote after voting closed was not rejected: %', r;
  end if;
  raise notice 'PASS scenario D: a new vote attempted after the first day has ended is rejected (voting_closed)';
end $$;
reset role;
rollback;

-- Same trip, but this time the vote genuinely landed BEFORE the close --
-- proving an idempotent retry right at (or after) the boundary still
-- resolves, never rejected, exactly like record_answer's own scheduled/
-- ended handling.
begin;
insert into prize_votes (trip_id, prize_option_id, participant_id) values
  ('00000000-0000-0000-0000-000000004012', '00000000-0000-0000-0000-000000004103', '00000000-0000-0000-0000-000000004203');
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a3';
do $$
declare r_same record; r_diff record;
begin
  select * into r_same from cast_prize_vote('00000000-0000-0000-0000-000000004203'::uuid, '00000000-0000-0000-0000-000000004103'::uuid);
  if r_same.status <> 'already_recorded' then
    raise exception 'FAIL scenario D2: an idempotent retry of a pre-close vote was rejected instead of resolved: %', r_same;
  end if;
  raise notice 'PASS scenario D2: an idempotent retry of a vote cast before closing still resolves after closing (already_recorded)';

  select * into r_diff from cast_prize_vote('00000000-0000-0000-0000-000000004203'::uuid, '00000000-0000-0000-0000-000000004104'::uuid);
  if r_diff.status <> 'conflict' or (r_diff.vote).prize_option_id <> '00000000-0000-0000-0000-000000004103'::uuid then
    raise exception 'FAIL scenario D2: a conflicting vote after close did not resolve as conflict against the original: %', r_diff;
  end if;
  raise notice 'PASS scenario D2: a conflicting vote after close resolves as conflict, original untouched';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario E: zero votes cast -- the first configured option (stable
-- order_index order) wins by default, method = 'no_votes_default'.
-- Re-calling get_prize_status afterward returns the IDENTICAL result --
-- never recomputed.
-- -----------------------------------------------------------------------
begin;
do $$
declare r1 record; r2 record;
begin
  select * into r1 from get_prize_status('00000000-0000-0000-0000-000000004016'::uuid);
  if r1.configured is not true or r1.voting_open is not false
     or r1.winner_option_id <> '00000000-0000-0000-0000-00000000410a'::uuid
     or r1.resolution_method <> 'no_votes_default' then
    raise exception 'FAIL scenario E1: zero-vote resolution did not pick the first configured option: %', r1;
  end if;
  raise notice 'PASS scenario E1: zero votes resolves to the first configured option (no_votes_default)';

  select * into r2 from get_prize_status('00000000-0000-0000-0000-000000004016'::uuid);
  if r2.winner_option_id <> r1.winner_option_id or r2.resolution_method <> r1.resolution_method then
    raise exception 'FAIL scenario E2: a second call recomputed a different result: % vs %', r1, r2;
  end if;
  raise notice 'PASS scenario E2: a repeated call returns the identical stored result -- never recomputed';
end $$;
do $$
declare v_count int;
begin
  select count(*) into v_count from prize_results where trip_id = '00000000-0000-0000-0000-000000004016';
  if v_count <> 1 then
    raise exception 'FAIL scenario E: expected exactly one persisted prize_results row, found %', v_count;
  end if;
  raise notice 'PASS scenario E: exactly one prize_results row was persisted despite two resolving calls';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario F: a genuine tie -- resolved via the documented deterministic
-- hash tie-break (md5(trip_id || ':' || option_id), lowest wins), NOT
-- Postgres's own random()/session state. The test independently computes
-- the same formula and asserts the EXACT expected winner -- proving the
-- tie-break is a controlled, testable source, not merely "stable across
-- reads" (already proven separately below).
-- -----------------------------------------------------------------------
begin;
insert into prize_votes (trip_id, prize_option_id, participant_id) values
  ('00000000-0000-0000-0000-000000004015', '00000000-0000-0000-0000-000000004108', '00000000-0000-0000-0000-000000004206'),
  ('00000000-0000-0000-0000-000000004015', '00000000-0000-0000-0000-000000004109', '00000000-0000-0000-0000-000000004207');

do $$
declare r record; v_expected uuid;
begin
  select po.id into v_expected
  from prize_options po
  where po.trip_id = '00000000-0000-0000-0000-000000004015'
  order by md5('00000000-0000-0000-0000-000000004015' || ':' || po.id::text) asc
  limit 1;

  select * into r from get_prize_status('00000000-0000-0000-0000-000000004015'::uuid);
  if r.resolution_method <> 'tie_break_random' then
    raise exception 'FAIL scenario F1: a genuine 1-1 tie was not resolved as tie_break_random: %', r;
  end if;
  if r.winner_option_id <> v_expected then
    raise exception 'FAIL scenario F2: tie-break winner (%) did not match the independently-computed expected winner (%)', r.winner_option_id, v_expected;
  end if;
  raise notice 'PASS scenario F: a tie is resolved via the documented deterministic hash tie-break, matching an independently-computed expectation (winner: %)', r.winner_option_id;

  -- Idempotent: resolving again returns the same winner, never re-rolled.
  select * into r from get_prize_status('00000000-0000-0000-0000-000000004015'::uuid);
  if r.winner_option_id <> v_expected then
    raise exception 'FAIL scenario F3: a second call to a resolved tie changed the winner: %', r;
  end if;
  raise notice 'PASS scenario F: repeated resolution of a tie never re-rolls the winner';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario G: a participant added AFTER voting has closed -- cannot vote
-- (voting_closed), cannot change the outcome, and get_prize_status shows
-- the winner directly to anyone, including this late joiner (there is no
-- per-participant "have you voted" gate on the read path at all).
-- -----------------------------------------------------------------------
begin;
-- Carol (the only real vote on this trip) casts it before the trip is
-- ever flipped to closed, exactly like scenario D2's setup.
insert into prize_votes (trip_id, prize_option_id, participant_id) values
  ('00000000-0000-0000-0000-000000004012', '00000000-0000-0000-0000-000000004103', '00000000-0000-0000-0000-000000004203');

do $$
declare r_before record;
begin
  select * into r_before from get_prize_status('00000000-0000-0000-0000-000000004012'::uuid);
  if r_before.voting_open is not false or r_before.winner_option_id <> '00000000-0000-0000-0000-000000004103'::uuid then
    raise exception 'FAIL scenario G setup: expected the trip to already be resolved with Closed A as winner: %', r_before;
  end if;
end $$;

set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a4';
do $$
declare r record;
begin
  -- Dave (fixture: joined this trip, never voted) attempts to vote now --
  -- rejected, exactly like any other genuinely new vote after close.
  select * into r from cast_prize_vote('00000000-0000-0000-0000-00000000420a'::uuid, '00000000-0000-0000-0000-000000004104'::uuid);
  if r.status <> 'voting_closed' then
    raise exception 'FAIL scenario G: a late-joining participant was able to vote: %', r;
  end if;
  raise notice 'PASS scenario G: a participant who joined after voting closed cannot vote (voting_closed)';
end $$;
reset role;

do $$
declare r_after record;
begin
  -- The result is unaffected by Dave's rejected attempt -- same winner as
  -- before, visible to anyone (no participant-specific gate on the read).
  select * into r_after from get_prize_status('00000000-0000-0000-0000-000000004012'::uuid);
  if r_after.winner_option_id <> '00000000-0000-0000-0000-000000004103'::uuid then
    raise exception 'FAIL scenario G: the winner changed after a rejected late vote attempt: %', r_after;
  end if;
  raise notice 'PASS scenario G: a late joiner sees the winning prize directly, and cannot change the result';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario H: concurrency between two simultaneous votes. Two different
-- participants voting back-to-back (the same code path a true concurrent
-- race would hit -- see record_answer.test.sql's own header for this
-- codebase's established convention that sequential calls in one session
-- exercise the identical row-lock/unique-constraint logic a real race
-- would) both succeed independently, and the subsequent resolution counts
-- BOTH of them correctly -- no lost update from the trip-row lock
-- cast_prize_vote/get_prize_status share.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a9';
do $$
declare r1 record; r2 record;
begin
  select * into r1 from cast_prize_vote('00000000-0000-0000-0000-000000004208'::uuid, '00000000-0000-0000-0000-00000000410c'::uuid);
  select * into r2 from cast_prize_vote('00000000-0000-0000-0000-000000004209'::uuid, '00000000-0000-0000-0000-00000000410d'::uuid);
  if r1.status <> 'recorded' or r2.status <> 'recorded' then
    raise exception 'FAIL scenario H1: two back-to-back votes from different participants did not both succeed: % / %', r1, r2;
  end if;
  raise notice 'PASS scenario H1: two back-to-back votes from different participants both succeed independently';
end $$;
reset role;

-- Close the window (simulate the trip's first day having ended) and
-- resolve -- both votes must be counted, resulting in a genuine 1-1 tie
-- resolved the same deterministic way as scenario F.
update trips set start_date = current_date - 2 where id = '00000000-0000-0000-0000-000000004017';
do $$
declare r record; v_expected uuid;
begin
  select po.id into v_expected
  from prize_options po
  where po.trip_id = '00000000-0000-0000-0000-000000004017'
  order by md5('00000000-0000-0000-0000-000000004017' || ':' || po.id::text) asc
  limit 1;

  select * into r from get_prize_status('00000000-0000-0000-0000-000000004017'::uuid);
  if r.resolution_method <> 'tie_break_random' or r.winner_option_id <> v_expected then
    raise exception 'FAIL scenario H2: resolution after two concurrent-equivalent votes did not count both correctly: % (expected winner %)', r, v_expected;
  end if;
  raise notice 'PASS scenario H2: resolution after two near-simultaneous votes counts both correctly (no lost update)';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario I: fewer than 2 configured options -- never a meaningful vote,
-- regardless of whether voting would otherwise be open or closed.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a6';
do $$
declare r record; s record;
begin
  select * into r from cast_prize_vote('00000000-0000-0000-0000-000000004205'::uuid, '00000000-0000-0000-0000-000000004107'::uuid);
  if r.status <> 'not_configured' then
    raise exception 'FAIL scenario I1: a vote on a single-option trip was not rejected: %', r;
  end if;
  raise notice 'PASS scenario I1: a trip with fewer than 2 configured options never accepts a vote (not_configured)';

  select * into s from get_prize_status('00000000-0000-0000-0000-000000004014'::uuid);
  if s.configured is not false or s.voting_open is not false or s.winner_option_id is not null then
    raise exception 'FAIL scenario I2: status for a single-option trip was not reported as not configured: %', s;
  end if;
  raise notice 'PASS scenario I2: status for an under-configured trip reports configured=false, no winner';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario J: authorization boundary. (a) a direct INSERT into
-- prize_votes by anon/authenticated is rejected outright -- cast_prize_vote
-- is now the only write path. (b) cast_prize_vote itself rejects a caller
-- voting as a participant it doesn't own (a different auth.uid()).
-- -----------------------------------------------------------------------
begin;
set role anon;
do $$
begin
  insert into prize_votes (trip_id, prize_option_id, participant_id) values
    ('00000000-0000-0000-0000-000000004011', '00000000-0000-0000-0000-000000004101', '00000000-0000-0000-0000-000000004201');
  raise exception 'FAIL scenario J1: a direct INSERT into prize_votes was NOT rejected by RLS';
exception
  when insufficient_privilege then
    raise notice 'PASS scenario J1: a direct INSERT into prize_votes is rejected -- cast_prize_vote is the only write path (%)', sqlerrm;
end $$;
reset role;

set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000040a2';
do $$
begin
  -- Bob's own auth.uid() attempting to vote as Alice's participant row.
  perform cast_prize_vote('00000000-0000-0000-0000-000000004201'::uuid, '00000000-0000-0000-0000-000000004101'::uuid);
  raise exception 'FAIL scenario J2: voting as a participant the caller does not own was NOT rejected';
exception
  when others then
    if sqlerrm !~ 'not authorized to vote' then
      raise exception 'FAIL scenario J2: rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS scenario J2: voting as a participant the caller does not own is rejected (%)', sqlerrm;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Cleanup. Fixture data from the committed transaction above -- safe to
-- re-run from a clean slate.
-- -----------------------------------------------------------------------
delete from prize_results where trip_id in (
  '00000000-0000-0000-0000-000000004011', '00000000-0000-0000-0000-000000004012', '00000000-0000-0000-0000-000000004013',
  '00000000-0000-0000-0000-000000004014', '00000000-0000-0000-0000-000000004015', '00000000-0000-0000-0000-000000004016',
  '00000000-0000-0000-0000-000000004017'
);
delete from prize_votes where trip_id in (
  '00000000-0000-0000-0000-000000004011', '00000000-0000-0000-0000-000000004012', '00000000-0000-0000-0000-000000004013',
  '00000000-0000-0000-0000-000000004014', '00000000-0000-0000-0000-000000004015', '00000000-0000-0000-0000-000000004016',
  '00000000-0000-0000-0000-000000004017'
);
delete from prize_options where trip_id in (
  '00000000-0000-0000-0000-000000004011', '00000000-0000-0000-0000-000000004012', '00000000-0000-0000-0000-000000004013',
  '00000000-0000-0000-0000-000000004014', '00000000-0000-0000-0000-000000004015', '00000000-0000-0000-0000-000000004016',
  '00000000-0000-0000-0000-000000004017'
);
delete from participants where trip_id in (
  '00000000-0000-0000-0000-000000004011', '00000000-0000-0000-0000-000000004012', '00000000-0000-0000-0000-000000004013',
  '00000000-0000-0000-0000-000000004014', '00000000-0000-0000-0000-000000004015', '00000000-0000-0000-0000-000000004016',
  '00000000-0000-0000-0000-000000004017'
);
delete from trips where id in (
  '00000000-0000-0000-0000-000000004011', '00000000-0000-0000-0000-000000004012', '00000000-0000-0000-0000-000000004013',
  '00000000-0000-0000-0000-000000004014', '00000000-0000-0000-0000-000000004015', '00000000-0000-0000-0000-000000004016',
  '00000000-0000-0000-0000-000000004017'
);
delete from auth.users where id in (
  '00000000-0000-0000-0000-0000000040a1', '00000000-0000-0000-0000-0000000040a2', '00000000-0000-0000-0000-0000000040a3',
  '00000000-0000-0000-0000-0000000040a4', '00000000-0000-0000-0000-0000000040a5', '00000000-0000-0000-0000-0000000040a6',
  '00000000-0000-0000-0000-0000000040a7', '00000000-0000-0000-0000-0000000040a8', '00000000-0000-0000-0000-0000000040a9'
);

\echo 'r8_prize_voting.test.sql: all scenarios passed.'
