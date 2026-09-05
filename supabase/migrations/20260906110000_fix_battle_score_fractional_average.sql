-- Fixes hypothesis C from the 2026-09-05 review (confirmed by
-- supabase/tests/battle_scoring_fractional_average.test.sql): both
-- battle_team_score() (20260827190000_fix_battle_team_score_average.sql)
-- and trip_battle_win_tally() (20260827200000_fix_trip_tally_reveal_leak.sql)
-- compute a team's per-participant average as
--   sum(score) filter (...) / count(distinct participant_id) filter (...)
-- with no numeric cast. sum(int) and count(...) both return bigint in
-- Postgres, so `/` between them is integer division -- truncated *before*
-- the result is ever cast to battle_team_score's declared `numeric`
-- return column, or compared in trip_battle_win_tally's own win/loss
-- `>=` check. Concretely: adults 20 points / 3 people (6.667) and kids 30
-- points / 5 people (6.0) both truncate to 6, so
--   - battle_team_score reports a tie (6 vs 6) instead of adults' real
--     0.667-point lead;
--   - trip_battle_win_tally, which never returns that score and only
--     ever compares adults_score >= kids_score / kids_score >=
--     adults_score to decide a win, credits *both* teams for that
--     evening instead of adults alone -- the more consequential half of
--     this bug, since it silently changes the season-long "PĂRINȚI vs
--     COPII" tally, not just a displayed number.
--
-- Fixed by casting the sum operand to numeric before dividing, in both
-- functions, so the division (and everything downstream of it -- the
-- returned score, and the win/loss comparison) happens in numeric
-- arithmetic instead of bigint. The legacy (participant_id is null) path
-- is untouched -- it was never divided in the first place.
--
-- Verified against supabase/tests/battle_scoring_fractional_average.test.sql
-- (adults 20/3 = 6.667 now returned distinctly from kids 30/5 = 6.0, no
-- longer a truncated tie) and a new scenario in the same file for
-- trip_battle_win_tally (a fractional lead too small to survive integer
-- truncation now correctly wins the tally instead of tying it).

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
      then adults_ind_sum::numeric / nullif(adults_ind_count, 0)
      else adults_sum
    end, 0) from agg
  union all
  select 'kids', coalesce(
    case when has_individual
      then kids_ind_sum::numeric / nullif(kids_ind_count, 0)
      else kids_sum
    end, 0) from agg;
$$;

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
      min(bs.created_at) filter (where bs.participant_id is not null) as first_individual_at,
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
          then adults_ind_sum::numeric / nullif(adults_ind_count, 0)
          else adults_sum
        end, 0) as adults_score,
      coalesce(
        case when has_individual
          then kids_ind_sum::numeric / nullif(kids_ind_count, 0)
          else kids_sum
        end, 0) as kids_score
    from battle_agg
    where not has_individual or now() >= first_individual_at + interval '15 minutes'
  )
  select 'adults', count(*) filter (where adults_score >= kids_score) from resolved
  union all
  select 'kids', count(*) filter (where kids_score >= adults_score) from resolved;
$$;

-- Both functions already had these grants from their prior definitions;
-- re-asserted here since create or replace doesn't touch privileges, but
-- there is no harm in being explicit again.
grant execute on function public.battle_team_score(uuid) to anon, authenticated;
grant execute on function public.trip_battle_win_tally(uuid) to anon, authenticated;
