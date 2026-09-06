-- R1-R3 closure batch (2026-09-05 review) integrated flow test: join ->
-- profile A/B -> Discover -> Battle -> retry -> progress/score, all
-- through the real, authoritative record_answer() RPC and real RLS, on
-- one shared trip/device -- the same shape the review's final report
-- asked to be exercised as ONE flow rather than only as separate,
-- isolated scenarios.
--
-- This exercises the server-side data/authorization layer exactly as the
-- real app's Discover/Battle/Catchup pages call it (src/lib/discover.ts's
-- submitAnswer -> record_answer RPC) -- it does NOT drive an actual
-- browser through the join wizard or page navigation (no live Next.js
-- server or Playwright in this environment); that remains a separately
-- reported NEEXECUTAT for a true multi-page browser end-to-end. Per-page
-- UI behavior (profile switching, selection reset, status banners) is
-- already covered by the Vitest component tests in tests/unit/.
--
-- Run against a scratch/dev database with all migrations applied (never
-- against real trip data) -- wrapped in a transaction rolled back at the
-- end, same setup as record_answer.test.sql.
--
--   PGDATABASE=<scratch> PGUSER=postgres PGHOST=localhost npm run test:sql:integrated-flow

\set ON_ERROR_STOP on

begin;

-- =======================================================================
-- Step 1: "join" -- one family (one device, two auth-linked profiles:
-- Parent (adult) and Child) joins a trip that already has Discover and
-- Battle content published.
-- =======================================================================
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000080a1');

insert into trips (id, slug, name, duration_days, start_date) values
  ('00000000-0000-0000-0000-000000008001', 'integrated-flow-trip', 'Integrated Flow Trip', 5, current_date);

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008001', 'dev-family', 'Parent', 'adult', '00000000-0000-0000-0000-0000000080a1'),
  ('00000000-0000-0000-0000-000000008012', '00000000-0000-0000-0000-000000008001', 'dev-family', 'Child', 'child', '00000000-0000-0000-0000-0000000080a1');

insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000008021', '00000000-0000-0000-0000-000000008001', 'discover', 1, 'morning', 1, 'Integrated Discover Q', 'single_choice', 10, true, true);
insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-000000008031', '00000000-0000-0000-0000-000000008021', 1, 'Discover Correct', true),
  ('00000000-0000-0000-0000-000000008032', '00000000-0000-0000-0000-000000008021', 2, 'Discover Wrong', false);

insert into battles (id, trip_id, day_number, title, is_final) values
  ('00000000-0000-0000-0000-000000008041', '00000000-0000-0000-0000-000000008001', 1, 'Integrated Battle', false);
insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published, battle_id) values
  ('00000000-0000-0000-0000-000000008022', '00000000-0000-0000-0000-000000008001', 'battle', 1, null, 1, 'Integrated Battle Q1', 'single_choice', 10, true, true, '00000000-0000-0000-0000-000000008041'),
  ('00000000-0000-0000-0000-000000008023', '00000000-0000-0000-0000-000000008001', 'battle', 1, null, 2, 'Integrated Battle Q2', 'single_choice', 10, true, true, '00000000-0000-0000-0000-000000008041');
insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-000000008033', '00000000-0000-0000-0000-000000008022', 1, 'Battle Q1 Correct', true),
  ('00000000-0000-0000-0000-000000008034', '00000000-0000-0000-0000-000000008022', 2, 'Battle Q1 Wrong', false),
  ('00000000-0000-0000-0000-000000008035', '00000000-0000-0000-0000-000000008023', 1, 'Battle Q2 Correct', true),
  ('00000000-0000-0000-0000-000000008036', '00000000-0000-0000-0000-000000008023', 2, 'Battle Q2 Wrong', false);

do $$ begin raise notice 'STEP 1 PASS: trip joined, two profiles (Parent, Child) share one device, Discover + Battle content published.'; end $$;

-- =======================================================================
-- Step 2: Discover -- Parent and Child each answer the SAME Discover
-- question as themselves. Individual, not shared: each gets their own
-- row, own correctness.
-- =======================================================================
set session request.jwt.claim.sub = '00000000-0000-0000-0000-0000000080a1';
set role authenticated;

do $$
declare parent_result record;
declare child_result record;
begin
  select * into parent_result from record_answer(
    '00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008021', '00000000-0000-0000-0000-000000008031');
  select * into child_result from record_answer(
    '00000000-0000-0000-0000-000000008012', '00000000-0000-0000-0000-000000008021', '00000000-0000-0000-0000-000000008032');

  if parent_result.status <> 'accepted' or child_result.status <> 'accepted' then
    raise exception 'STEP 2 FAIL: expected both fresh Discover answers accepted, got parent=% child=%', parent_result.status, child_result.status;
  end if;
  if not (parent_result.response).is_correct then
    raise exception 'STEP 2 FAIL: Parent chose the correct Discover option but is_correct is false.';
  end if;
  if (child_result.response).is_correct then
    raise exception 'STEP 2 FAIL: Child chose the wrong Discover option but is_correct is true.';
  end if;

  raise notice 'STEP 2 PASS: Parent and Child each answered Discover individually, with independently-derived correctness.';
end $$;

reset role;

-- =======================================================================
-- Step 3: Battle -- Parent answers both questions first (opens the
-- team window), then Child answers both. Verify individual scores AND
-- the team aggregate.
-- =======================================================================
set session request.jwt.claim.sub = '00000000-0000-0000-0000-0000000080a1';
set role authenticated;

do $$
declare r record;
begin
  select * into r from record_answer('00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008022', '00000000-0000-0000-0000-000000008033');
  if r.status <> 'accepted' or not r.contributed_to_team then
    raise exception 'STEP 3 FAIL: Parent Battle Q1 expected accepted+contributed, got status=% contributed=%', r.status, r.contributed_to_team;
  end if;

  select * into r from record_answer('00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008023', '00000000-0000-0000-0000-000000008035');
  if r.status <> 'accepted' or not r.contributed_to_team then
    raise exception 'STEP 3 FAIL: Parent Battle Q2 expected accepted+contributed, got status=% contributed=%', r.status, r.contributed_to_team;
  end if;

  raise notice 'STEP 3a PASS: Parent answered both Battle questions, both contributing to the adults team.';
end $$;

reset role;

set session request.jwt.claim.sub = '00000000-0000-0000-0000-0000000080a1';
set role authenticated;

do $$
declare r record;
begin
  -- Child is a DIFFERENT participant but the SAME device/auth session
  -- (parent's own login also owns the child profile it created) --
  -- participant_is_self_or_legacy() must still authorize this, the same
  -- ownership shape the real app's "Alt profil răspunde"/profile switch
  -- relies on.
  select * into r from record_answer('00000000-0000-0000-0000-000000008012', '00000000-0000-0000-0000-000000008022', '00000000-0000-0000-0000-000000008034');
  if r.status <> 'accepted' or not r.contributed_to_team then
    raise exception 'STEP 3 FAIL: Child Battle Q1 expected accepted+contributed, got status=% contributed=%', r.status, r.contributed_to_team;
  end if;

  select * into r from record_answer('00000000-0000-0000-0000-000000008012', '00000000-0000-0000-0000-000000008023', '00000000-0000-0000-0000-000000008035');
  if r.status <> 'accepted' or not r.contributed_to_team then
    raise exception 'STEP 3 FAIL: Child Battle Q2 expected accepted+contributed, got status=% contributed=%', r.status, r.contributed_to_team;
  end if;

  raise notice 'STEP 3b PASS: Child answered both Battle questions on the same device/session, both contributing to the kids team.';
end $$;

reset role;

-- =======================================================================
-- Step 4: retry -- Parent retries Discover with the SAME option
-- (idempotent) and then with a DIFFERENT option (conflict) -- the
-- original answer must survive both.
-- =======================================================================
set session request.jwt.claim.sub = '00000000-0000-0000-0000-0000000080a1';
set role authenticated;

do $$
declare r record;
declare original_response_id uuid;
begin
  select id into original_response_id from responses
  where participant_id = '00000000-0000-0000-0000-000000008011' and question_id = '00000000-0000-0000-0000-000000008021';

  select * into r from record_answer('00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008021', '00000000-0000-0000-0000-000000008031');
  if r.status <> 'already_recorded' or (r.response).id <> original_response_id then
    raise exception 'STEP 4 FAIL: identical retry expected already_recorded on the original response, got status=% response_id=%', r.status, (r.response).id;
  end if;

  select * into r from record_answer('00000000-0000-0000-0000-000000008011', '00000000-0000-0000-0000-000000008021', '00000000-0000-0000-0000-000000008032');
  if r.status <> 'conflict' or (r.response).id <> original_response_id or (r.response).selected_option_id <> '00000000-0000-0000-0000-000000008031' then
    raise exception 'STEP 4 FAIL: different-option retry expected conflict returning the ORIGINAL response, got status=% response_id=% selected=%', r.status, (r.response).id, (r.response).selected_option_id;
  end if;

  raise notice 'STEP 4 PASS: identical retry is idempotent (already_recorded); a different-option retry reports conflict and never overwrites the original answer.';
end $$;

reset role;

-- =======================================================================
-- Step 5: progress/score -- verify each profile's individual progress
-- (their own responses only) and the Battle's team score, exactly what
-- Home/Battle "done" screen and the leaderboard read.
-- =======================================================================
do $$
declare parent_response_count bigint;
declare child_response_count bigint;
declare adults_score numeric;
declare kids_score numeric;
begin
  select count(*) into parent_response_count from responses where participant_id = '00000000-0000-0000-0000-000000008011';
  select count(*) into child_response_count from responses where participant_id = '00000000-0000-0000-0000-000000008012';
  -- Parent: 1 Discover + 2 Battle = 3. Child: 1 Discover + 2 Battle = 3.
  -- Independent of each other -- neither total leaked into the other's.
  if parent_response_count <> 3 or child_response_count <> 3 then
    raise exception 'STEP 5 FAIL: expected 3 individual responses each, got parent=% child=%', parent_response_count, child_response_count;
  end if;

  select score into adults_score from battle_team_score('00000000-0000-0000-0000-000000008041') where team = 'adults';
  select score into kids_score from battle_team_score('00000000-0000-0000-0000-000000008041') where team = 'kids';
  -- Parent (adult) got both Battle questions right: 20. Child (kid) got
  -- Q1 wrong, Q2 right: 10.
  if adults_score <> 20 then
    raise exception 'STEP 5 FAIL: expected adults team score 20 (Parent got both Battle questions right), got %', adults_score;
  end if;
  if kids_score <> 10 then
    raise exception 'STEP 5 FAIL: expected kids team score 10 (Child got one of two Battle questions right), got %', kids_score;
  end if;

  raise notice 'STEP 5 PASS: individual progress (3 responses each) and Battle team scores (adults=20, kids=10) both correct end to end.';
end $$;

rollback;
