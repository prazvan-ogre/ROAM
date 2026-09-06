-- R7 regression: validate_trip_content()/publish_trip()
-- (20260908090000_r7_content_publishing_pipeline.sql) -- the content-
-- publishing pipeline's actual validation rules and the atomic,
-- idempotent publish gate built on top of them. Sibling test to
-- supabase/tests/record_answer.test.sql -- same setup requirements (stub
-- `auth` schema, `anon`/`authenticated` roles with baseline grants), see
-- supabase/tests/r1_auth_ownership_rls.test.sql's header for the exact
-- DDL and how to run this against a scratch database.
--
-- "Two concurrent publish attempts" is exercised the same way
-- record_answer.test.sql's own header explains for its own concurrency
-- scenario: Postgres's row lock (`select ... for update` inside
-- publish_trip) is what actually serializes a real race, so calling
-- publish_trip twice in a row, sequentially, in the SAME session
-- exercises the identical code path a true concurrent race would hit
-- (the second call always sees the first one's already-committed
-- result) -- there is no separate mechanism for the "concurrent" case.

\set ON_ERROR_STOP on

-- =======================================================================
-- Scenario A: a fully valid trip -- validate returns nothing, publish
-- succeeds, content_status flips to 'ready'; a repeat publish is a safe
-- no-op ('already_published'); a forced mid-transaction failure leaves
-- content_status untouched.
-- =======================================================================
begin;

insert into trips (id, slug, name, duration_days, start_date, destination, timezone) values
  ('00000000-0000-0000-0000-00000000c001', 'r7-valid-trip', 'R7 Valid Trip', 3, current_date, 'Testland', 'Europe/Bucharest');

insert into prize_options (trip_id, title, order_index) values
  ('00000000-0000-0000-0000-00000000c001', 'Prize A', 1),
  ('00000000-0000-0000-0000-00000000c001', 'Prize B', 2);

-- Day 1/2/3 Discover: Morning + Lunch, verified+published, 2 options, 1 correct.
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000c011', '00000000-0000-0000-0000-00000000c001', 'discover', 1, 'morning', 1, 'D1 AM', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-00000000c012', '00000000-0000-0000-0000-00000000c001', 'discover', 1, 'lunch', 1, 'D1 PM', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-00000000c013', '00000000-0000-0000-0000-00000000c001', 'discover', 2, 'morning', 1, 'D2 AM', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-00000000c014', '00000000-0000-0000-0000-00000000c001', 'discover', 2, 'lunch', 1, 'D2 PM', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-00000000c015', '00000000-0000-0000-0000-00000000c001', 'discover', 3, 'morning', 1, 'D3 AM', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-00000000c016', '00000000-0000-0000-0000-00000000c001', 'discover', 3, 'lunch', 1, 'D3 PM', 'single_choice', 10, true, true);

insert into answer_options (question_id, order_index, label, is_correct)
select q.id, 1, 'correct', true from questions q where q.trip_id = '00000000-0000-0000-0000-00000000c001' and q.kind = 'discover';
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, 2, 'wrong', false from questions q where q.trip_id = '00000000-0000-0000-0000-00000000c001' and q.kind = 'discover';

-- Daily Battles: day 1 and day 2 only (day 3 = duration_days, Final only).
insert into battles (id, trip_id, day_number, title, is_final, is_active) values
  ('00000000-0000-0000-0000-00000000c021', '00000000-0000-0000-0000-00000000c001', 1, 'Battle D1', false, true),
  ('00000000-0000-0000-0000-00000000c022', '00000000-0000-0000-0000-00000000c001', 2, 'Battle D2', false, true),
  ('00000000-0000-0000-0000-00000000c023', '00000000-0000-0000-0000-00000000c001', 3, 'Final Battle', true, true);

insert into questions (id, trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000c031', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c021', 'battle', 1, 1, 'B1 Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-00000000c032', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c022', 'battle', 2, 1, 'B2 Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-00000000c033', '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c023', 'battle', 3, 1, 'Final Q', 'single_choice', 10, true, true);

insert into answer_options (question_id, order_index, label, is_correct)
select q.id, 1, 'correct', true from questions q where q.id in (
  '00000000-0000-0000-0000-00000000c031', '00000000-0000-0000-0000-00000000c032', '00000000-0000-0000-0000-00000000c033'
);
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, 2, 'wrong', false from questions q where q.id in (
  '00000000-0000-0000-0000-00000000c031', '00000000-0000-0000-0000-00000000c032', '00000000-0000-0000-0000-00000000c033'
);

commit;

do $$
declare v_count int;
begin
  select count(*) into v_count from validate_trip_content('00000000-0000-0000-0000-00000000c001'::uuid);
  if v_count <> 0 then
    raise exception 'FAIL scenario A: expected a fully valid trip to have zero issues, got %', v_count;
  end if;
  raise notice 'PASS scenario A1: a fully valid trip has zero validation issues';
end $$;

do $$
declare r record;
begin
  select * into r from publish_trip('00000000-0000-0000-0000-00000000c001'::uuid);
  if r.status <> 'published' or r.error_count <> 0 then
    raise exception 'FAIL scenario A2: expected a clean publish, got %', r;
  end if;
  if (select content_status from trips where id = '00000000-0000-0000-0000-00000000c001') <> 'ready'::trip_content_status then
    raise exception 'FAIL scenario A2: content_status was not flipped to ready';
  end if;
  raise notice 'PASS scenario A2: a valid trip publishes and content_status becomes ready';
end $$;

-- A2/A3: repeated + "concurrent" publish (same code path -- see header).
do $$
declare r1 record; r2 record;
begin
  select * into r1 from publish_trip('00000000-0000-0000-0000-00000000c001'::uuid);
  select * into r2 from publish_trip('00000000-0000-0000-0000-00000000c001'::uuid);
  if r1.status <> 'already_published' or r2.status <> 'already_published' then
    raise exception 'FAIL scenario A3: expected two repeated/"concurrent" publishes to both resolve already_published, got % / %', r1, r2;
  end if;
  raise notice 'PASS scenario A3: repeated and "concurrent" publish calls both resolve idempotently (already_published), never a second write';
end $$;

-- A4: a forced failure mid-transaction (same fault-injection technique as
-- supabase/tests/record_answer.test.sql's own scenario 9) leaves
-- content_status exactly as it was before the call -- no partial state.
begin;
update trips set content_status = 'pending'::trip_content_status where id = '00000000-0000-0000-0000-00000000c001';
commit;

begin;
create or replace function r7_test_boom() returns trigger language plpgsql as $$
begin
  raise exception 'r7 simulated failure mid-publish';
end;
$$;
create trigger r7_trips_boom before update on trips
  for each row execute function r7_test_boom();
commit;

do $$
begin
  perform publish_trip('00000000-0000-0000-0000-00000000c001'::uuid);
  raise exception 'FAIL scenario A4: expected the trigger to raise, call succeeded';
exception
  when others then
    if sqlerrm <> 'r7 simulated failure mid-publish' then
      raise exception 'FAIL scenario A4: unexpected error: %', sqlerrm;
    end if;
end $$;

do $$
begin
  if (select content_status from trips where id = '00000000-0000-0000-0000-00000000c001') <> 'pending'::trip_content_status then
    raise exception 'FAIL scenario A4: content_status changed despite the forced failure';
  end if;
  raise notice 'PASS scenario A4: a forced failure mid-publish leaves content_status exactly as it was (no partial write)';
end $$;

begin;
drop trigger r7_trips_boom on trips;
drop function r7_test_boom();
update trips set content_status = 'pending'::trip_content_status where id = '00000000-0000-0000-0000-00000000c001';
commit;

-- A5: the authorization boundary itself -- neither function is callable
-- outside the service-role trust boundary this test session already runs
-- as (postgres superuser); `authenticated` (a stand-in for a real
-- participant/creator session, never an admin one at the database layer)
-- must be rejected outright, proving app/api/admin/trips/[slug]/* really
-- is the only path in.
begin;
set role authenticated;
do $$
begin
  perform validate_trip_content('00000000-0000-0000-0000-00000000c001'::uuid);
  raise exception 'FAIL scenario A5a: authenticated was able to call validate_trip_content directly';
exception
  when insufficient_privilege then
    raise notice 'PASS scenario A5a: validate_trip_content is rejected for authenticated (%)', sqlerrm;
end $$;
reset role;
rollback;

begin;
set role authenticated;
do $$
begin
  perform publish_trip('00000000-0000-0000-0000-00000000c001'::uuid);
  raise exception 'FAIL scenario A5b: authenticated was able to call publish_trip directly';
exception
  when insufficient_privilege then
    raise notice 'PASS scenario A5b: publish_trip is rejected for authenticated (%)', sqlerrm;
end $$;
reset role;
rollback;

-- A6: content_status_inconsistent -- a trip force-marked 'ready' outside
-- the publish gate (bypassing it entirely, as a raw UPDATE could) is
-- flagged, not silently trusted, the next time it's validated.
begin;
update trips set content_status = 'ready'::trip_content_status where id = '00000000-0000-0000-0000-00000000c001';
delete from questions where id = '00000000-0000-0000-0000-00000000c011'; -- break it: Day 1 Morning now missing
do $$
declare v_found boolean;
begin
  select exists (
    select 1 from validate_trip_content('00000000-0000-0000-0000-00000000c001'::uuid) where check_key = 'trip.content_status_inconsistent'
  ) into v_found;
  if not v_found then
    raise exception 'FAIL scenario A6: expected trip.content_status_inconsistent for a ready trip with real gaps';
  end if;
  raise notice 'PASS scenario A6: a trip marked ready with actual content gaps is flagged content_status_inconsistent';
end $$;
rollback;

-- =======================================================================
-- Scenario B: a sparse trip -- exercises discover.missing (a slot with NO
-- row at all) vs discover.not_published (a row that exists but isn't
-- verified+published) as genuinely distinct outcomes, plus
-- battle.daily_missing, battle.daily_empty, battle.final_missing, and
-- prize.not_configured all at once.
-- =======================================================================
begin;

insert into trips (id, slug, name, duration_days, start_date, destination, timezone) values
  ('00000000-0000-0000-0000-00000000c002', 'r7-gaps-trip', 'R7 Gaps Trip', 3, current_date, 'Testland', 'Europe/Bucharest');

-- Day 1 Morning: a row EXISTS but is not verified/published.
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000c111', '00000000-0000-0000-0000-00000000c002', 'discover', 1, 'morning', 1, 'D1 AM (draft)', 'single_choice', 10, false, false);
insert into answer_options (question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-00000000c111', 1, 'a', true), ('00000000-0000-0000-0000-00000000c111', 2, 'b', false);
-- Day 1 Lunch: no row at all.
-- Day 2 Morning/Lunch: no rows at all.
-- Day 3: nothing at all either (also contributes to discover.missing).

-- Day 1 daily Battle: exists, active, but has NO questions.
insert into battles (id, trip_id, day_number, title, is_final, is_active) values
  ('00000000-0000-0000-0000-00000000c121', '00000000-0000-0000-0000-00000000c002', 1, 'Empty Battle D1', false, true);
-- Day 2 daily Battle: missing entirely.
-- Final Battle: missing entirely.
-- No prize_options, no trip.prize.

commit;

do $$
declare v_keys text[];
begin
  select array_agg(check_key) into v_keys from validate_trip_content('00000000-0000-0000-0000-00000000c002'::uuid);

  if not ('discover.not_published' = any(v_keys)) then
    raise exception 'FAIL scenario B: expected discover.not_published for the draft Day 1 Morning question, got %', v_keys;
  end if;
  if (select count(*) from unnest(v_keys) k where k = 'discover.missing') < 5 then
    -- Day1 Lunch, Day2 AM, Day2 PM, Day3 AM, Day3 PM = 5 truly-missing slots.
    raise exception 'FAIL scenario B: expected at least 5 discover.missing issues, got %', v_keys;
  end if;
  if not ('battle.daily_empty' = any(v_keys)) then
    raise exception 'FAIL scenario B: expected battle.daily_empty for the questionless Day 1 Battle, got %', v_keys;
  end if;
  if not ('battle.daily_missing' = any(v_keys)) then
    raise exception 'FAIL scenario B: expected battle.daily_missing for Day 2, got %', v_keys;
  end if;
  if not ('battle.final_missing' = any(v_keys)) then
    raise exception 'FAIL scenario B: expected battle.final_missing, got %', v_keys;
  end if;
  if not ('prize.not_configured' = any(v_keys)) then
    raise exception 'FAIL scenario B: expected prize.not_configured, got %', v_keys;
  end if;
  raise notice 'PASS scenario B: discover.missing vs discover.not_published are genuinely distinct, plus daily/final Battle and prize gaps all detected';
end $$;

-- =======================================================================
-- Scenario C: single_choice correct-option-count violations (0 correct,
-- 2 correct) and an under-supplied option list.
-- =======================================================================
begin;

insert into trips (id, slug, name, duration_days, start_date, destination, timezone) values
  ('00000000-0000-0000-0000-00000000c003', 'r7-options-trip', 'R7 Options Trip', 3, current_date, 'Testland', 'Europe/Bucharest');

-- Zero correct options.
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000c211', '00000000-0000-0000-0000-00000000c003', 'discover', 1, 'morning', 1, 'No correct option', 'single_choice', 10, true, true);
insert into answer_options (question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-00000000c211', 1, 'a', false), ('00000000-0000-0000-0000-00000000c211', 2, 'b', false);

-- Two correct options (battle-kind, to also cover the battle.* variant).
insert into battles (id, trip_id, day_number, title, is_final, is_active) values
  ('00000000-0000-0000-0000-00000000c221', '00000000-0000-0000-0000-00000000c003', 1, 'Battle D1', false, true);
insert into questions (id, trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000c212', '00000000-0000-0000-0000-00000000c003', '00000000-0000-0000-0000-00000000c221', 'battle', 1, 1, 'Two correct options', 'single_choice', 10, true, true);
insert into answer_options (question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-00000000c212', 1, 'a', true), ('00000000-0000-0000-0000-00000000c212', 2, 'b', true);

-- Only 1 option supplied at all.
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000c213', '00000000-0000-0000-0000-00000000c003', 'discover', 1, 'lunch', 1, 'Only one option', 'single_choice', 10, true, true);
insert into answer_options (question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-00000000c213', 1, 'only', true);

commit;

do $$
declare v_keys text[];
begin
  select array_agg(check_key) into v_keys from validate_trip_content('00000000-0000-0000-0000-00000000c003'::uuid);
  if not ('discover.correct_option_count' = any(v_keys)) then
    raise exception 'FAIL scenario C: expected discover.correct_option_count (0 correct), got %', v_keys;
  end if;
  if not ('battle.correct_option_count' = any(v_keys)) then
    raise exception 'FAIL scenario C: expected battle.correct_option_count (2 correct), got %', v_keys;
  end if;
  if not ('discover.insufficient_options' = any(v_keys)) then
    raise exception 'FAIL scenario C: expected discover.insufficient_options (only 1 option), got %', v_keys;
  end if;
  raise notice 'PASS scenario C: zero/multiple correct options and too-few options are all detected';
end $$;

-- =======================================================================
-- Scenario D: cross-trip relational integrity -- a Battle question whose
-- battle belongs to a DIFFERENT trip, an Extra referencing another
-- trip's question, and explore_links referencing another trip's Extra
-- and question respectively.
-- =======================================================================
begin;

insert into trips (id, slug, name, duration_days, start_date, destination, timezone) values
  ('00000000-0000-0000-0000-00000000c004', 'r7-crosstrip-a', 'R7 Cross-trip A', 3, current_date, 'Testland', 'Europe/Bucharest'),
  ('00000000-0000-0000-0000-00000000c005', 'r7-crosstrip-b', 'R7 Cross-trip B', 3, current_date, 'Testland', 'Europe/Bucharest');

-- Trip A's own battle and question, referenced incorrectly FROM trip B below.
insert into battles (id, trip_id, day_number, title, is_final, is_active) values
  ('00000000-0000-0000-0000-00000000c311', '00000000-0000-0000-0000-00000000c004', 1, 'A Battle', false, true);
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000c312', '00000000-0000-0000-0000-00000000c004', 'discover', 1, 'morning', 1, 'A Question', 'single_choice', 10, true, true);
insert into answer_options (question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-00000000c312', 1, 'a', true), ('00000000-0000-0000-0000-00000000c312', 2, 'b', false);
insert into extras (id, trip_id, day_number, title, order_index, extra_type, audience, verified, published) values
  ('00000000-0000-0000-0000-00000000c313', '00000000-0000-0000-0000-00000000c004', 1, 'A Extra', 1, 'know', 'all', true, true);

-- Trip B: a battle question wired to trip A's battle (mismatch), an Extra
-- wired to trip A's question (mismatch), and two explore_links wired to
-- trip A's extra/question respectively (both mismatches).
insert into questions (id, trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000c321', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c311', 'battle', 1, 1, 'B Question in A''s Battle', 'single_choice', 10, true, true);
insert into answer_options (question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-00000000c321', 1, 'a', true), ('00000000-0000-0000-0000-00000000c321', 2, 'b', false);
insert into extras (id, trip_id, question_id, day_number, title, order_index, extra_type, audience, verified, published) values
  ('00000000-0000-0000-0000-00000000c322', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c312', 1, 'B Extra on A''s Question', 1, 'know', 'all', true, true);
insert into explore_links (id, trip_id, extra_id, title, url, order_index) values
  ('00000000-0000-0000-0000-00000000c323', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c313', 'Link to A''s Extra', 'https://example.com', 1);
insert into explore_links (id, trip_id, question_id, title, url, order_index) values
  ('00000000-0000-0000-0000-00000000c324', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c312', 'Link to A''s Question', 'https://example.com', 2);

commit;

do $$
declare v_keys text[];
begin
  select array_agg(check_key) into v_keys from validate_trip_content('00000000-0000-0000-0000-00000000c005'::uuid);
  if not ('battle.question_trip_mismatch' = any(v_keys)) then
    raise exception 'FAIL scenario D: expected battle.question_trip_mismatch, got %', v_keys;
  end if;
  if not ('extra.trip_mismatch' = any(v_keys)) then
    raise exception 'FAIL scenario D: expected extra.trip_mismatch, got %', v_keys;
  end if;
  if (select count(*) from unnest(v_keys) k where k = 'link.trip_mismatch') < 2 then
    raise exception 'FAIL scenario D: expected 2 link.trip_mismatch issues (extra_id and question_id variants), got %', v_keys;
  end if;
  raise notice 'PASS scenario D: cross-trip references (Battle question / Extra / both explore_link variants) are all caught, mirroring R1 batch 2''s read-side content isolation on the write/validation side';
end $$;

-- =======================================================================
-- Scenario E: published-without-verification, a published Extra missing
-- its type, and an invalid explore_link URL.
-- =======================================================================
begin;

insert into trips (id, slug, name, duration_days, start_date, destination, timezone) values
  ('00000000-0000-0000-0000-00000000c006', 'r7-verify-trip', 'R7 Verify Trip', 3, current_date, 'Testland', 'Europe/Bucharest');

insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000c411', '00000000-0000-0000-0000-00000000c006', 'discover', 1, 'morning', 1, 'Published but not verified', 'single_choice', 10, false, true);
insert into answer_options (question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-00000000c411', 1, 'a', true), ('00000000-0000-0000-0000-00000000c411', 2, 'b', false);

insert into extras (id, trip_id, day_number, title, order_index, extra_type, audience, verified, published) values
  ('00000000-0000-0000-0000-00000000c412', '00000000-0000-0000-0000-00000000c006', 1, 'Published no type', 1, null, 'all', true, true);

insert into explore_links (id, trip_id, title, url, order_index) values
  ('00000000-0000-0000-0000-00000000c413', '00000000-0000-0000-0000-00000000c006', 'Bad link', 'not-a-url', 1);

commit;

do $$
declare v_keys text[];
begin
  select array_agg(check_key) into v_keys from validate_trip_content('00000000-0000-0000-0000-00000000c006'::uuid);
  if not ('discover.published_without_verification' = any(v_keys)) then
    raise exception 'FAIL scenario E: expected discover.published_without_verification, got %', v_keys;
  end if;
  if not ('extra.type_missing' = any(v_keys)) then
    raise exception 'FAIL scenario E: expected extra.type_missing, got %', v_keys;
  end if;
  if not ('link.invalid_url' = any(v_keys)) then
    raise exception 'FAIL scenario E: expected link.invalid_url, got %', v_keys;
  end if;
  raise notice 'PASS scenario E: published-without-verified, a typeless published Extra, and a non-http(s) link are all caught';
end $$;

-- =======================================================================
-- Scenario F: the prize "documented fixed prize instead of a vote"
-- escape hatch -- trips.prize set, zero prize_options, no issue raised.
-- =======================================================================
begin;

insert into trips (id, slug, name, duration_days, start_date, destination, timezone, prize) values
  ('00000000-0000-0000-0000-00000000c007', 'r7-fixed-prize-trip', 'R7 Fixed Prize Trip', 3, current_date, 'Testland', 'Europe/Bucharest', 'Un weekend la munte, decis dinainte -- fără vot.');

commit;

do $$
declare v_found boolean;
begin
  select exists (
    select 1 from validate_trip_content('00000000-0000-0000-0000-00000000c007'::uuid) where check_key = 'prize.not_configured'
  ) into v_found;
  if v_found then
    raise exception 'FAIL scenario F: a trip with a documented fixed trips.prize still raised prize.not_configured';
  end if;
  raise notice 'PASS scenario F: a documented fixed prize (trips.prize set) satisfies the prize check without any prize_options';
end $$;

-- =======================================================================
-- Scenario G: non-deterministic Battle question order (duplicate
-- order_index within the same Battle).
-- =======================================================================
begin;

insert into trips (id, slug, name, duration_days, start_date, destination, timezone) values
  ('00000000-0000-0000-0000-00000000c008', 'r7-order-trip', 'R7 Order Trip', 3, current_date, 'Testland', 'Europe/Bucharest');
insert into battles (id, trip_id, day_number, title, is_final, is_active) values
  ('00000000-0000-0000-0000-00000000c511', '00000000-0000-0000-0000-00000000c008', 1, 'Battle D1', false, true);
insert into questions (id, trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000c512', '00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-00000000c511', 'battle', 1, 1, 'Q1', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-00000000c513', '00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-00000000c511', 'battle', 1, 1, 'Q2 (same order_index)', 'single_choice', 10, true, true);
insert into answer_options (question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-00000000c512', 1, 'a', true), ('00000000-0000-0000-0000-00000000c512', 2, 'b', false),
  ('00000000-0000-0000-0000-00000000c513', 1, 'a', true), ('00000000-0000-0000-0000-00000000c513', 2, 'b', false);
commit;

do $$
declare v_found boolean;
begin
  select exists (
    select 1 from validate_trip_content('00000000-0000-0000-0000-00000000c008'::uuid) where check_key = 'battle.duplicate_order_index'
  ) into v_found;
  if not v_found then
    raise exception 'FAIL scenario G: expected battle.duplicate_order_index for two questions sharing order_index';
  end if;
  raise notice 'PASS scenario G: two Battle questions sharing an order_index (non-deterministic play order) is caught';
end $$;

-- =======================================================================
-- Scenario H: ambiguous Battle state -- two active daily Battles for the
-- same day, and two active Final Battles for the same trip.
-- =======================================================================
begin;

insert into trips (id, slug, name, duration_days, start_date, destination, timezone) values
  ('00000000-0000-0000-0000-00000000c009', 'r7-ambiguous-trip', 'R7 Ambiguous Trip', 3, current_date, 'Testland', 'Europe/Bucharest');
insert into battles (id, trip_id, day_number, title, is_final, is_active) values
  ('00000000-0000-0000-0000-00000000c611', '00000000-0000-0000-0000-00000000c009', 1, 'Battle D1 (a)', false, true),
  ('00000000-0000-0000-0000-00000000c612', '00000000-0000-0000-0000-00000000c009', 1, 'Battle D1 (b)', false, true),
  ('00000000-0000-0000-0000-00000000c613', '00000000-0000-0000-0000-00000000c009', null, 'Final (a)', true, true),
  ('00000000-0000-0000-0000-00000000c614', '00000000-0000-0000-0000-00000000c009', null, 'Final (b)', true, true);
commit;

do $$
declare v_keys text[];
begin
  select array_agg(check_key) into v_keys from validate_trip_content('00000000-0000-0000-0000-00000000c009'::uuid);
  if not ('battle.multiple_active_for_day' = any(v_keys)) then
    raise exception 'FAIL scenario H: expected battle.multiple_active_for_day, got %', v_keys;
  end if;
  if not ('battle.multiple_final' = any(v_keys)) then
    raise exception 'FAIL scenario H: expected battle.multiple_final, got %', v_keys;
  end if;
  raise notice 'PASS scenario H: two active daily Battles on the same day, and two active Final Battles, are both flagged as ambiguous';
end $$;

-- =======================================================================
-- Scenario J: trip.timezone_invalid -- the CHECK constraint added in R6
-- (trips_timezone_valid_iana) already makes this unreachable through a
-- normal insert, so it's exercised here by temporarily dropping that
-- constraint (both the drop and the insert live inside one rolled-back
-- transaction -- DDL is transactional in Postgres, so neither survives
-- the rollback). This proves validate_trip_content's OWN check is a real,
-- working second line of defense, not dead code that merely happens to
-- never run.
-- =======================================================================
begin;
alter table trips drop constraint trips_timezone_valid_iana;
insert into trips (id, slug, name, duration_days, start_date, destination, timezone) values
  ('00000000-0000-0000-0000-00000000c00a', 'r7-badtz-trip', 'R7 Bad TZ Trip', 3, current_date, 'Testland', 'Not/A_Real_Zone');

do $$
declare v_found boolean;
begin
  select exists (
    select 1 from validate_trip_content('00000000-0000-0000-0000-00000000c00a'::uuid) where check_key = 'trip.timezone_invalid'
  ) into v_found;
  if not v_found then
    raise exception 'FAIL scenario J: expected trip.timezone_invalid for a non-IANA timezone string';
  end if;
  raise notice 'PASS scenario J: validate_trip_content itself rejects a non-IANA timezone, independent of the CHECK constraint that normally prevents storing one at all';
end $$;
rollback;

-- =======================================================================
-- Scenario K: trip.not_found -- a nonexistent trip id resolves to a
-- single clean issue, not a database error a caller has to guard against.
-- =======================================================================
do $$
declare v_result record;
  v_count int;
begin
  select count(*) into v_count from validate_trip_content('00000000-0000-0000-0000-000000000000'::uuid);
  if v_count <> 1 then
    raise exception 'FAIL scenario K: expected exactly 1 issue (trip.not_found) for a nonexistent trip, got %', v_count;
  end if;
  select * into v_result from validate_trip_content('00000000-0000-0000-0000-000000000000'::uuid) limit 1;
  if v_result.check_key <> 'trip.not_found' then
    raise exception 'FAIL scenario K: expected check_key trip.not_found, got %', v_result.check_key;
  end if;
  raise notice 'PASS scenario K: a nonexistent trip id resolves to a clean trip.not_found issue, not an error';
end $$;

do $$
begin
  perform publish_trip('00000000-0000-0000-0000-000000000000'::uuid);
  raise exception 'FAIL scenario K: expected publish_trip to raise for a nonexistent trip';
exception
  when others then
    if sqlerrm <> 'trip not found' then
      raise exception 'FAIL scenario K: rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS scenario K: publish_trip raises a clean exception for a nonexistent trip';
end $$;

-- -----------------------------------------------------------------------
-- Cleanup. Fixture data from the committed transactions above -- safe to
-- re-run from a clean slate.
-- -----------------------------------------------------------------------
delete from explore_links where trip_id in (
  '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c003',
  '00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c006',
  '00000000-0000-0000-0000-00000000c007', '00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-00000000c009'
);
delete from extras where trip_id in (
  '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c003',
  '00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c006',
  '00000000-0000-0000-0000-00000000c007', '00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-00000000c009'
);
delete from answer_options where question_id in (
  select id from questions where trip_id in (
    '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c003',
    '00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c006',
    '00000000-0000-0000-0000-00000000c007', '00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-00000000c009'
  )
);
delete from questions where trip_id in (
  '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c003',
  '00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c006',
  '00000000-0000-0000-0000-00000000c007', '00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-00000000c009'
);
delete from battles where trip_id in (
  '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c003',
  '00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c006',
  '00000000-0000-0000-0000-00000000c007', '00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-00000000c009'
);
delete from prize_options where trip_id in (
  '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c003',
  '00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c006',
  '00000000-0000-0000-0000-00000000c007', '00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-00000000c009'
);
delete from trips where id in (
  '00000000-0000-0000-0000-00000000c001', '00000000-0000-0000-0000-00000000c002', '00000000-0000-0000-0000-00000000c003',
  '00000000-0000-0000-0000-00000000c004', '00000000-0000-0000-0000-00000000c005', '00000000-0000-0000-0000-00000000c006',
  '00000000-0000-0000-0000-00000000c007', '00000000-0000-0000-0000-00000000c008', '00000000-0000-0000-0000-00000000c009'
);

\echo 'r7_content_publishing.test.sql: all scenarios passed.'
