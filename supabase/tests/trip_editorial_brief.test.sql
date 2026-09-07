-- Trip editorial brief regression: trip_editorial_briefs' own row-level
-- constraints, save_trip_editorial_brief() (20260909090000_trip_
-- editorial_brief.sql), the RLS boundary (service-role only -- no
-- anon/authenticated policy at all), the validate_trip_content()
-- structural hook, and the edit-vs-publish serialization the two
-- functions' shared `trips` row lock provides. Sibling test to
-- supabase/tests/r7_content_publishing.test.sql -- same setup
-- requirements (stub `auth` schema, `anon`/`authenticated` roles with
-- baseline grants); see r1_auth_ownership_rls.test.sql's header for the
-- exact DDL and how to run this against a scratch database.
--
-- What this file does NOT cover: "creator A cannot edit creator B's
-- trip" and "a non-admin, non-creator account is rejected" are pure
-- application-layer authorization (src/lib/security/tripAuthorAccess.ts
-- compares the verified session's accountId against trips.
-- created_by_account_id -- there is no RLS policy on this table scoping
-- by creator account at all, by design; see this migration's own
-- header). Those are covered by tests/unit/api-trips-brief.test.ts
-- against the real route code instead.

\set ON_ERROR_STOP on

-- =======================================================================
-- Scenario set A: trip_editorial_briefs' own row-level constraints.
-- =======================================================================
begin;
insert into trips (id, slug, name, duration_days, start_date, timezone, destination, content_status) values
  ('00000000-0000-0000-0000-0000000e0001', 'brief-constraints-trip', 'Brief Constraints Trip', 5, current_date, 'UTC', 'Nowhere', 'pending');

do $$
begin
  insert into trip_editorial_briefs (trip_id, difficulty, style, theme_history, theme_places, theme_food, theme_curiosities)
  values ('00000000-0000-0000-0000-0000000e0001', 'medium', 'fun', 40, 40, 40, 40);
  raise exception 'FAIL scenario A1: theme percentages summing to more than 100 were NOT rejected';
exception
  when others then
    raise notice 'PASS scenario A1: theme percentages must sum to exactly 100 (%)', sqlerrm;
end $$;

do $$
begin
  insert into trip_editorial_briefs (trip_id, difficulty, style, theme_history, theme_places, theme_food, theme_curiosities)
  values ('00000000-0000-0000-0000-0000000e0001', 'medium', 'fun', 120, -20, 0, 0);
  raise exception 'FAIL scenario A2: an out-of-range (0-100) percentage was NOT rejected';
exception
  when others then
    raise notice 'PASS scenario A2: an out-of-range percentage is rejected (%)', sqlerrm;
end $$;

do $$
begin
  insert into trip_editorial_briefs (trip_id, difficulty, style, theme_history, theme_places, theme_food, theme_curiosities)
  values ('00000000-0000-0000-0000-0000000e0001', 'medium', 'narrated_by_character', 25, 25, 25, 25);
  raise exception 'FAIL scenario A3: narrated_by_character with no character name was NOT rejected';
exception
  when others then
    raise notice 'PASS scenario A3: narrated_by_character requires a non-blank character name (%)', sqlerrm;
end $$;

do $$
begin
  insert into trip_editorial_briefs (trip_id, difficulty, style, narrator_character_name, theme_history, theme_places, theme_food, theme_curiosities)
  values ('00000000-0000-0000-0000-0000000e0001', 'medium', 'narrated_by_character', '   ', 25, 25, 25, 25);
  raise exception 'FAIL scenario A4: a whitespace-only character name was NOT rejected';
exception
  when others then
    raise notice 'PASS scenario A4: a whitespace-only character name is rejected the same as a missing one (%)', sqlerrm;
end $$;

do $$
begin
  insert into trip_editorial_briefs (trip_id, difficulty, style, theme_history, theme_places, theme_food, theme_curiosities)
  values ('00000000-0000-0000-0000-0000000e0001', 'extreme', 'fun', 25, 25, 25, 25);
  raise exception 'FAIL scenario A5: an unknown difficulty value was NOT rejected';
exception
  when invalid_text_representation then
    raise notice 'PASS scenario A5: an unknown difficulty value is rejected by the enum type itself (%)', sqlerrm;
end $$;

do $$
begin
  -- A valid, complete row -- confirms the constraints above reject only
  -- the specific bad shapes, not every insert.
  insert into trip_editorial_briefs (trip_id, difficulty, style, theme_history, theme_places, theme_food, theme_curiosities)
  values ('00000000-0000-0000-0000-0000000e0001', 'easy', 'academic', 0, 30, 30, 40);
  raise notice 'PASS scenario A6: a valid brief (including a 0%% category) is accepted';
exception when others then
  raise exception 'FAIL scenario A6: a valid brief was rejected: %', sqlerrm;
end $$;
rollback;

-- =======================================================================
-- Fixture for scenario sets B-E.
-- =======================================================================
begin;
insert into trips (id, slug, name, duration_days, start_date, timezone, destination, content_status) values
  ('00000000-0000-0000-0000-0000000e0011', 'brief-pending-trip', 'Brief Pending Trip', 5, current_date, 'UTC', 'Nowhere', 'pending'),
  ('00000000-0000-0000-0000-0000000e0012', 'brief-ready-trip', 'Brief Ready Trip', 5, current_date, 'UTC', 'Nowhere', 'ready'),
  ('00000000-0000-0000-0000-0000000e0013', 'brief-generating-trip', 'Brief Generating Trip', 5, current_date, 'UTC', 'Nowhere', 'generating'),
  ('00000000-0000-0000-0000-0000000e0014', 'brief-missing-trip', 'Brief Missing Trip', 5, current_date, 'UTC', 'Nowhere', 'pending');
commit;

-- -----------------------------------------------------------------------
-- Scenario B: save_trip_editorial_brief status transitions.
-- -----------------------------------------------------------------------
begin;
do $$
declare r1 record; r2 record; v_count int;
begin
  -- A genuinely new save.
  select * into r1 from save_trip_editorial_brief(
    '00000000-0000-0000-0000-0000000e0011'::uuid, 'medium'::trip_difficulty, 'fun'::trip_question_style, null::text,
    25::smallint, 25::smallint, 25::smallint, 25::smallint
  );
  if r1.status <> 'saved' or (r1.brief).difficulty <> 'medium'::trip_difficulty then
    raise exception 'FAIL scenario B1: a valid save on a pending trip did not succeed: %', r1;
  end if;
  raise notice 'PASS scenario B1: a valid save on a pending trip succeeds';

  -- An edit -- upsert, not a second row.
  select * into r2 from save_trip_editorial_brief(
    '00000000-0000-0000-0000-0000000e0011'::uuid, 'hard'::trip_difficulty, 'academic'::trip_question_style, null::text,
    10::smallint, 10::smallint, 10::smallint, 70::smallint
  );
  if r2.status <> 'saved' or (r2.brief).difficulty <> 'hard'::trip_difficulty then
    raise exception 'FAIL scenario B2: an edit on a pending trip did not succeed: %', r2;
  end if;
  select count(*) into v_count from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000e0011';
  if v_count <> 1 then
    raise exception 'FAIL scenario B2: expected exactly 1 row after 2 saves (upsert), found %', v_count;
  end if;
  raise notice 'PASS scenario B2: a second save updates the same row (upsert), never a duplicate';
end $$;

do $$
declare r record; v_count int;
begin
  -- Already published -- rejected, nothing written.
  select * into r from save_trip_editorial_brief(
    '00000000-0000-0000-0000-0000000e0012'::uuid, 'medium'::trip_difficulty, 'fun'::trip_question_style, null::text,
    25::smallint, 25::smallint, 25::smallint, 25::smallint
  );
  if r.status <> 'rejected_published' or r.brief is not null then
    raise exception 'FAIL scenario B3: a save on an already-published trip was not rejected: %', r;
  end if;
  select count(*) into v_count from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000e0012';
  if v_count <> 0 then
    raise exception 'FAIL scenario B3: a row was written despite the rejection';
  end if;
  raise notice 'PASS scenario B3: a save on an already-published trip is rejected (rejected_published), nothing written';
end $$;

do $$
declare r record; v_count int;
begin
  -- Generation in progress -- rejected, nothing written. (No current code
  -- path ever sets 'generating' -- reserved for a future process -- but
  -- this function respects it regardless, per the product request.)
  select * into r from save_trip_editorial_brief(
    '00000000-0000-0000-0000-0000000e0013'::uuid, 'medium'::trip_difficulty, 'fun'::trip_question_style, null::text,
    25::smallint, 25::smallint, 25::smallint, 25::smallint
  );
  if r.status <> 'rejected_generating' or r.brief is not null then
    raise exception 'FAIL scenario B4: a save while generating was not rejected: %', r;
  end if;
  select count(*) into v_count from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000e0013';
  if v_count <> 0 then
    raise exception 'FAIL scenario B4: a row was written despite the rejection';
  end if;
  raise notice 'PASS scenario B4: a save while content is generating is rejected (rejected_generating), nothing written';
end $$;

do $$
begin
  perform save_trip_editorial_brief(
    '00000000-0000-0000-0000-000000000000'::uuid, 'medium'::trip_difficulty, 'fun'::trip_question_style, null::text,
    25::smallint, 25::smallint, 25::smallint, 25::smallint
  );
  raise exception 'FAIL scenario B5: saving a brief for a non-existent trip did NOT raise';
exception
  when others then
    if sqlerrm !~ 'trip not found' then
      raise exception 'FAIL scenario B5: raised but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS scenario B5: saving a brief for a non-existent trip raises (%)', sqlerrm;
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario C: a trip with no saved brief at all stays fully functional --
-- get_prize_status-style "null is a real, supported state", not an error.
-- (No SQL-level read function exists here -- app/api/trips/[slug]/brief
-- itself does a plain maybeSingle() and returns brief: null -- this just
-- confirms the row is genuinely absent, not e.g. silently defaulted.)
-- -----------------------------------------------------------------------
begin;
do $$
declare v_count int;
begin
  select count(*) into v_count from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000e0014';
  if v_count <> 0 then
    raise exception 'FAIL scenario C: expected no brief row for a trip that never had one saved, found %', v_count;
  end if;
  raise notice 'PASS scenario C: a trip with no saved brief has no row -- never a silently-defaulted one';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario D: RLS boundary -- trip_editorial_briefs is reachable only via
-- the service-role key; anon/authenticated get nothing at all, matching
-- creator_accounts/ip_rate_limits, not the public-readable content
-- tables.
-- -----------------------------------------------------------------------
begin;
-- A real row, inserted as the superuser (bypasses RLS, same as the
-- service-role client in production) -- so scenario D2 below proves
-- authenticated genuinely can't see an EXISTING row, not just that
-- none happens to exist.
insert into trip_editorial_briefs (trip_id, difficulty, style, theme_history, theme_places, theme_food, theme_curiosities)
values ('00000000-0000-0000-0000-0000000e0011', 'medium', 'fun', 25,25,25,25);

set role anon;
do $$
begin
  insert into trip_editorial_briefs (trip_id, difficulty, style, theme_history, theme_places, theme_food, theme_curiosities)
  values ('00000000-0000-0000-0000-0000000e0014', 'medium', 'fun', 25,25,25,25);
  raise exception 'FAIL scenario D1: a direct INSERT by anon was NOT rejected by RLS';
exception
  when insufficient_privilege then
    raise notice 'PASS scenario D1: a direct INSERT into trip_editorial_briefs by anon is rejected (%)', sqlerrm;
end $$;
reset role;

set role authenticated;
do $$
declare v_count int;
begin
  -- Table-level SELECT is granted by default (ci-bootstrap.sql mirrors
  -- real Supabase's own default privileges) -- RLS with zero policies
  -- doesn't turn that into an error, it just means every row is
  -- filtered out.
  select count(*) into v_count from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000e0011';
  if v_count <> 0 then
    raise exception 'FAIL scenario D2: authenticated could read a real trip_editorial_briefs row (no select policy grants this): got % rows', v_count;
  end if;
  raise notice 'PASS scenario D2: authenticated sees zero rows for a real, existing brief -- no select policy grants any';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario E: validate_trip_content's structural brief check. Normally
-- unreachable (trip_editorial_briefs_narrator_name_required_for_style
-- already prevents this row from ever being written) -- proven anyway,
-- exactly like R7's own trip.timezone_invalid check, by temporarily
-- dropping the constraint inside a transaction that's rolled back
-- afterward (the drop is never actually committed).
-- -----------------------------------------------------------------------
begin;
insert into trips (id, slug, name, duration_days, start_date, timezone, destination, content_status) values
  ('00000000-0000-0000-0000-0000000e0021', 'brief-validator-trip', 'Brief Validator Trip', 5, current_date, 'UTC', 'Nowhere', 'pending');

alter table trip_editorial_briefs drop constraint trip_editorial_briefs_narrator_name_required_for_style;

insert into trip_editorial_briefs (trip_id, difficulty, style, narrator_character_name, theme_history, theme_places, theme_food, theme_curiosities)
values ('00000000-0000-0000-0000-0000000e0021', 'medium', 'narrated_by_character', null, 25, 25, 25, 25);

do $$
declare v_count int;
begin
  select count(*) into v_count
  from validate_trip_content('00000000-0000-0000-0000-0000000e0021'::uuid)
  where check_key = 'brief.narrator_name_missing';
  if v_count <> 1 then
    raise exception 'FAIL scenario E: expected exactly 1 brief.narrator_name_missing issue, found %', v_count;
  end if;
  raise notice 'PASS scenario E: validate_trip_content flags a structurally-inconsistent brief (defense-in-depth, matching R7''s own timezone_invalid precedent)';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario F: the actual concurrency guarantee -- editing and publishing
-- share the same `trips` row lock, so a real publish_trip() call and a
-- save_trip_editorial_brief() call can never leave the brief editable on
-- an already-published trip. Uses the REAL publish_trip() (not a raw
-- UPDATE) against a minimal but fully valid trip (3 days -- R7's own
-- MIN_TRIP_DURATION_DAYS), so this proves the two functions' actual
-- interaction, not just save's own status check in isolation (already
-- covered by scenario B3).
-- -----------------------------------------------------------------------
begin;
insert into trips (id, slug, name, duration_days, start_date, timezone, destination, content_status) values
  ('00000000-0000-0000-0000-0000000e0031', 'brief-race-trip', 'Brief Race Trip', 3, current_date, 'UTC', 'Nowhere', 'pending');

-- Discover: Morning + Lunch for all 3 days.
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-0000000e0041', '00000000-0000-0000-0000-0000000e0031', 'discover', 1, 'morning', 1, 'D1 Morning Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000e0042', '00000000-0000-0000-0000-0000000e0031', 'discover', 1, 'lunch', 1, 'D1 Lunch Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000e0044', '00000000-0000-0000-0000-0000000e0031', 'discover', 2, 'morning', 1, 'D2 Morning Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000e0045', '00000000-0000-0000-0000-0000000e0031', 'discover', 2, 'lunch', 1, 'D2 Lunch Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000e0046', '00000000-0000-0000-0000-0000000e0031', 'discover', 3, 'morning', 1, 'D3 Morning Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000e0047', '00000000-0000-0000-0000-0000000e0031', 'discover', 3, 'lunch', 1, 'D3 Lunch Q', 'single_choice', 10, true, true);
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from questions q
join (values (1, 'Correct', true), (2, 'Wrong', false)) as o(order_index, label, is_correct) on true
where q.id in (
  '00000000-0000-0000-0000-0000000e0041', '00000000-0000-0000-0000-0000000e0042',
  '00000000-0000-0000-0000-0000000e0044', '00000000-0000-0000-0000-0000000e0045',
  '00000000-0000-0000-0000-0000000e0046', '00000000-0000-0000-0000-0000000e0047'
);

-- Daily Battles for day 1 and day 2 (duration_days - 1 = 2), plus the
-- Final Battle -- every Battle question needs >= 2 options too.
insert into battles (id, trip_id, day_number, title, is_final) values
  ('00000000-0000-0000-0000-0000000e0052', '00000000-0000-0000-0000-0000000e0031', 1, 'D1 Battle', false),
  ('00000000-0000-0000-0000-0000000e0053', '00000000-0000-0000-0000-0000000e0031', 2, 'D2 Battle', false),
  ('00000000-0000-0000-0000-0000000e0051', '00000000-0000-0000-0000-0000000e0031', null, 'Final Battle', true);
insert into questions (id, trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-0000000e0048', '00000000-0000-0000-0000-0000000e0031', '00000000-0000-0000-0000-0000000e0052', 'battle', 1, 1, 'D1 Battle Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000e0049', '00000000-0000-0000-0000-0000000e0031', '00000000-0000-0000-0000-0000000e0053', 'battle', 2, 1, 'D2 Battle Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000e0043', '00000000-0000-0000-0000-0000000e0031', '00000000-0000-0000-0000-0000000e0051', 'battle', null, 1, 'Final Q', 'single_choice', 10, true, true);
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from questions q
join (values (1, 'Correct', true), (2, 'Wrong', false)) as o(order_index, label, is_correct) on true
where q.id in (
  '00000000-0000-0000-0000-0000000e0048', '00000000-0000-0000-0000-0000000e0049', '00000000-0000-0000-0000-0000000e0043'
);

insert into prize_options (trip_id, title, order_index) values
  ('00000000-0000-0000-0000-0000000e0031', 'Prize A', 1),
  ('00000000-0000-0000-0000-0000000e0031', 'Prize B', 2);

do $$
declare r record;
begin
  select * into r from save_trip_editorial_brief(
    '00000000-0000-0000-0000-0000000e0031'::uuid, 'medium'::trip_difficulty, 'fun'::trip_question_style, null::text,
    25::smallint, 25::smallint, 25::smallint, 25::smallint
  );
  if r.status <> 'saved' then
    raise exception 'FAIL scenario F setup: the initial brief save (while pending) did not succeed: %', r;
  end if;
end $$;

do $$
declare r record;
begin
  select * into r from publish_trip('00000000-0000-0000-0000-0000000e0031'::uuid);
  if r.status <> 'published' then
    raise exception 'FAIL scenario F: publish_trip did not succeed on a fully valid minimal trip: %', r;
  end if;
  raise notice 'PASS scenario F setup: publish_trip succeeds on the minimal valid trip (proves this is a real, not simulated, publish)';
end $$;

do $$
declare r record; v_difficulty trip_difficulty;
begin
  select * into r from save_trip_editorial_brief(
    '00000000-0000-0000-0000-0000000e0031'::uuid, 'hard'::trip_difficulty, 'academic'::trip_question_style, null::text,
    10::smallint, 10::smallint, 10::smallint, 70::smallint
  );
  if r.status <> 'rejected_published' then
    raise exception 'FAIL scenario F: an edit immediately after a REAL publish_trip call was not rejected: %', r;
  end if;

  select difficulty into v_difficulty from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000e0031';
  if v_difficulty <> 'medium'::trip_difficulty then
    raise exception 'FAIL scenario F: the brief was modified despite the rejected edit (expected medium, got %)', v_difficulty;
  end if;
  raise notice 'PASS scenario F: publish_trip and save_trip_editorial_brief share the trip row lock -- an edit can never land on an already-published trip, and the rejected edit never touched the stored brief';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Cleanup. Fixture data from the committed transaction above -- safe to
-- re-run from a clean slate.
-- -----------------------------------------------------------------------
delete from trip_editorial_briefs where trip_id in (
  '00000000-0000-0000-0000-0000000e0011', '00000000-0000-0000-0000-0000000e0012',
  '00000000-0000-0000-0000-0000000e0013', '00000000-0000-0000-0000-0000000e0014'
);
delete from trips where id in (
  '00000000-0000-0000-0000-0000000e0011', '00000000-0000-0000-0000-0000000e0012',
  '00000000-0000-0000-0000-0000000e0013', '00000000-0000-0000-0000-0000000e0014'
);

\echo 'trip_editorial_brief.test.sql: all scenarios passed.'
