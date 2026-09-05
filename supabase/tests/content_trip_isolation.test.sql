-- Regression test for the 2026-09-05 architecture/security review's batch 2
-- follow-up: verifies the new trip_id-scoped SELECT policies on
-- questions/answer_options/extras/explore_links
-- (20260906130000_content_trip_isolation.sql) actually enforce
-- per-trip isolation when queried as anon/authenticated Postgres roles --
-- i.e. testing the database itself, not any Next.js route. Sibling test
-- to supabase/tests/r1_auth_ownership_rls.test.sql -- same setup
-- requirements (stub `auth` schema, `anon`/`authenticated` roles with
-- baseline grants), see that file's header for the exact DDL and how to
-- run this against a scratch database.

\set ON_ERROR_STOP on

-- =======================================================================
-- Fixture: trip AB (Family A, a real authenticated member) and trip C (a
-- wholly separate trip, Family C) each get their own verified+published
-- Discover question with an answer option and an Extra with an
-- explore_link -- the exact shape a raw REST call against
-- questions/answer_options/extras/explore_links would try to read across
-- trips. Trip D has only a legacy (pre-R1, auth_user_id null)
-- participant -- the known, accepted gap this migration's header
-- documents: once nobody on a trip has a real auth session, nobody,
-- including that trip's own former participants, can read its content
-- via the anon key anymore.
-- =======================================================================
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000050a1'), -- Family A's session (trip AB member)
  ('00000000-0000-0000-0000-0000000050c1'); -- Family C's session (trip C member)

insert into trips (id, slug, name, duration_days) values
  ('00000000-0000-0000-0000-000000000501', 'ci-trip-ab', 'CI Trip AB', 5),
  ('00000000-0000-0000-0000-000000000502', 'ci-trip-c', 'CI Trip C', 5),
  ('00000000-0000-0000-0000-000000000503', 'ci-trip-legacy', 'CI Trip Legacy', 5);

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000501', 'dev-a', 'Family A Adult', 'adult', '00000000-0000-0000-0000-0000000050a1'),
  ('00000000-0000-0000-0000-000000000521', '00000000-0000-0000-0000-000000000502', 'dev-c', 'Family C Adult', 'adult', '00000000-0000-0000-0000-0000000050c1'),
  ('00000000-0000-0000-0000-000000000531', '00000000-0000-0000-0000-000000000503', 'dev-legacy', 'Legacy Participant', 'adult', null);

-- Trip AB's content: a verified+published question, its answer option, an
-- Extra tied to it, and an explore_link tied to that Extra.
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000000551', '00000000-0000-0000-0000-000000000501', 'discover', 1, 'morning', 1, 'AB question', 'single_choice', 10, true, true);
insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000551', 1, 'AB option', true);
insert into extras (id, trip_id, question_id, day_number, title, verified, published) values
  ('00000000-0000-0000-0000-000000000571', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000551', 1, 'AB extra', true, true);
insert into explore_links (id, trip_id, extra_id, question_id, title, url) values
  ('00000000-0000-0000-0000-000000000581', '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000571', '00000000-0000-0000-0000-000000000551', 'AB link', 'https://example.com/ab');

-- An unverified sibling question on the SAME trip AB, to confirm the
-- verified/published gate still applies on top of trip membership (not
-- replaced by it).
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000000552', '00000000-0000-0000-0000-000000000501', 'discover', 1, 'lunch', 2, 'AB draft question', 'single_choice', 10, false, false);

-- Trip C's content: same shape, wholly separate trip.
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000000553', '00000000-0000-0000-0000-000000000502', 'discover', 1, 'morning', 1, 'C question', 'single_choice', 10, true, true);
insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-000000000562', '00000000-0000-0000-0000-000000000553', 1, 'C option', true);
insert into extras (id, trip_id, question_id, day_number, title, verified, published) values
  ('00000000-0000-0000-0000-000000000572', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000553', 1, 'C extra', true, true);
insert into explore_links (id, trip_id, extra_id, question_id, title, url) values
  ('00000000-0000-0000-0000-000000000582', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000572', '00000000-0000-0000-0000-000000000553', 'C link', 'https://example.com/c');

-- Trip Legacy's content: verified+published, but the trip has no
-- authenticated member at all.
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000000554', '00000000-0000-0000-0000-000000000503', 'discover', 1, 'morning', 1, 'Legacy question', 'single_choice', 10, true, true);

commit;

-- -----------------------------------------------------------------------
-- Scenario 1: Family A reads trip AB's own content. Expected: sees the
-- verified+published question/option/extra/explore_link, but not the
-- unverified sibling question on the same trip.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050a1';
do $$
declare q_count bigint;
declare draft_q_count bigint;
declare opt_count bigint;
declare extra_count bigint;
declare link_count bigint;
begin
  select count(*) into q_count from questions where id = '00000000-0000-0000-0000-000000000551';
  select count(*) into draft_q_count from questions where id = '00000000-0000-0000-0000-000000000552';
  select count(*) into opt_count from answer_options where id = '00000000-0000-0000-0000-000000000561';
  select count(*) into extra_count from extras where id = '00000000-0000-0000-0000-000000000571';
  select count(*) into link_count from explore_links where id = '00000000-0000-0000-0000-000000000581';

  raise notice 'SCENARIO 1 (Family A, own trip): question=%, draft question=%, option=%, extra=%, link=%',
    q_count, draft_q_count, opt_count, extra_count, link_count;

  if q_count = 1 and draft_q_count = 0 and opt_count = 1 and extra_count = 1 and link_count = 1 then
    raise notice 'SCENARIO 1 PASS: Family A sees its own trip''s published content, not its own trip''s draft content.';
  else
    raise exception 'SCENARIO 1 FAIL: expected question=1, draft=0, option=1, extra=1, link=1; got %,%,%,%,%',
      q_count, draft_q_count, opt_count, extra_count, link_count;
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 2 (the actual fix): Family C reads trip AB's content.
-- Expected: sees NONE of it -- this is the cross-trip leak that existed
-- before this migration.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000050c1';
do $$
declare q_count bigint;
declare opt_count bigint;
declare extra_count bigint;
declare link_count bigint;
begin
  select count(*) into q_count from questions where id = '00000000-0000-0000-0000-000000000551';
  select count(*) into opt_count from answer_options where id = '00000000-0000-0000-0000-000000000561';
  select count(*) into extra_count from extras where id = '00000000-0000-0000-0000-000000000571';
  select count(*) into link_count from explore_links where id = '00000000-0000-0000-0000-000000000581';

  raise notice 'SCENARIO 2 (Family C, different trip): question=%, option=%, extra=%, link=%',
    q_count, opt_count, extra_count, link_count;

  if q_count = 0 and opt_count = 0 and extra_count = 0 and link_count = 0 then
    raise notice 'SCENARIO 2 PASS: Family C (a different trip''s member) cannot read trip AB''s published content -- the cross-trip gap is closed.';
  else
    raise exception 'SCENARIO 2 FAIL: Family C could still read trip AB''s content: question=%, option=%, extra=%, link=%',
      q_count, opt_count, extra_count, link_count;
  end if;
end $$;
-- Family C still reads its own trip's content normally.
do $$
declare q_count bigint;
begin
  select count(*) into q_count from questions where id = '00000000-0000-0000-0000-000000000553';
  if q_count = 1 then
    raise notice 'SCENARIO 2b PASS: Family C still reads its own trip''s published content.';
  else
    raise exception 'SCENARIO 2b FAIL: Family C could not read its own trip''s content.';
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 3: no session at all (anon role, no JWT claim). Expected: no
-- content readable on ANY trip -- this is the direct consequence of the
-- fix, not a separate bug: is_trip_member(trip_id) is false with no
-- auth.uid() at all, for every trip.
-- -----------------------------------------------------------------------
begin;
set role anon;
do $$
declare ab_count bigint;
declare c_count bigint;
begin
  select count(*) into ab_count from questions where id = '00000000-0000-0000-0000-000000000551';
  select count(*) into c_count from questions where id = '00000000-0000-0000-0000-000000000553';
  raise notice 'SCENARIO 3 (no session): trip AB question=%, trip C question=%', ab_count, c_count;
  if ab_count = 0 and c_count = 0 then
    raise notice 'SCENARIO 3 PASS: an unauthenticated request reads no trip''s content -- matches every content-reading call site, which only fetches after a participant (and its auth session) already exists.';
  else
    raise exception 'SCENARIO 3 FAIL: an unauthenticated request could read content: trip AB=%, trip C=%', ab_count, c_count;
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 4 (documents the accepted gap): a trip whose only participant
-- is legacy (auth_user_id is null, e.g. Kassandra for anyone who never
-- re-joined after the R1 deploy). Expected: nobody, not even that
-- participant's own device (which never has an auth session to present),
-- can read that trip's content anymore -- the known, accepted regression
-- called out in docs/DATABASE.md "Security model" point 11.
-- -----------------------------------------------------------------------
begin;
set role anon;
do $$
declare legacy_count bigint;
begin
  select count(*) into legacy_count from questions where id = '00000000-0000-0000-0000-000000000554';
  raise notice 'SCENARIO 4 (legacy-only trip, no session): visible questions=%', legacy_count;
  if legacy_count = 0 then
    raise notice 'SCENARIO 4 PASS (documents the accepted gap): a trip with only legacy participants has no readable content via the anon key, matching docs/DATABASE.md point 11.';
  else
    raise exception 'SCENARIO 4 FAIL: expected the legacy-only trip''s content to be unreadable; got %', legacy_count;
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 5: forged identity (random UUID matching no real participant).
-- Expected: behaves like no session at all -- sees nothing.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
do $$
declare ab_count bigint;
begin
  select count(*) into ab_count from questions where id = '00000000-0000-0000-0000-000000000551';
  if ab_count = 0 then
    raise notice 'SCENARIO 5 PASS: a forged/unrecognized identity reads no trip''s content, identical to having no session at all.';
  else
    raise exception 'SCENARIO 5 FAIL: a forged identity could read trip AB''s content.';
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Cleanup. Fixture data was inserted in its own committed transaction, so
-- remove it now as a superuser -- safe to re-run from a clean slate.
-- -----------------------------------------------------------------------
delete from explore_links where id in ('00000000-0000-0000-0000-000000000581', '00000000-0000-0000-0000-000000000582');
delete from extras where id in ('00000000-0000-0000-0000-000000000571', '00000000-0000-0000-0000-000000000572');
delete from answer_options where id in ('00000000-0000-0000-0000-000000000561', '00000000-0000-0000-0000-000000000562');
delete from questions where id in (
  '00000000-0000-0000-0000-000000000551', '00000000-0000-0000-0000-000000000552',
  '00000000-0000-0000-0000-000000000553', '00000000-0000-0000-0000-000000000554'
);
delete from participants where trip_id in (
  '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000503'
);
delete from trips where id in (
  '00000000-0000-0000-0000-000000000501', '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000503'
);
delete from auth.users where id in ('00000000-0000-0000-0000-0000000050a1', '00000000-0000-0000-0000-0000000050c1');

\echo 'content_trip_isolation.test.sql: all scenarios passed.'
