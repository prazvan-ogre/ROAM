-- Regression tests for battle_team_score() and trip_battle_win_tally()
-- (supabase/migrations/20260827190000_fix_battle_team_score_average.sql,
-- 20260827200000_fix_trip_tally_reveal_leak.sql). Both fixes went out
-- without any automated check that they'd stay fixed -- this script is
-- that check. Run it against a scratch/dev database that already has
-- every migration applied (never against a database with real trip
-- data): it inserts fixture rows and wraps everything in a transaction
-- that's rolled back at the end, so it never leaves data behind, but it
-- still shares the target database's connection and current schema.
--
--   PGDATABASE=roam_test PGUSER=postgres PGHOST=localhost npm run test:sql
--   (or any other libpq env vars / a service name -- see `man psql`)
--
-- Exits non-zero (via RAISE EXCEPTION, with ON_ERROR_STOP=1 in the npm
-- script) on the first failing assertion.

begin;

-- Fixture: one trip, three participants per team is enough to cover
-- every rule below without needing per-question `questions` rows --
-- battle_team_score()/trip_battle_win_tally() read battle_scores
-- directly and never join back to questions.
insert into trips (id, slug, name, duration_days)
values ('00000000-0000-0000-0000-000000000001', 'battle-scoring-test', 'Battle Scoring Test', 5);

insert into participants (id, trip_id, device_id, display_name, role) values
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'dev-a1', 'Adult 1', 'adult'),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'dev-a2', 'Adult 2', 'adult'),
  ('00000000-0000-0000-0000-000000000021', '00000000-0000-0000-0000-000000000001', 'dev-k1', 'Kid 1', 'child'),
  ('00000000-0000-0000-0000-000000000022', '00000000-0000-0000-0000-000000000001', 'dev-k2', 'Kid 2', 'child'),
  ('00000000-0000-0000-0000-000000000023', '00000000-0000-0000-0000-000000000001', 'dev-k3', 'Kid 3', 'child');

-- ---------------------------------------------------------------------
-- Test 1: battle_team_score() averages per participant, not per row.
-- Mirrors the exact scenario from the averaging-bug fix's own
-- verification note: 2 adults summing to 60 vs 3 kids also summing to
-- 60 (an intentional sum-tie) must resolve to 30 vs 20, not 10 vs 6.67.
-- ---------------------------------------------------------------------
insert into battles (id, trip_id, title) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Battle 1 (averaging)');

-- created_at is set well outside the 15-minute reveal window (rather
-- than left at its now() default) so this battle is also eligible for
-- the win tally in test 2/3 below -- test 1 itself only exercises
-- battle_team_score(), which ignores created_at entirely.
insert into battle_scores (battle_id, participant_id, team, score, created_at) values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000011', 'adults', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000011', 'adults', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000011', 'adults', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000012', 'adults', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000012', 'adults', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000012', 'adults', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000021', 'kids', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000021', 'kids', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000021', 'kids', 0, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000022', 'kids', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000022', 'kids', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000022', 'kids', 0, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000023', 'kids', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000023', 'kids', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000023', 'kids', 0, now() - interval '20 minutes');

do $$
declare adults_score numeric; kids_score numeric;
begin
  select score into adults_score from battle_team_score('00000000-0000-0000-0000-000000000101') where team = 'adults';
  select score into kids_score from battle_team_score('00000000-0000-0000-0000-000000000101') where team = 'kids';
  if adults_score is distinct from 30 or kids_score is distinct from 20 then
    raise exception 'FAIL test 1 (per-participant averaging): expected adults=30 kids=20, got adults=% kids=%', adults_score, kids_score;
  end if;
  raise notice 'PASS test 1: battle_team_score averages per participant (adults=30, kids=20)';
end $$;

-- ---------------------------------------------------------------------
-- Test 2: trip_battle_win_tally() excludes a battle still inside its
-- 15-minute reveal window, includes it once that window has closed, and
-- always includes a legacy (participant_id null) battle regardless of
-- age. Mirrors the reveal-leak fix's own verification note.
-- ---------------------------------------------------------------------
insert into battles (id, trip_id, title) values
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000001', 'Battle 2 (still open)'),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000001', 'Battle 3 (window closed)'),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000001', 'Battle 4 (legacy, no window)');

-- Battle 2: one adult answered 2 minutes ago -- window still open, so
-- this battle must not swing the tally at all, even though adults are
-- currently "winning" it 10-0.
insert into battle_scores (battle_id, participant_id, team, score, created_at) values
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000011', 'adults', 10, now() - interval '2 minutes');

-- Battle 3: one kid answered 20 minutes ago -- window closed, kids win
-- 10-0, must count.
insert into battle_scores (battle_id, participant_id, team, score, created_at) values
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000021', 'kids', 10, now() - interval '20 minutes');

-- Battle 4: legacy team-controller submission (participant_id null),
-- adults win 5-3. Predates the reveal-window feature entirely, so it's
-- always counted, however recent.
insert into battle_scores (battle_id, participant_id, team, score, created_at) values
  ('00000000-0000-0000-0000-000000000104', null, 'adults', 5, now()),
  ('00000000-0000-0000-0000-000000000104', null, 'kids', 3, now());

do $$
declare adults_wins bigint; kids_wins bigint;
begin
  select wins into adults_wins from trip_battle_win_tally('00000000-0000-0000-0000-000000000001') where team = 'adults';
  select wins into kids_wins from trip_battle_win_tally('00000000-0000-0000-0000-000000000001') where team = 'kids';
  -- Battle 1 (adults win, averaging test above) + Battle 4 (adults win, legacy) = 2.
  -- Battle 2 must NOT count yet (still inside its window).
  -- Battle 3 (kids win) counts = 1.
  if adults_wins is distinct from 2 or kids_wins is distinct from 1 then
    raise exception 'FAIL test 2 (reveal-window gate): expected adults=2 kids=1, got adults=% kids=%', adults_wins, kids_wins;
  end if;
  raise notice 'PASS test 2: trip_battle_win_tally excludes an open reveal window, counts a closed one and a legacy battle unconditionally (adults=2, kids=1)';
end $$;

-- ---------------------------------------------------------------------
-- Test 3: a tied resolved score counts as a win for both teams.
-- ---------------------------------------------------------------------
insert into battles (id, trip_id, title) values
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000001', 'Battle 5 (tie)');

insert into battle_scores (battle_id, participant_id, team, score, created_at) values
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000011', 'adults', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000021', 'kids', 10, now() - interval '20 minutes');

do $$
declare adults_wins bigint; kids_wins bigint;
begin
  select wins into adults_wins from trip_battle_win_tally('00000000-0000-0000-0000-000000000001') where team = 'adults';
  select wins into kids_wins from trip_battle_win_tally('00000000-0000-0000-0000-000000000001') where team = 'kids';
  -- Previous tally (2, 1) from test 2, plus this tie crediting both: (3, 2).
  if adults_wins is distinct from 3 or kids_wins is distinct from 2 then
    raise exception 'FAIL test 3 (tie counts for both): expected adults=3 kids=2, got adults=% kids=%', adults_wins, kids_wins;
  end if;
  raise notice 'PASS test 3: a tied battle credits both teams in the win tally (adults=3, kids=2)';
end $$;

rollback;

\echo 'ALL BATTLE SCORING TESTS PASSED (transaction rolled back, no fixture data kept)'
