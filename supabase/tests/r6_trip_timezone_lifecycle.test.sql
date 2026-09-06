-- R6 regression: trips.timezone (IANA validation + fallback) and
-- record_answer()'s scheduled/active/ended lifecycle gate
-- (20260907140000_r6_trip_timezone_and_lifecycle.sql). Sibling test to
-- supabase/tests/record_answer.test.sql -- same setup requirements (stub
-- `auth` schema, `anon`/`authenticated` roles with baseline grants), see
-- supabase/tests/r1_auth_ownership_rls.test.sql's header for the exact
-- DDL and how to run this against a scratch database.
--
-- What this file does NOT re-test: the 15-minute team-window rule, the
-- unique-constraint-based idempotency/conflict contract, and the
-- unauthorized-participant/cross-trip/unpublished-question rejections are
-- all already covered end-to-end by record_answer.test.sql (whose own
-- fixture trips now pin timezone = 'UTC' explicitly, precisely so their
-- `current_date`-based day arithmetic keeps agreeing with this
-- migration's timezone-aware computation regardless of what wall-clock
-- hour CI runs at -- see that file's own fixture comment). This file
-- covers what's NEW in R6: the IANA validation constraint, the
-- scheduled/ended lifecycle gate itself (record_answer.test.sql predates
-- it and never exercises a non-active trip), and that a trip's OWN
-- declared timezone -- not a hardcoded one -- is what actually drives its
-- day computation.

\set ON_ERROR_STOP on

-- =======================================================================
-- Scenario set A: IANA validation on trips.timezone.
-- =======================================================================
begin;
do $$
begin
  -- Valid IANA zone -- succeeds.
  insert into trips (id, slug, name, duration_days, start_date, timezone) values
    ('00000000-0000-0000-0000-000000009001', 'r6-valid-tz', 'R6 Valid TZ', 5, current_date, 'Europe/Bucharest');
  raise notice 'PASS scenario A1: a valid IANA timezone is accepted';
exception when others then
  raise exception 'FAIL scenario A1: valid timezone was rejected: %', sqlerrm;
end $$;

do $$
begin
  insert into trips (id, slug, name, duration_days, start_date, timezone) values
    ('00000000-0000-0000-0000-000000009002', 'r6-invalid-tz', 'R6 Invalid TZ', 5, current_date, 'Not/A_Real_Zone');
  raise exception 'FAIL scenario A2: an invalid timezone string was NOT rejected';
exception
  when others then
    raise notice 'PASS scenario A2: an invalid IANA timezone is rejected by the CHECK constraint (%)', sqlerrm;
end $$;

do $$
begin
  -- Null (pre-R6 / not-yet-decided) -- still allowed, no default forced.
  insert into trips (id, slug, name, duration_days, start_date, timezone) values
    ('00000000-0000-0000-0000-000000009003', 'r6-null-tz', 'R6 Null TZ', 5, current_date, null);
  raise notice 'PASS scenario A3: a null timezone (pre-R6 row) is still accepted, not forced to a default';
exception when others then
  raise exception 'FAIL scenario A3: null timezone was rejected: %', sqlerrm;
end $$;
rollback;

-- =======================================================================
-- Fixture for scenario sets B-E: a scheduled trip, an ended trip, and an
-- "active now, will be flipped to ended mid-scenario" trip -- all pinned
-- to timezone = 'UTC' so `current_date`/interval arithmetic below is
-- exact regardless of what wall-clock hour this runs at (same convention
-- as record_answer.test.sql's own fixture).
-- =======================================================================
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000090a1');

insert into trips (id, slug, name, duration_days, start_date, timezone) values
  ('00000000-0000-0000-0000-000000009011', 'r6-scheduled-trip', 'R6 Scheduled Trip', 5, current_date + 3, 'UTC'),
  ('00000000-0000-0000-0000-000000009012', 'r6-ended-trip', 'R6 Ended Trip', 5, current_date - 10, 'UTC'),
  ('00000000-0000-0000-0000-000000009013', 'r6-flip-trip', 'R6 Flip Trip', 5, current_date, 'UTC');

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000009021', '00000000-0000-0000-0000-000000009011', 'dev-r6', 'R6 Scheduled Adult', 'adult', '00000000-0000-0000-0000-0000000090a1'),
  ('00000000-0000-0000-0000-000000009022', '00000000-0000-0000-0000-000000009012', 'dev-r6', 'R6 Ended Adult', 'adult', '00000000-0000-0000-0000-0000000090a1'),
  ('00000000-0000-0000-0000-000000009023', '00000000-0000-0000-0000-000000009013', 'dev-r6', 'R6 Flip Adult', 'adult', '00000000-0000-0000-0000-0000000090a1');

-- Discover questions (non-battle -- isolates the lifecycle gate itself
-- from the battle-window logic, already covered by record_answer.test.sql).
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000009031', '00000000-0000-0000-0000-000000009011', 'discover', 1, 'morning', 1, 'Scheduled Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-000000009032', '00000000-0000-0000-0000-000000009012', 'discover', 5, 'morning', 1, 'Ended Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-000000009033', '00000000-0000-0000-0000-000000009013', 'discover', 1, 'morning', 1, 'Flip Q', 'single_choice', 10, true, true);

-- A Final Battle for the "flip" trip -- used in scenario set E to prove
-- it can never reopen once the trip has ended.
insert into battles (id, trip_id, day_number, title, is_final) values
  ('00000000-0000-0000-0000-000000009041', '00000000-0000-0000-0000-000000009013', null, 'R6 Flip Final', true);
insert into questions (id, trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000009034', '00000000-0000-0000-0000-000000009013', '00000000-0000-0000-0000-000000009041', 'battle', null, 1, 'Flip Final Q', 'single_choice', 10, true, true);

insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-000000009051', '00000000-0000-0000-0000-000000009031', 1, 'Scheduled correct', true),
  ('00000000-0000-0000-0000-000000009052', '00000000-0000-0000-0000-000000009031', 2, 'Scheduled wrong', false),
  ('00000000-0000-0000-0000-000000009053', '00000000-0000-0000-0000-000000009032', 1, 'Ended correct', true),
  ('00000000-0000-0000-0000-000000009054', '00000000-0000-0000-0000-000000009033', 1, 'Flip correct', true),
  ('00000000-0000-0000-0000-000000009055', '00000000-0000-0000-0000-000000009033', 2, 'Flip wrong', false),
  ('00000000-0000-0000-0000-000000009056', '00000000-0000-0000-0000-000000009034', 1, 'Flip Final correct', true);

commit;

-- -----------------------------------------------------------------------
-- Scenario B: a SCHEDULED trip (start_date 3 days from now) rejects a
-- fresh answer outright -- nothing is written.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000090a1';
do $$
begin
  perform record_answer(
    '00000000-0000-0000-0000-000000009021'::uuid,
    '00000000-0000-0000-0000-000000009031'::uuid,
    '00000000-0000-0000-0000-000000009051'::uuid
  );
  raise exception 'FAIL scenario B: a scheduled trip accepted a fresh answer';
exception
  when others then
    if sqlerrm !~ 'not currently accepting answers \(scheduled\)' then
      raise exception 'FAIL scenario B: rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS scenario B: a scheduled trip rejects a fresh answer (%)', sqlerrm;
end $$;
reset role;
do $$
declare v_count int;
begin
  select count(*) into v_count from responses where question_id = '00000000-0000-0000-0000-000000009031';
  if v_count <> 0 then
    raise exception 'FAIL scenario B: a response row was written despite the rejection';
  end if;
  raise notice 'PASS scenario B: no response row was written for the rejected scheduled-trip answer';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario C: an ENDED trip (start_date 10 days ago, duration 5) rejects
-- a fresh answer outright.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000090a1';
do $$
begin
  perform record_answer(
    '00000000-0000-0000-0000-000000009022'::uuid,
    '00000000-0000-0000-0000-000000009032'::uuid,
    '00000000-0000-0000-0000-000000009053'::uuid
  );
  raise exception 'FAIL scenario C: an ended trip accepted a fresh answer';
exception
  when others then
    if sqlerrm !~ 'not currently accepting answers \(ended\)' then
      raise exception 'FAIL scenario C: rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS scenario C: an ended trip rejects a fresh answer (%)', sqlerrm;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario D: an answer recorded while the trip was ACTIVE stays
-- idempotently readable after the trip is later flipped to ended (a
-- retry never fails just because time has since moved on) -- but a
-- DIFFERENT, never-before-answered question on that same now-ended trip
-- is still rejected outright. Also proves a late retry can never flip a
-- 'conflict' into silently overwriting the original.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000090a1';
do $$
declare r1 record;
begin
  -- Trip is still active (start_date = today) -- this succeeds normally.
  select * into r1 from record_answer(
    '00000000-0000-0000-0000-000000009023'::uuid,
    '00000000-0000-0000-0000-000000009033'::uuid,
    '00000000-0000-0000-0000-000000009054'::uuid
  );
  if r1.status <> 'accepted' then
    raise exception 'FAIL scenario D setup: expected accepted while active, got %', r1.status;
  end if;
  raise notice 'PASS scenario D setup: answer accepted while the trip was still active';
end $$;
reset role;
-- Flip the trip to "ended" (as if the pilot's five days had since
-- elapsed) -- same technique record_answer.test.sql's own scenario 17
-- uses to move a trip across a day boundary without waiting for one.
update trips set start_date = current_date - 10 where id = '00000000-0000-0000-0000-000000009013';

set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000090a1';
do $$
declare r2 record; r3 record;
begin
  -- Same (participant, question, option) as the accepted answer above --
  -- idempotent retry must still succeed even though the trip is ended now.
  select * into r2 from record_answer(
    '00000000-0000-0000-0000-000000009023'::uuid,
    '00000000-0000-0000-0000-000000009033'::uuid,
    '00000000-0000-0000-0000-000000009054'::uuid
  );
  if r2.status <> 'already_recorded' then
    raise exception 'FAIL scenario D: an idempotent retry on a now-ended trip was rejected instead of resolved: %', r2;
  end if;
  raise notice 'PASS scenario D: an identical retry on a now-ended trip still resolves (already_recorded), never rejected';

  -- Same question, DIFFERENT option -- still resolves as a conflict
  -- against the ORIGINAL answer, not rejected outright, and not silently
  -- overwritten either.
  select * into r3 from record_answer(
    '00000000-0000-0000-0000-000000009023'::uuid,
    '00000000-0000-0000-0000-000000009033'::uuid,
    '00000000-0000-0000-0000-000000009055'::uuid
  );
  if r3.status <> 'conflict' or (r3.response).selected_option_id <> '00000000-0000-0000-0000-000000009054'::uuid then
    raise exception 'FAIL scenario D: a conflicting retry on a now-ended trip changed the original answer: %', r3;
  end if;
  raise notice 'PASS scenario D: a conflicting retry on a now-ended trip resolves as conflict, original answer untouched';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario E: the Final Battle can never reopen once the trip has ended --
-- not even for a genuinely fresh answer nobody has attempted before.
-- Entirely inside one begin/rollback (like scenario D) -- the start_date
-- flip below is visible to record_answer() within this same transaction
-- without ever being permanently committed.
-- -----------------------------------------------------------------------
begin;
update trips set start_date = current_date - 10 where id = '00000000-0000-0000-0000-000000009013';

set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000090a1';
do $$
begin
  perform record_answer(
    '00000000-0000-0000-0000-000000009023'::uuid,
    '00000000-0000-0000-0000-000000009034'::uuid, -- Final Battle question, never answered before
    '00000000-0000-0000-0000-000000009056'::uuid
  );
  raise exception 'FAIL scenario E: the Final Battle accepted a fresh answer after the trip had ended';
exception
  when others then
    if sqlerrm !~ 'not currently accepting answers \(ended\)' then
      raise exception 'FAIL scenario E: rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS scenario E: the Final Battle rejects a fresh answer once the trip has ended -- it can never reopen';
end $$;
reset role;
do $$
declare v_count int;
begin
  select count(*) into v_count from battle_scores where battle_id = '00000000-0000-0000-0000-000000009041';
  if v_count <> 0 then
    raise exception 'FAIL scenario E: a battle_scores row was written for a Final Battle answer after the trip ended';
  end if;
  raise notice 'PASS scenario E: no team-score row was written for the rejected post-end Final Battle answer';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario F: a client cannot send an alternate timestamp or timezone --
-- record_answer's signature has no such parameter to forge (same style
-- as record_answer.test.sql's own scenario 7).
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000090a1';
do $$
begin
  begin
    perform record_answer(
      '00000000-0000-0000-0000-000000009021'::uuid,
      '00000000-0000-0000-0000-000000009031'::uuid,
      '00000000-0000-0000-0000-000000009051'::uuid,
      'Pacific/Kiritimati' -- forged "timezone" -- no such parameter exists
    );
    raise exception 'FAIL scenario F: expected a function-signature error, call succeeded';
  exception
    when undefined_function then
      raise notice 'PASS scenario F: record_answer has no timestamp/timezone parameter to forge (%)', sqlerrm;
  end;
end $$;
reset role;
rollback;

-- =======================================================================
-- Scenario set G: a trip's OWN declared timezone -- not a hardcoded UTC
-- or Europe/Bucharest -- drives its day computation. Each trip's
-- start_date is set to "today" AS COMPUTED IN ITS OWN ZONE (via `now() at
-- time zone <its own tz>`), so each is deterministically day 1/active
-- for ITS zone regardless of what wall-clock hour this test happens to
-- run at -- a battle scheduled for day 1 must open its team window for
-- both, proving each one's eligibility genuinely comes from its own
-- trips.timezone column, not a shared assumption.
-- =======================================================================
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000090a2');

-- Etc/GMT-14 = UTC+14 (sign inverted, POSIX convention) -- the most
-- positive real-world offset in the IANA database (e.g. Kiritimati).
-- Etc/GMT+12 = UTC-12 -- a full calendar day behind that, at the exact
-- same real instant.
insert into trips (id, slug, name, duration_days, start_date, timezone) values
  ('00000000-0000-0000-0000-000000009061', 'r6-tz-positive', 'R6 TZ UTC+14', 5, (now() at time zone 'Etc/GMT-14')::date, 'Etc/GMT-14'),
  ('00000000-0000-0000-0000-000000009062', 'r6-tz-negative', 'R6 TZ UTC-12', 5, (now() at time zone 'Etc/GMT+12')::date, 'Etc/GMT+12');

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000009071', '00000000-0000-0000-0000-000000009061', 'dev-r6-tz', 'R6 TZ+ Adult', 'adult', '00000000-0000-0000-0000-0000000090a2'),
  ('00000000-0000-0000-0000-000000009072', '00000000-0000-0000-0000-000000009062', 'dev-r6-tz', 'R6 TZ- Adult', 'adult', '00000000-0000-0000-0000-0000000090a2');

insert into battles (id, trip_id, day_number, title, is_final) values
  ('00000000-0000-0000-0000-000000009081', '00000000-0000-0000-0000-000000009061', 1, 'R6 TZ+ Battle Day 1', false),
  ('00000000-0000-0000-0000-000000009082', '00000000-0000-0000-0000-000000009062', 1, 'R6 TZ- Battle Day 1', false);

insert into questions (id, trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000009091', '00000000-0000-0000-0000-000000009061', '00000000-0000-0000-0000-000000009081', 'battle', 1, 1, 'R6 TZ+ Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-000000009092', '00000000-0000-0000-0000-000000009062', '00000000-0000-0000-0000-000000009082', 'battle', 1, 1, 'R6 TZ- Q', 'single_choice', 10, true, true);

insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-0000000090a3', '00000000-0000-0000-0000-000000009091', 1, 'TZ+ correct', true),
  ('00000000-0000-0000-0000-0000000090a4', '00000000-0000-0000-0000-000000009092', 1, 'TZ- correct', true);

commit;

begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000090a2';
do $$
declare rpos record; rneg record;
begin
  select * into rpos from record_answer(
    '00000000-0000-0000-0000-000000009071'::uuid,
    '00000000-0000-0000-0000-000000009091'::uuid,
    '00000000-0000-0000-0000-0000000090a3'::uuid
  );
  select * into rneg from record_answer(
    '00000000-0000-0000-0000-000000009072'::uuid,
    '00000000-0000-0000-0000-000000009092'::uuid,
    '00000000-0000-0000-0000-0000000090a4'::uuid
  );
  if rpos.status <> 'accepted' or rpos.contributed_to_team is not true then
    raise exception 'FAIL scenario G (UTC+14): expected an accepted, team-contributing answer on day 1 of its own zone, got %', rpos;
  end if;
  if rneg.status <> 'accepted' or rneg.contributed_to_team is not true then
    raise exception 'FAIL scenario G (UTC-12): expected an accepted, team-contributing answer on day 1 of its own zone, got %', rneg;
  end if;
  raise notice 'PASS scenario G: both a UTC+14 and a UTC-12 trip open their own battle-day team window correctly, each read in its OWN declared timezone';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Cleanup. Fixture data from the committed transactions above -- safe to
-- re-run from a clean slate.
-- -----------------------------------------------------------------------
delete from battle_scores where battle_id in (
  '00000000-0000-0000-0000-000000009041', '00000000-0000-0000-0000-000000009081', '00000000-0000-0000-0000-000000009082'
);
delete from responses where question_id in (
  '00000000-0000-0000-0000-000000009031', '00000000-0000-0000-0000-000000009032', '00000000-0000-0000-0000-000000009033',
  '00000000-0000-0000-0000-000000009034', '00000000-0000-0000-0000-000000009091', '00000000-0000-0000-0000-000000009092'
);
delete from answer_options where question_id in (
  '00000000-0000-0000-0000-000000009031', '00000000-0000-0000-0000-000000009032', '00000000-0000-0000-0000-000000009033',
  '00000000-0000-0000-0000-000000009034', '00000000-0000-0000-0000-000000009091', '00000000-0000-0000-0000-000000009092'
);
delete from questions where id in (
  '00000000-0000-0000-0000-000000009031', '00000000-0000-0000-0000-000000009032', '00000000-0000-0000-0000-000000009033',
  '00000000-0000-0000-0000-000000009034', '00000000-0000-0000-0000-000000009091', '00000000-0000-0000-0000-000000009092'
);
delete from battles where id in (
  '00000000-0000-0000-0000-000000009041', '00000000-0000-0000-0000-000000009081', '00000000-0000-0000-0000-000000009082'
);
delete from participants where trip_id in (
  '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009013',
  '00000000-0000-0000-0000-000000009061', '00000000-0000-0000-0000-000000009062'
);
delete from trips where id in (
  '00000000-0000-0000-0000-000000009011', '00000000-0000-0000-0000-000000009012', '00000000-0000-0000-0000-000000009013',
  '00000000-0000-0000-0000-000000009061', '00000000-0000-0000-0000-000000009062'
);
delete from auth.users where id in (
  '00000000-0000-0000-0000-0000000090a1', '00000000-0000-0000-0000-0000000090a2'
);

\echo 'r6_trip_timezone_lifecycle.test.sql: all scenarios passed.'
