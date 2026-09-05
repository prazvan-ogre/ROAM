-- Regression test for the production incident fixed by
-- 20260906100000_participants_self_read_fix.sql: a brand-new anonymous
-- session's very first participant insert failed with "new row violates
-- row-level security policy for table participants" even though the
-- INSERT's own WITH CHECK (auth_user_id = auth.uid()) was satisfied --
-- because the app's insert is `.insert(...).select().single()`, which
-- compiles to `INSERT ... RETURNING ...`, and RETURNING re-checks the
-- table's SELECT policy against the just-inserted row. The original
-- SELECT policy (20260906090000_auth_ownership.sql) only allowed a
-- legacy row (auth_user_id is null) or trip membership proven by an
-- EXISTING sibling row (is_trip_member) -- neither is true for a
-- session's first-ever participant on a trip.
--
-- Run against a scratch DB with all migrations applied (including this
-- fix) plus the same stub `auth` schema and anon/authenticated role
-- grants documented at the top of r1_auth_ownership_rls.test.sql -- this
-- file only adds the one scenario that incident actually hit; see that
-- file for the fuller ownership/RLS scenario suite.
--
--   PGPASSWORD=postgres psql -U postgres -h localhost -d roam_auth \
--     -f supabase/tests/r1_participant_first_insert_returning.test.sql

\set ON_ERROR_STOP on

begin;
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000f1');
insert into trips (id, slug, name, duration_days)
  values ('00000000-0000-0000-0000-000000000501', 'r1-first-insert-test', 'R1 First Insert Test', 5);
commit;

begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000f1';

-- This is the exact shape supabase-js's getOrCreateAdultParticipant
-- issues (insert + select-representation, i.e. RETURNING) for the
-- FIRST-ever participant this session creates -- no sibling row exists
-- yet, so is_trip_member(trip_id) alone (the pre-fix policy) would have
-- nothing to find.
do $$
declare created_id uuid;
declare created_name text;
begin
  insert into participants (trip_id, device_id, display_name, role, auth_user_id)
  values ('00000000-0000-0000-0000-000000000501', 'dev-first-insert', 'First Ever Participant', 'adult', '00000000-0000-0000-0000-0000000000f1')
  returning id, display_name into created_id, created_name;

  if created_id is not null and created_name = 'First Ever Participant' then
    raise notice 'PASS: first-ever participant insert + RETURNING read-back succeeded (id=%, name=%).', created_id, created_name;
  else
    raise exception 'FAIL: insert succeeded but RETURNING did not come back as expected.';
  end if;
end $$;
reset role;
rollback;

-- Cleanup (the insert above was rolled back, but the fixture trip/auth
-- user were committed above -- remove them so this file is re-runnable).
delete from trips where id = '00000000-0000-0000-0000-000000000501';
delete from auth.users where id = '00000000-0000-0000-0000-0000000000f1';

\echo 'r1_participant_first_insert_returning.test.sql: passed.'
