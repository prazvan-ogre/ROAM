-- Batch 2 (2026-09-05 review, R1 continued): battle_team_score(battle_id)
-- and trip_battle_win_tally(trip_id) are SECURITY DEFINER (needed to read
-- battle_scores, which has no general SELECT policy of its own for this
-- aggregate shape) and were `grant execute ... to anon, authenticated`
-- with no authorization check at all -- any caller holding the anon key
-- could pass an arbitrary battle_id/trip_id and read that trip's
-- Parents-vs-Kids result, regardless of whether they belong to it.
-- Low-stakes (aggregate team totals, not personal data), but still
-- exactly the "SECURITY DEFINER bypasses RLS -- add the authorization it
-- skips" gap the review calls out, the same way
-- 20260906120000_atomic_record_battle_answer.sql already had to for
-- record_battle_answer()'s writes.
--
-- Adds the same can_access_trip() gate (verified trip member, or the
-- trip is still entirely legacy) used for extra_assignments/prize_votes/
-- feedback/analytics_events (20260907090000_batch2_trip_activity_rls.sql)
-- -- an unauthorized caller now gets a clear 42501 instead of silently
-- reading another family's score.
--
-- The scoring SQL itself is copied verbatim from
-- 20260906110000_fix_battle_score_fractional_average.sql (the fractional-
-- average fix -- note the `::numeric` cast on the sum operand *before*
-- dividing) -- nothing about the formula changes here, only the
-- authorization wrapped around it (language sql -> plpgsql, to allow the
-- guard clause; DROP+CREATE rather than a bare CREATE OR REPLACE only
-- because PL/pgSQL requires re-declaring the function, not because
-- anything about its signature changes).
drop function if exists public.battle_team_score(uuid);

create function public.battle_team_score(p_battle_id uuid)
returns table (team text, score numeric)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from battles where id = p_battle_id;
  if v_trip_id is null or not can_access_trip(v_trip_id) then
    raise exception 'not authorized to view this battle result' using errcode = '42501';
  end if;

  -- Table-qualified column references throughout (bs.score, bs.team, ...)
  -- are required here (unlike the original `language sql` version): a
  -- PL/pgSQL function's RETURNS TABLE(team, score) declares `team`/`score`
  -- as variables in scope for the whole function body, which would
  -- otherwise shadow battle_scores' own same-named columns and fail with
  -- "column reference is ambiguous".
  return query
  with agg as (
    select
      bool_or(bs.participant_id is not null) as has_individual,
      sum(bs.score) filter (where bs.team = 'adults' and bs.participant_id is not null) as adults_ind_sum,
      count(distinct bs.participant_id) filter (where bs.team = 'adults' and bs.participant_id is not null) as adults_ind_count,
      sum(bs.score) filter (where bs.team = 'kids' and bs.participant_id is not null) as kids_ind_sum,
      count(distinct bs.participant_id) filter (where bs.team = 'kids' and bs.participant_id is not null) as kids_ind_count,
      sum(bs.score) filter (where bs.team = 'adults' and bs.participant_id is null) as adults_sum,
      sum(bs.score) filter (where bs.team = 'kids' and bs.participant_id is null) as kids_sum
    from battle_scores bs
    where bs.battle_id = p_battle_id
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
end;
$$;

grant execute on function public.battle_team_score(uuid) to anon, authenticated;

drop function if exists public.trip_battle_win_tally(uuid);

create function public.trip_battle_win_tally(p_trip_id uuid)
returns table (team text, wins bigint)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if not can_access_trip(p_trip_id) then
    raise exception 'not authorized to view this trip''s battle results' using errcode = '42501';
  end if;

  return query
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
end;
$$;

grant execute on function public.trip_battle_win_tally(uuid) to anon, authenticated;
