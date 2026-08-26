-- Product owner spec: every participant now answers Battle questions
-- individually (not one submission per team via a shared "controller"
-- device). To stay fair when team sizes are unequal, a team's score for
-- a battle is the arithmetic mean of its members' points (not the raw
-- sum): sum(correct-answer points) / count(distinct participants who
-- answered). The team with the higher average gets +1 in the
-- season-long win tally; a tie gives +1 to both, same rule as before.
--
-- battle_scores.participant_id already existed (nullable, unused by the
-- old team-submission flow) -- this migration starts using it. Rows
-- from before this change have participant_id = null: those evenings
-- keep their original sum-based result (their historical outcome
-- shouldn't retroactively change), while any battle with at least one
-- participant-scoped row uses the new average. The app never writes a
-- null-participant row anymore, so a battle is in exactly one mode.
--
-- battle_leaderboard()/trip_battle_leaderboard() (raw point sums) are
-- dropped: battle_team_score() below replaces battle_leaderboard()'s
-- role (now hybrid sum/average), and trip_battle_win_tally() is the one
-- number now shown everywhere "the total score" is needed -- nothing
-- needs a trip-wide raw sum anymore.

drop function if exists public.battle_leaderboard(uuid);
drop function if exists public.trip_battle_leaderboard(uuid);

create or replace function public.battle_team_score(p_battle_id uuid)
returns table (team text, score numeric)
language sql
security definer
set search_path = public
as $$
  with agg as (
    select
      bool_or(participant_id is not null) as has_individual,
      avg(score) filter (where team = 'adults' and participant_id is not null) as adults_avg,
      avg(score) filter (where team = 'kids' and participant_id is not null) as kids_avg,
      sum(score) filter (where team = 'adults' and participant_id is null) as adults_sum,
      sum(score) filter (where team = 'kids' and participant_id is null) as kids_sum
    from battle_scores
    where battle_id = p_battle_id
  )
  select 'adults', coalesce(case when has_individual then adults_avg else adults_sum end, 0) from agg
  union all
  select 'kids', coalesce(case when has_individual then kids_avg else kids_sum end, 0) from agg;
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
      avg(bs.score) filter (where bs.team = 'adults' and bs.participant_id is not null) as adults_avg,
      avg(bs.score) filter (where bs.team = 'kids' and bs.participant_id is not null) as kids_avg,
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
      coalesce(case when has_individual then adults_avg else adults_sum end, 0) as adults_score,
      coalesce(case when has_individual then kids_avg else kids_sum end, 0) as kids_score
    from battle_agg
  )
  select 'adults', count(*) filter (where adults_score >= kids_score) from resolved
  union all
  select 'kids', count(*) filter (where kids_score >= adults_score) from resolved;
$$;
