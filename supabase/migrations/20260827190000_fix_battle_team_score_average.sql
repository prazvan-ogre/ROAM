-- Fixes a real bug in battle_team_score()/trip_battle_win_tally() from
-- 20260826153000_individual_battle_scoring.sql: the product owner spec is
-- "sum of correct-answer points divided by the number of participants in
-- that team" -- but the original SQL used avg(score), which averages
-- over battle_scores *rows* (one row per participant per question), not
-- over participants. With every participant answering the same number
-- of questions (the normal case), dividing both teams' numbers by that
-- same question count happens to preserve who has the higher score, so
-- no evening's win/loss actually flipped -- but the displayed magnitude
-- was wrong (understated by a factor of ~the question count), visible on
-- the Întrebări recap page's "PĂRINȚI X — COPII Y" line
-- (BattleHistoryItem.score), and would only be exposed as a real
-- win/loss bug the moment participation becomes uneven per-question
-- (e.g. a partial completion within the window).
--
-- Fixed to sum(score) / count(distinct participant_id) per team, exactly
-- matching the spec wording. Legacy (participant_id is null, pre-feature)
-- battles are unaffected -- still resolved by raw sum, unchanged.
--
-- Verified on a scratch Postgres: 2 adults each 3/3 correct (sum 60) vs
-- 3 kids each 2/3 correct (sum 60, an intentional sum-tie) -- previously
-- returned adults 10.0 / kids 6.67 (averaged over 6 and 9 rows
-- respectively); now correctly returns adults 30 / kids 20 (60/2 and
-- 60/3), still resolving to the same adults win either way for this
-- equal-question-count case, but with the right numbers.

create or replace function public.battle_team_score(p_battle_id uuid)
returns table (team text, score numeric)
language sql
security definer
set search_path = public
as $$
  with agg as (
    select
      bool_or(participant_id is not null) as has_individual,
      sum(score) filter (where team = 'adults' and participant_id is not null) as adults_ind_sum,
      count(distinct participant_id) filter (where team = 'adults' and participant_id is not null) as adults_ind_count,
      sum(score) filter (where team = 'kids' and participant_id is not null) as kids_ind_sum,
      count(distinct participant_id) filter (where team = 'kids' and participant_id is not null) as kids_ind_count,
      sum(score) filter (where team = 'adults' and participant_id is null) as adults_sum,
      sum(score) filter (where team = 'kids' and participant_id is null) as kids_sum
    from battle_scores
    where battle_id = p_battle_id
  )
  select 'adults', coalesce(
    case when has_individual
      then adults_ind_sum / nullif(adults_ind_count, 0)
      else adults_sum
    end, 0) from agg
  union all
  select 'kids', coalesce(
    case when has_individual
      then kids_ind_sum / nullif(kids_ind_count, 0)
      else kids_sum
    end, 0) from agg;
$$;

grant execute on function public.battle_team_score(uuid) to anon, authenticated;

create or replace function public.trip_battle_win_tally(p_trip_id uuid)
returns table (team text, wins bigint)
language sql
security definer
set search_path = public
as $$
  with battle_agg as (
    select
      b.id as battle_id,
      bool_or(bs.participant_id is not null) as has_individual,
      sum(bs.score) filter (where bs.team = 'adults' and bs.participant_id is not null) as adults_ind_sum,
      count(distinct bs.participant_id) filter (where bs.team = 'adults' and bs.participant_id is not null) as adults_ind_count,
      sum(bs.score) filter (where bs.team = 'kids' and bs.participant_id is not null) as kids_ind_sum,
      count(distinct bs.participant_id) filter (where bs.team = 'kids' and bs.participant_id is not null) as kids_ind_count,
      sum(bs.score) filter (where bs.team = 'adults' and bs.participant_id is null) as adults_sum,
      sum(bs.score) filter (where bs.team = 'kids' and bs.participant_id is null) as kids_sum
    from battles b
    join battle_scores bs on bs.battle_id = b.id
    where b.trip_id = p_trip_id
    group by b.id
  ),
  resolved as (
    select
      battle_id,
      coalesce(
        case when has_individual
          then adults_ind_sum / nullif(adults_ind_count, 0)
          else adults_sum
        end, 0) as adults_score,
      coalesce(
        case when has_individual
          then kids_ind_sum / nullif(kids_ind_count, 0)
          else kids_sum
        end, 0) as kids_score
    from battle_agg
  )
  select 'adults', count(*) filter (where adults_score >= kids_score) from resolved
  union all
  select 'kids', count(*) filter (where kids_score >= adults_score) from resolved;
$$;
