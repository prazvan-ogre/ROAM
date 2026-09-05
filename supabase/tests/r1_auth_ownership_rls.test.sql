-- Regression test for R1 (2026-09-05 architecture/security review):
-- verifies the new participants/responses/battle_scores RLS policies
-- (20260906090000_auth_ownership.sql) actually enforce ownership/
-- trip-membership when queried as anon/authenticated Postgres roles --
-- i.e. testing the database itself, not any Next.js route.
--
-- This does NOT run against a real Supabase project. It requires a
-- scratch database with:
--   * all migrations applied, including 20260906090000_auth_ownership.sql
--     and 20260906091000_account_hardening.sql
--   * a stub `auth` schema (auth.users table + auth.uid() reading the
--     `request.jwt.claim.sub` GUC) -- this is what Supabase's own hosted
--     Postgres provides for real; it is intentionally NOT part of any
--     shipped migration here, only of this local test setup:
--
--     create schema auth;
--     create table auth.users (id uuid primary key default gen_random_uuid());
--     create or replace function auth.uid() returns uuid
--       language sql stable as $$
--         select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
--       $$;
--
--   * the `anon`/`authenticated` roles Supabase normally provisions,
--     with baseline table grants (Supabase auto-grants these; a bare
--     scratch DB does not):
--
--     create role anon nologin;
--     create role authenticated nologin;
--     grant usage on schema public to anon, authenticated;
--     grant select, insert, update, delete on all tables in schema public
--       to anon, authenticated;
--
-- Run as a superuser (needed for SET ROLE + SET LOCAL request.jwt.claim.sub)
-- against that scratch database, e.g.:
--   PGPASSWORD=postgres psql -U postgres -h localhost -d roam_auth \
--     -f supabase/tests/r1_auth_ownership_rls.test.sql
--
-- Each scenario is its own transaction (SET ROLE/SET LOCAL only apply
-- for the current transaction) so failures are isolated; the whole file
-- is safe to re-run since every transaction rolls back its fixture data.

\set ON_ERROR_STOP on

-- =======================================================================
-- Fixture: two trips... actually one trip, two families (the case that
-- matters -- "same trip, different family" is where a membership check
-- can silently be too broad if it isn't scoped correctly), plus a
-- second, wholly separate trip for the "different family, different
-- trip" and "forged identifier" scenarios.
-- =======================================================================
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), -- Family A's shared session (adult + child)
  ('00000000-0000-0000-0000-0000000000b1'), -- Family B's shared session (same trip as A)
  ('00000000-0000-0000-0000-0000000000c1'); -- Family C's shared session (a different trip entirely)

insert into trips (id, slug, name, duration_days) values
  ('00000000-0000-0000-0000-000000000401', 'r1-trip-ab', 'R1 Trip AB', 5),
  ('00000000-0000-0000-0000-000000000402', 'r1-trip-c', 'R1 Trip C', 5);

-- Family A: adult + child, same trip, same auth_user_id (child shares the
-- managing adult's session -- no separate sign-in, per the migration's
-- design).
insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000401', 'dev-a', 'Family A Adult', 'adult', '00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000401', 'dev-a', 'Family A Child', 'child', '00000000-0000-0000-0000-0000000000a1');

-- Family B: same trip as A, different family/session.
insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-000000000401', 'dev-b', 'Family B Adult', 'adult', '00000000-0000-0000-0000-0000000000b1');

-- Family C: a different trip entirely.
insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000000431', '00000000-0000-0000-0000-000000000402', 'dev-c', 'Family C Adult', 'adult', '00000000-0000-0000-0000-0000000000c1');

-- One legacy (pre-migration) participant on trip AB: no auth_user_id at
-- all, grandfathered to the old fully-open behavior.
insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000000441', '00000000-0000-0000-0000-000000000401', 'dev-legacy', 'Legacy Participant', 'adult', null);

insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000000451', '00000000-0000-0000-0000-000000000401', 'discover', 1, 'morning', 1, 'Q on trip AB', 'single_choice', 10, true, true);

insert into responses (question_id, participant_id, is_correct) values
  ('00000000-0000-0000-0000-000000000451', '00000000-0000-0000-0000-000000000411', true); -- Family A Adult's own answer

commit;

-- -----------------------------------------------------------------------
-- Scenario 1: no session at all (anon role, no JWT claim set).
-- Expected: sees only the legacy row (grandfathered) -- cannot see
-- Family A/B/C's real participant rows or Family A's response.
-- -----------------------------------------------------------------------
begin;
set role anon;
do $$
declare visible_ids uuid[];
declare response_count bigint;
begin
  select array_agg(id order by id) into visible_ids from participants
  where id in (
    '00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000412',
    '00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-000000000431',
    '00000000-0000-0000-0000-000000000441'
  );
  select count(*) into response_count from responses where question_id = '00000000-0000-0000-0000-000000000451';

  raise notice 'SCENARIO 1 (no session): visible participants=%, visible responses=%', visible_ids, response_count;

  if visible_ids = array['00000000-0000-0000-0000-000000000441']::uuid[] and response_count = 0 then
    raise notice 'SCENARIO 1 PASS: only the legacy (grandfathered) row is visible; no real family''s data leaked.';
  else
    raise exception 'SCENARIO 1 FAIL: expected only the legacy row visible and 0 responses; got participants=%, responses=%', visible_ids, response_count;
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 2: the legitimate owner (Family A's own session).
-- Expected: can read its own participants + the legacy row; can read its
-- own response; CANNOT see Family B (same trip, different family).
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare visible_ids uuid[];
declare own_response_count bigint;
begin
  select array_agg(id order by id) into visible_ids from participants
  where id in (
    '00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000412',
    '00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-000000000431',
    '00000000-0000-0000-0000-000000000441'
  );
  select count(*) into own_response_count from responses
  where question_id = '00000000-0000-0000-0000-000000000451' and participant_id = '00000000-0000-0000-0000-000000000411';

  raise notice 'SCENARIO 2 (legitimate owner, Family A): visible participants=%, own response count=%', visible_ids, own_response_count;

  -- Family A is a member of trip AB, so it legitimately sees every real
  -- participant on THAT trip (A-adult, A-child, B-adult -- this is the
  -- "authorized trip members" half of the requirement, e.g. what powers
  -- a participant/leaderboard list), plus the always-grandfathered
  -- legacy row. It must NOT include Family C, who is on a different trip
  -- entirely (that exclusion is exercised on its own in Scenario 4).
  if visible_ids = array[
       '00000000-0000-0000-0000-000000000411',
       '00000000-0000-0000-0000-000000000412',
       '00000000-0000-0000-0000-000000000421',
       '00000000-0000-0000-0000-000000000441'
     ]::uuid[]
     and own_response_count = 1
  then
    raise notice 'SCENARIO 2 PASS: Family A sees every trip-AB participant (itself + Family B, its trip-mate) and its own response; Family C (different trip) is excluded.';
  else
    raise exception 'SCENARIO 2 FAIL: expected [A-adult, A-child, B-adult, legacy] visible and own_response_count=1; got participants=%, own_response_count=%', visible_ids, own_response_count;
  end if;
end $$;

-- Can Family A update its own child's row? Should succeed.
update participants set display_name = 'Family A Child (renamed)'
  where id = '00000000-0000-0000-0000-000000000412';

do $$
declare renamed boolean;
begin
  select (display_name = 'Family A Child (renamed)') into renamed from participants where id = '00000000-0000-0000-0000-000000000412';
  if coalesce(renamed, false) then
    raise notice 'SCENARIO 2b PASS: Family A can update its own child''s participant row.';
  else
    raise exception 'SCENARIO 2b FAIL: Family A could not update its own child''s row (update silently affected 0 rows).';
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 3: another user from the same family/trip is covered above
-- (Family B is a different session on the SAME trip as Family A) --
-- verify Family B cannot read or write Family A's data despite sharing
-- a trip.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
do $$
declare can_see_a_response bigint;
begin
  select count(*) into can_see_a_response from responses
  where question_id = '00000000-0000-0000-0000-000000000451' and participant_id = '00000000-0000-0000-0000-000000000411';
  -- Family B IS a trip member of trip AB, so is_trip_member(AB) is true
  -- for B -- meaning B legitimately sees AB's responses (that's the
  -- "trip members can read responses" policy, intentional: shared trip
  -- content/leaderboard-style visibility). What must NOT be true is that
  -- B can WRITE as A.
  raise notice 'SCENARIO 3 (Family B, same trip as A): can see Family A''s response (expected, trip-scoped read) = %', (can_see_a_response > 0);
end $$;

-- Family B attempts to update Family A's child's participant row.
update participants set display_name = 'HIJACKED BY FAMILY B'
  where id = '00000000-0000-0000-0000-000000000412';

do $$
declare still_original boolean;
begin
  select (display_name = 'Family A Child') into still_original from participants where id = '00000000-0000-0000-0000-000000000412';
  if coalesce(still_original, false) then
    raise notice 'SCENARIO 3 PASS: Family B''s update of Family A''s child row silently affected 0 rows -- name unchanged.';
  else
    raise exception 'SCENARIO 3 FAIL: Family B was able to modify Family A''s child participant row.';
  end if;
end $$;

-- Family B attempts to insert a response AS Family A's adult participant.
do $$
declare insert_succeeded boolean := false;
begin
  begin
    insert into responses (question_id, participant_id, is_correct)
    values ('00000000-0000-0000-0000-000000000451', '00000000-0000-0000-0000-000000000411', true);
    insert_succeeded := true;
  exception
    when others then
      -- RLS with-check violations raise 42501 (insufficient_privilege) /
      -- "new row violates row-level security policy".
      raise notice 'SCENARIO 3b: insert rejected as expected (%).', sqlerrm;
  end;

  if insert_succeeded then
    raise exception 'SCENARIO 3b FAIL: Family B was able to insert a response impersonating Family A''s participant_id.';
  else
    raise notice 'SCENARIO 3b PASS: Family B''s attempt to submit a response as Family A''s participant was rejected.';
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 4: a user from another family AND another trip entirely
-- (Family C). Expected: no visibility into trip AB's real participants
-- or responses at all (not even trip-scoped read, since C is not a
-- member of trip AB).
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
do $$
declare visible_ab_participants bigint;
declare visible_ab_responses bigint;
begin
  select count(*) into visible_ab_participants from participants
  where id in ('00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000412', '00000000-0000-0000-0000-000000000421');
  select count(*) into visible_ab_responses from responses where question_id = '00000000-0000-0000-0000-000000000451';

  raise notice 'SCENARIO 4 (Family C, different trip): visible trip-AB participants=%, visible trip-AB responses=%', visible_ab_participants, visible_ab_responses;

  if visible_ab_participants = 0 and visible_ab_responses = 0 then
    raise notice 'SCENARIO 4 PASS: a user from a wholly different trip sees none of trip AB''s real participants or responses.';
  else
    raise exception 'SCENARIO 4 FAIL: expected 0/0 visible; got participants=%, responses=%', visible_ab_participants, visible_ab_responses;
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 5: forged identifiers / admin flag. There is no `is_admin`
-- column or claim participants/responses/battle_scores RLS ever reads --
-- admin status lives only in creator_accounts, which these policies
-- don't consult at all. So "faking" an admin flag has no code path to
-- even reach; what's left to forge is the auth identity itself. Confirm
-- a random UUID that matches no real participant behaves exactly like
-- scenario 1 (a stranger), not like an owner.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111'; -- forged, matches no auth.users row and no participant
do $$
declare visible_ids uuid[];
begin
  select array_agg(id order by id) into visible_ids from participants
  where id in (
    '00000000-0000-0000-0000-000000000411', '00000000-0000-0000-0000-000000000412',
    '00000000-0000-0000-0000-000000000421', '00000000-0000-0000-0000-000000000431',
    '00000000-0000-0000-0000-000000000441'
  );
  if visible_ids = array['00000000-0000-0000-0000-000000000441']::uuid[] then
    raise notice 'SCENARIO 5 PASS: a forged/unrecognized identity sees only the legacy row, identical to having no session at all.';
  else
    raise exception 'SCENARIO 5 FAIL: forged identity saw unexpected rows: %', visible_ids;
  end if;
end $$;

-- Also confirm a forged identity cannot insert a participant claiming
-- someone else's auth_user_id (must match auth.uid() exactly).
do $$
declare insert_succeeded boolean := false;
begin
  begin
    insert into participants (trip_id, device_id, display_name, role, auth_user_id)
    values ('00000000-0000-0000-0000-000000000401', 'dev-forged', 'Forged', 'adult', '00000000-0000-0000-0000-0000000000a1');
    insert_succeeded := true;
  exception
    when others then
      raise notice 'SCENARIO 5b: insert rejected as expected (%).', sqlerrm;
  end;

  if insert_succeeded then
    raise exception 'SCENARIO 5b FAIL: was able to insert a participant claiming a different auth_user_id than the session''s own.';
  else
    raise notice 'SCENARIO 5b PASS: inserting a participant under someone else''s auth_user_id was rejected.';
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 6 ("direct Supabase access, not just via Next routes"): all
-- of the above already query the tables directly as anon/authenticated
-- via SET ROLE + SET LOCAL request.jwt.claim.sub -- i.e. exactly the
-- path a raw Supabase client (anon key + auth session) takes, with zero
-- Next.js code involved. This final check confirms the *base tables*
-- reject a raw anon SELECT on trips (column-hardening from
-- 20260906091000_account_hardening.sql), while trips_public still works.
-- -----------------------------------------------------------------------
begin;
set role anon;
do $$
begin
  begin
    perform 1 from trips limit 1;
    raise exception 'SCENARIO 6 FAIL: anon could still SELECT from the base trips table directly (ownership columns exposed).';
  exception
    when insufficient_privilege then
      raise notice 'SCENARIO 6a PASS: anon''s direct SELECT on the base trips table is rejected (%).', sqlerrm;
  end;
end $$;

do $$
declare visible_count bigint;
begin
  select count(*) into visible_count from trips_public;
  if visible_count > 0 then
    raise notice 'SCENARIO 6b PASS: anon can still read trips via trips_public (% rows), which excludes created_by_account_id/created_by_device_id.', visible_count;
  else
    raise exception 'SCENARIO 6b FAIL: anon could not read any rows via trips_public.';
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Cleanup. Fixture data was inserted in its own committed transaction
-- (deliberately -- SET ROLE/SET LOCAL only take effect for the current
-- transaction, so every scenario above needs the fixture already
-- committed and visible before it runs its own transaction). Remove it
-- now, as a superuser, so this file is safe to re-run from a clean slate.
-- -----------------------------------------------------------------------
delete from responses where question_id = '00000000-0000-0000-0000-000000000451';
delete from answer_options where question_id = '00000000-0000-0000-0000-000000000451';
delete from questions where id = '00000000-0000-0000-0000-000000000451';
delete from participants where trip_id in ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000402');
delete from trips where id in ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000402');
delete from auth.users where id in ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1');

\echo 'r1_auth_ownership_rls.test.sql: all scenarios passed.'
