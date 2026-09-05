-- Regression test for hypothesis C from the 2026-09-05 architecture/
-- security review: battle_team_score()/trip_battle_win_tally()
-- (fixed in 20260906110000_fix_battle_score_fractional_average.sql)
-- used to divide `sum(score)` by `count(distinct participant_id)` as
-- plain bigint arithmetic, truncating a real fractional lead before it
-- ever reached battle_team_score's declared `numeric` return column, or
-- trip_battle_win_tally's own win/loss comparison.
--
-- Until 2026-09-06 this file demonstrated the bug (asserted the *wrong*,
-- truncated-tie outcome and raised an exception the moment it was
-- observed). Now that the fix has shipped, it asserts the *correct*
-- outcome instead -- an ordinary regression test, exactly like
-- battle_scoring.test.sql, meant to always pass and to fail loudly if
-- this ever regresses.
--
-- Run against a scratch/dev database with all migrations applied (never
-- against real trip data) -- wrapped in a transaction that is rolled
-- back at the end.
--
--   PGDATABASE=<scratch> PGUSER=postgres PGHOST=localhost npm run test:sql:fractional

begin;

-- =======================================================================
-- Scenario 1: battle_team_score() itself. Team A (adults): 3 participants
-- summing to 20 -- true average 6.667. Team B (kids): 5 participants
-- summing to 30 -- true average 6.0. Adults should decisively win
-- (6.667 > 6.0), not tie at a truncated 6.
-- =======================================================================
insert into trips (id, slug, name, duration_days)
values ('00000000-0000-0000-0000-000000000201', 'fractional-average-test', 'Fractional Average Test', 5);

insert into participants (id, trip_id, device_id, display_name, role) values
  ('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000201', 'dev-a1', 'Adult 1', 'adult'),
  ('00000000-0000-0000-0000-000000000212', '00000000-0000-0000-0000-000000000201', 'dev-a2', 'Adult 2', 'adult'),
  ('00000000-0000-0000-0000-000000000213', '00000000-0000-0000-0000-000000000201', 'dev-a3', 'Adult 3', 'adult'),
  ('00000000-0000-0000-0000-000000000221', '00000000-0000-0000-0000-000000000201', 'dev-k1', 'Kid 1', 'child'),
  ('00000000-0000-0000-0000-000000000222', '00000000-0000-0000-0000-000000000201', 'dev-k2', 'Kid 2', 'child'),
  ('00000000-0000-0000-0000-000000000223', '00000000-0000-0000-0000-000000000201', 'dev-k3', 'Kid 3', 'child'),
  ('00000000-0000-0000-0000-000000000224', '00000000-0000-0000-0000-000000000201', 'dev-k4', 'Kid 4', 'child'),
  ('00000000-0000-0000-0000-000000000225', '00000000-0000-0000-0000-000000000201', 'dev-k5', 'Kid 5', 'child');

insert into battles (id, trip_id, title) values
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000201', 'Battle (fractional average)');

-- Adults: 20 points total across 3 people (e.g. one 10, one 10, one 0).
insert into battle_scores (battle_id, participant_id, team, score) values
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000211', 'adults', 10),
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000212', 'adults', 10),
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000213', 'adults', 0);

-- Kids: 30 points total across 5 people (three 10s, two 0s).
insert into battle_scores (battle_id, participant_id, team, score) values
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000221', 'kids', 10),
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000222', 'kids', 10),
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000223', 'kids', 10),
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000224', 'kids', 0),
  ('00000000-0000-0000-0000-000000000231', '00000000-0000-0000-0000-000000000225', 'kids', 0);

do $$
declare adults_score numeric; kids_score numeric;
begin
  select score into adults_score from battle_team_score('00000000-0000-0000-0000-000000000231') where team = 'adults';
  select score into kids_score from battle_team_score('00000000-0000-0000-0000-000000000231') where team = 'kids';

  raise notice 'battle_team_score returned adults=% kids=% (expected: adults=6.667 kids=6.0)', adults_score, kids_score;

  if adults_score <= kids_score then
    raise exception 'REGRESSION: adults (%) did not beat kids (%) -- the fractional-average truncation bug is back.', adults_score, kids_score;
  end if;
  if abs(adults_score - 20.0 / 3) > 0.001 then
    raise exception 'REGRESSION: adults_score (%) is not the true average 20/3 (6.6667) -- expected a preserved fraction, not a rounded/truncated value.', adults_score;
  end if;
  if kids_score <> 6 then
    raise exception 'UNEXPECTED: kids_score (%) is not the whole-number average 30/5 (6).', kids_score;
  end if;

  raise notice 'PASS: battle_team_score preserves the fractional lead (adults % > kids %)', adults_score, kids_score;
end $$;

-- =======================================================================
-- Scenario 2: trip_battle_win_tally(), the more consequential half of
-- this bug -- it never returns a score, only compares adults_score >=
-- kids_score / kids_score >= adults_score per battle to decide the
-- season-long win tally. A truncated 6-vs-6 "tie" satisfied *both*
-- comparisons, silently crediting both teams for an evening adults
-- actually won outright. Same 20-vs-3 / 30-vs-5 shape as scenario 1, in
-- a second battle on the same trip, closed (created_at well past the
-- 15-minute reveal window trip_battle_win_tally itself gates on -- see
-- 20260827200000_fix_trip_tally_reveal_leak.sql) so it's actually
-- counted.
-- =======================================================================
insert into battles (id, trip_id, title) values
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000201', 'Battle (fractional tally)');

insert into battle_scores (battle_id, participant_id, team, score, created_at) values
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000211', 'adults', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000212', 'adults', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000213', 'adults', 0, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000221', 'kids', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000222', 'kids', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000223', 'kids', 10, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000224', 'kids', 0, now() - interval '20 minutes'),
  ('00000000-0000-0000-0000-000000000232', '00000000-0000-0000-0000-000000000225', 'kids', 0, now() - interval '20 minutes');

do $$
declare adults_wins bigint; kids_wins bigint;
begin
  select wins into adults_wins from trip_battle_win_tally('00000000-0000-0000-0000-000000000201') where team = 'adults';
  select wins into kids_wins from trip_battle_win_tally('00000000-0000-0000-0000-000000000201') where team = 'kids';

  raise notice 'trip_battle_win_tally returned adults=% kids=% wins (expected: adults=1 kids=0 -- only scenario 2''s battle is closed/countable)', adults_wins, kids_wins;

  if adults_wins <> 1 or kids_wins <> 0 then
    raise exception 'REGRESSION: expected adults to win this evening outright (adults=1, kids=0), got adults=% kids=% -- a truncated tie would credit both teams (adults=1, kids=1).', adults_wins, kids_wins;
  end if;

  raise notice 'PASS: trip_battle_win_tally credits the fractional lead to adults alone, not both teams';
end $$;

rollback;
