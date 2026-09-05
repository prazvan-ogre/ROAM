-- Regression test for a hypothesis raised in the 2026-09-05 architecture
-- review (R3): battle_team_score()/trip_battle_win_tally()
-- (supabase/migrations/20260827190000_fix_battle_team_score_average.sql,
-- 20260827200000_fix_trip_tally_reveal_leak.sql) divide
-- `sum(score) filter (...)` by `count(distinct participant_id) filter (...)`
-- with no numeric cast. Both sides of that division are `bigint`
-- (sum(int) and count(...) both return bigint in Postgres), so the
-- division truncates *before* the result is ever cast to the function's
-- declared `numeric` return column -- a fractional average that should
-- decisively beat a whole-number average can come back identical to it.
--
-- This file only demonstrates the hypothesis; it does not fix it. Run
-- against a scratch/dev database with all migrations applied (never
-- against real trip data), same as battle_scoring.test.sql -- wrapped in
-- a transaction that is rolled back at the end.
--
--   PGDATABASE=<scratch> PGUSER=postgres PGHOST=localhost npm run test:sql:fractional

begin;

insert into trips (id, slug, name, duration_days)
values ('00000000-0000-0000-0000-000000000201', 'fractional-average-test', 'Fractional Average Test', 5);

-- Team A (adults): 3 participants summing to 20 -- true average 6.667.
-- Team B (kids): 5 participants summing to 30 -- true average 6.0.
-- Adults should decisively win (6.667 > 6.0), not tie.
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

  raise notice 'battle_team_score returned adults=% kids=% (true averages: adults=6.667 kids=6.0)', adults_score, kids_score;

  if adults_score = 6 and kids_score = 6 then
    raise exception 'HYPOTHESIS CONFIRMED: integer division truncated adults'' 20/3 (6.667) and kids'' 30/5 (6.0) to the same integer 6 -- a real 0.667-point lead is reported as a tie.';
  elsif adults_score > kids_score then
    raise notice 'HYPOTHESIS NOT REPRODUCED: adults (%) correctly beat kids (%) -- division appears to preserve the fraction in this build.', adults_score, kids_score;
  else
    raise exception 'UNEXPECTED: adults=% kids=%, neither the predicted truncation-tie nor a correct adults win.', adults_score, kids_score;
  end if;
end $$;

rollback;
