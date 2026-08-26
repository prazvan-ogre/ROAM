-- Product owner requests:
-- 1. A "premiul competiției" field for the new platform-config section of
--    Setări (the renamed Utilizatori tab).
-- 2. Deleting a participant (Setări > Utilizatori now supports edit +
--    delete, not just add) -- same accepted-risk model as the existing
--    insert/update policies on this table (docs/DATABASE.md).
-- 3. The season "PĂRINȚI vs COPII" score is a win tally, not a sum of raw
--    points: each Battle, whichever team's point total is higher gets +1
--    for that evening; a tie gives +1 to both. Complements the existing
--    battle_leaderboard()/trip_battle_leaderboard() (raw point sums, still
--    used for the secondary "puncte acumulate" display).

alter table trips add column prize text;

create policy "anyone can delete a participant" on participants
  for delete using (true);

create or replace function public.trip_battle_win_tally(p_trip_id uuid)
returns table (team text, wins bigint)
language sql
security definer
set search_path = public
as $$
  with battle_totals as (
    select b.id as battle_id,
      coalesce(sum(bs.score) filter (where bs.team = 'adults'), 0) as adults_pts,
      coalesce(sum(bs.score) filter (where bs.team = 'kids'), 0) as kids_pts
    from battles b
    join battle_scores bs on bs.battle_id = b.id
    where b.trip_id = p_trip_id
    group by b.id
  )
  select 'adults', count(*) filter (where adults_pts >= kids_pts) from battle_totals
  union all
  select 'kids', count(*) filter (where kids_pts >= adults_pts) from battle_totals;
$$;

grant execute on function public.trip_battle_win_tally(uuid) to anon, authenticated;
