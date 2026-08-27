-- Fixes a second bug in trip_battle_win_tally(), found while verifying
-- "Scor zilnic" against production: it aggregated every battle that had
-- ANY battle_scores rows, with no check on whether that evening's own
-- 15-minute reveal window (see getBattleWindowStatus() in src/lib/
-- battle.ts) had actually closed. The single evening's own score
-- ("Scor zilnic" on the leaderboard) is correctly kept hidden by the app
-- for those 15 minutes so nobody can peek at a partial result while
-- others are still answering -- but the cumulative "Scor total" tally
-- was computed straight from battle_scores with no such gate, so it
-- already counted tonight's (possibly one-answer-old) score as a win the
-- instant the first person answered, leaking the in-progress outcome
-- through a different screen than the one deliberately hiding it.
--
-- Verified on a scratch Postgres: inserting a single battle_scores row
-- (one adult, just answered) flipped the trip tally from 1-1 to 2-1
-- immediately; after this fix the same battle is excluded from the
-- tally until 15 minutes past its first individual answer, matching
-- getBattleWindowStatus()'s own window exactly, then correctly included
-- (2-1) once that time has passed. Legacy (participant_id is null,
-- pre-individual-scoring) battles never had a reveal window -- a team's
-- one-shot controller submission was already final the moment it was
-- submitted -- so they remain counted unconditionally, unchanged.

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
          then adults_ind_sum / nullif(adults_ind_count, 0)
          else adults_sum
        end, 0) as adults_score,
      coalesce(
        case when has_individual
          then kids_ind_sum / nullif(kids_ind_count, 0)
          else kids_sum
        end, 0) as kids_score
    from battle_agg
    where not has_individual or now() >= first_individual_at + interval '15 minutes'
  )
  select 'adults', count(*) filter (where adults_score >= kids_score) from resolved
  union all
  select 'kids', count(*) filter (where kids_score >= adults_score) from resolved;
$$;

grant execute on function public.trip_battle_win_tally(uuid) to anon, authenticated;
