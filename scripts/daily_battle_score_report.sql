-- Raport: scorul PĂRINȚI vs COPII, zi cu zi, plus totalul cumulat
-- progresiv (câte seri a câștigat fiecare echipă până la finalul acelei
-- zile). Reface exact logica din battle_team_score()/
-- trip_battle_win_tally() (supabase/migrations/
-- 20260827200000_fix_trip_tally_reveal_leak.sql), doar defalcată pe zi
-- în loc de un singur total -- util pentru audit/depanare, nu e apelat
-- de aplicație.
--
-- Schimbă slug-ul de mai jos cu cel al călătoriei tale.

with battle_agg as (
  select
    b.id as battle_id,
    b.day_number,
    b.is_final,
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
  where b.trip_id = (select id from trips where slug = 'kassandra-2026') -- <-- slug-ul călătoriei
  group by b.id, b.day_number, b.is_final
),
resolved as (
  select
    day_number,
    is_final,
    coalesce(
      case when has_individual
        then adults_ind_sum / nullif(adults_ind_count, 0)
        else adults_sum
      end, 0) as adults_score,
    coalesce(
      case when has_individual
        then kids_ind_sum / nullif(kids_ind_count, 0)
        else kids_sum
      end, 0) as kids_score,
    -- Aceeași regulă ca getBattleWindowStatus().visible: o zi fără
    -- scorare individuală (battle vechi) nu are fereastră deloc.
    (not has_individual or now() >= first_individual_at + interval '15 minutes') as revealed
  from battle_agg
),
daily as (
  select
    day_number,
    is_final,
    adults_score,
    kids_score,
    revealed,
    case when revealed and adults_score >= kids_score then 1 else 0 end as adults_win,
    case when revealed and kids_score >= adults_score then 1 else 0 end as kids_win
  from resolved
)
select
  day_number,
  is_final,
  adults_score,
  kids_score,
  revealed,
  adults_win,
  kids_win,
  sum(adults_win) over (order by day_number rows between unbounded preceding and current row) as adults_cumulativ,
  sum(kids_win) over (order by day_number rows between unbounded preceding and current row) as kids_cumulativ
from daily
order by day_number;
