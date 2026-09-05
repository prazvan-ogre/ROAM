-- Regression test for a hypothesis raised in the 2026-09-05 architecture
-- review (R2): the Home dashboard's "is this Discover slot completed?"
-- check (app/trip/[slug]/page.tsx's loadSlotStatus/isCompleted) is:
--
--   select count(*) from responses
--   where question_id = :questionId and participant_id in (:profileIds)
--
-- where :profileIds is *every* participant on this device
-- (listProfilesForDevice), not just the currently active profile
-- (ProfileMenu's stored active-profile id). This file reproduces that
-- exact query shape against fixture data to demonstrate the consequence:
-- one profile's answer marks the slot "completed" for every other
-- profile sharing the device, even one that has never answered.
--
-- This file only demonstrates the hypothesis; it does not fix it (fixing
-- it means scoping the check to the active profile, an application-code
-- change, not a database one). Run against a scratch/dev database with
-- all migrations applied (never against real trip data) -- wrapped in a
-- transaction that is rolled back at the end.
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
declare device_completed_count bigint;
declare child_only_completed_count bigint;
begin
  -- The app's literal query: every profile on the device, exactly as
  -- listProfilesForDevice()/loadSlotStatus() build `profileIds`.
  select count(*) into device_completed_count
  from responses
  where question_id = '00000000-0000-0000-0000-000000000321'
    and participant_id in ('00000000-0000-0000-0000-000000000311', '00000000-0000-0000-0000-000000000312');

  -- What the signal *should* be if scoped to the Child alone (the
  -- profile that actually has not answered).
  select count(*) into child_only_completed_count
  from responses
  where question_id = '00000000-0000-0000-0000-000000000321'
    and participant_id in ('00000000-0000-0000-0000-000000000312');

  raise notice 'device-wide count=% (drives "completed" if >0), child-only count=%', device_completed_count, child_only_completed_count;

  if device_completed_count > 0 and child_only_completed_count = 0 then
    raise exception 'HYPOTHESIS CONFIRMED: the Parent''s answer alone makes this slot read as "completed" (count=%) for the whole device, even though the Child (count=%) has never answered it.', device_completed_count, child_only_completed_count;
  else
    raise notice 'HYPOTHESIS NOT REPRODUCED with this fixture (device_completed_count=%, child_only_completed_count=%).', device_completed_count, child_only_completed_count;
  end if;
end $$;

rollback;
