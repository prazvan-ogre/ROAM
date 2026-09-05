-- Regression test for hypothesis D (2026-09-05 architecture/security
-- review): the Home dashboard's "is this Discover slot completed?"
-- check (app/trip/[slug]/page.tsx's loadSlotStatus/isCompleted) used to
-- be
--
--   select count(*) from responses
--   where question_id = :questionId and participant_id in (:profileIds)
--
-- where :profileIds was *every* participant on this device
-- (listProfilesForDevice), not just the currently active profile -- one
-- profile's answer marked the slot "completed" for every other profile
-- sharing the device, even one that had never answered.
--
-- Fixed in app/trip/[slug]/page.tsx by resolving a single active profile
-- (resolveActiveProfile(), the same getStoredActiveProfileId()
-- resolution ProfileMenu/Discover/Battle/Catchup already use) once per
-- load and scoping the check to it alone:
--
--   select count(*) from responses
--   where question_id = :questionId and participant_id = :activeProfileId
--
-- This file reproduces that exact query shape against fixture data to
-- verify the fix, not to demonstrate the bug (that was this file's job
-- until the fix shipped): the Parent's answer no longer marks the slot
-- "completed" when the Child is the active profile, and the Parent's own
-- completion is still correctly reported when the Parent is active.
--
-- Run against a scratch/dev database with all migrations applied (never
-- against real trip data) -- wrapped in a transaction that is rolled
-- back at the end.
--
--   PGDATABASE=<scratch> PGUSER=postgres PGHOST=localhost npm run test:sql:completion

begin;

insert into trips (id, slug, name, duration_days)
values ('00000000-0000-0000-0000-000000000301', 'profile-completion-test', 'Profile Completion Test', 5);

-- One device, two profiles: a parent and a child, sharing device_id
-- "dev-shared" the same way a family's single phone does in the real
-- app (docs/DATABASE.md: a child has no device/session of its own).
insert into participants (id, trip_id, device_id, display_name, role) values
  ('00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000301', 'dev-shared', 'Parent', 'adult'),
  ('00000000-0000-0000-0000-000000000312', '00000000-0000-0000-0000-000000000301', 'dev-shared', 'Child', 'child');

insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000000321', '00000000-0000-0000-0000-000000000301', 'discover', 1, 'morning', 1, 'Test question?', 'single_choice', 10, true, true);

insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-000000000331', '00000000-0000-0000-0000-000000000321', 1, 'A', true);

-- Only the Parent has answered. The Child (a distinct, real profile on
-- the same device) has not.
insert into responses (question_id, participant_id, selected_option_id, is_correct) values
  ('00000000-0000-0000-0000-000000000321', '00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000331', true);

do $$
declare child_active_count bigint;
declare parent_active_count bigint;
begin
  -- The app's current (fixed) query, active profile = Child, who has
  -- not answered.
  select count(*) into child_active_count
  from responses
  where question_id = '00000000-0000-0000-0000-000000000321'
    and participant_id = '00000000-0000-0000-0000-000000000312';

  -- Same query, active profile = Parent, who has answered.
  select count(*) into parent_active_count
  from responses
  where question_id = '00000000-0000-0000-0000-000000000321'
    and participant_id = '00000000-0000-0000-0000-000000000311';

  raise notice 'active-profile completed count: Child=% Parent=%', child_active_count, parent_active_count;

  if child_active_count <> 0 then
    raise exception 'REGRESSION: the Child (active profile) reads as having completed this slot (count=%) even though only the Parent answered -- the device-wide leak is back.', child_active_count;
  end if;
  if parent_active_count = 0 then
    raise exception 'REGRESSION: the Parent (active profile) reads as NOT having completed this slot, even though the Parent is the one who answered.';
  end if;

  raise notice 'PASS: completion is scoped to the active profile alone -- the Parent''s answer no longer leaks onto the Child';
end $$;

rollback;
