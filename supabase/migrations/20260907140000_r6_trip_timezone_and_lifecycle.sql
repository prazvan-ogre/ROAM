-- R6: explicit trip timezone (IANA), and scheduled/active/ended lifecycle
-- enforced server-side in record_answer().
--
-- WHY: trips.start_date is a plain `date` (no time zone), and there was no
-- stored notion of which IANA zone a trip's "today" is computed in. The
-- app (src/lib/trip.ts's currentTripDay) used the DEVICE's local calendar
-- day, clamped into [1, duration_days] -- a trip that hasn't started yet
-- always read as "Day 1" (never "not started"), and a trip past its last
-- day stuck on the final day forever (never "ended"). record_answer()
-- itself already computed a trip day for battle-window eligibility, but
-- from `(now() at time zone 'utc')::date` -- UTC, not the trip's own
-- locale -- and had NO lifecycle gate at all: a scheduled or (worse) an
-- already-ended trip's published questions could still be answered
-- through this RPC indefinitely, including the Final Battle re-opening
-- its team-score window on any later visit.
--
-- HOW: a nullable IANA timezone column on trips, validated at write time
-- against Postgres's own tzdata (is_valid_iana_timezone below).
-- record_answer() now derives "today" from `now() AT TIME ZONE
-- coalesce(trip.timezone, <fallback>)` -- server time is still the only
-- clock ever consulted, exactly as before; only the ZONE that instant is
-- read in changes -- and rejects (raises) a *new* answer attempt on a
-- trip that is not currently 'active'. An idempotent retry of an answer
-- already on record (a lost confirmation right at a day boundary, e.g.)
-- still resolves normally (returns 'already_recorded'/'conflict') even on
-- a scheduled/ended trip -- this only blocks a genuinely new insert, so
-- nothing already answered during the active window ever becomes
-- unreadable once the trip ends.
--
-- FALLBACK FOR EXISTING TRIPS: timezone is added nullable and NOT
-- backfilled onto any existing row -- this is a deliberate product
-- decision, not an oversight (see docs/DATABASE.md and the R6 report for
-- the write-up). ROAM's pilot and every trip drafted so far are
-- Romanian-language ('ro' hardcoded in app/api/trips/create/route.ts)
-- with no other locale in production, so 'Europe/Bucharest' is applied as
-- a RUNTIME fallback only (both here and in src/lib/trip.ts's
-- getTripTimezone) wherever timezone is null -- never written back onto
-- the row, so this stays reversible if a specific trip turns out to need
-- a different zone. Impact on trips already mid-run or already ended
-- under the old UTC-only logic: bounded to the Bucharest/UTC offset
-- (2-3h) right at a day boundary -- flagged for product sign-off, not
-- resolved unilaterally here (see the R6 report's "date vechi" section).
-- Every trip created after this migration (app/api/trips/create/route.ts,
-- same PR) always stamps 'Europe/Bucharest' explicitly at insert time, so
-- this fallback path only ever applies to pre-R6 rows.

-- ---------------------------------------------------------------------
-- IANA validity check, used by the CHECK constraint below. Declared
-- STABLE (not IMMUTABLE, despite being effectively constant for a given
-- input) -- it never reads table data or `now()`, so it's safe to use in
-- a CHECK constraint, without overclaiming the stronger IMMUTABLE
-- guarantee that Postgres does not actually verify itself.
-- ---------------------------------------------------------------------
create or replace function public.is_valid_iana_timezone(tz text)
returns boolean
language plpgsql
stable
as $$
begin
  -- A fixed reference timestamp, not now() -- validity of a zone NAME
  -- doesn't depend on the current time, and this avoids any temptation
  -- for the planner to treat a now()-based check as constant-foldable.
  perform timestamp '2000-01-01 00:00:00' at time zone tz;
  return true;
exception when invalid_parameter_value then
  return false;
end;
$$;

-- ---------------------------------------------------------------------
-- trips.timezone: nullable IANA zone identifier (e.g. 'Europe/Bucharest',
-- 'Europe/Athens'). No default -- a fixed default would silently apply to
-- every future insert that forgets to set it, masking the exact bug this
-- migration exists to fix; app/api/trips/create/route.ts sets it
-- explicitly instead.
-- ---------------------------------------------------------------------
alter table trips add column timezone text;

alter table trips add constraint trips_timezone_valid_iana
  check (timezone is null or public.is_valid_iana_timezone(timezone));

-- ---------------------------------------------------------------------
-- trips_public: append timezone at the end (CREATE OR REPLACE VIEW may
-- only ever append columns, never reorder/remove existing ones) so every
-- ordinary trip read gets it -- the Dashboard, and every Discover/Battle/
-- Final/Catchup page, need it to compute the trip's own local day/window,
-- not the device's.
-- ---------------------------------------------------------------------
create or replace view trips_public as
  select
    id, slug, name, language, start_date, duration_days, destination,
    location_info, content_status, is_active, is_demo, created_at, timezone
  from trips;

-- ---------------------------------------------------------------------
-- record_answer(): timezone-aware trip day + scheduled/ended lifecycle
-- gate. Signature and return type are unchanged (CREATE OR REPLACE keeps
-- the existing grant to anon/authenticated), so no client change is
-- required to pick this up.
-- ---------------------------------------------------------------------
create or replace function public.record_answer(
  p_participant_id uuid,
  p_question_id uuid,
  p_selected_option_id uuid
)
returns record_answer_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant participants;
  v_question questions;
  v_battle battles;
  v_trip trips;
  v_is_correct boolean;
  v_correct_option uuid;
  v_score int;
  v_team battle_team;
  v_response responses;
  v_existing responses;
  v_contributed boolean := false;
  v_first_individual_at timestamptz;
  v_current_trip_day int;
  v_tz text;
  v_today date;
  v_trip_status text;
begin
  if not participant_is_self_or_legacy(p_participant_id) then
    raise exception 'not authorized to submit an answer for this participant' using errcode = '42501';
  end if;

  select * into v_participant from participants where id = p_participant_id;
  if v_participant is null then
    raise exception 'participant not found' using errcode = 'P0002';
  end if;

  select * into v_question from questions where id = p_question_id;
  if v_question is null then
    raise exception 'question not found' using errcode = 'P0002';
  end if;

  if v_question.trip_id is distinct from v_participant.trip_id then
    raise exception 'participant and question belong to different trips' using errcode = '42501';
  end if;

  if not (v_question.verified and v_question.published) then
    raise exception 'question is not available' using errcode = '42501';
  end if;

  select * into v_trip from trips where id = v_question.trip_id;
  if v_trip is null then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  select is_correct into v_is_correct
  from answer_options
  where id = p_selected_option_id and question_id = p_question_id;

  if not found then
    raise exception 'selected option does not belong to this question' using errcode = '22023';
  end if;

  select id into v_correct_option
  from answer_options
  where question_id = p_question_id and is_correct
  limit 1;

  -- R6: the trip's own civil "today", in its own IANA timezone (falling
  -- back to Europe/Bucharest for a pre-R6 trip with no timezone stored --
  -- see this migration's header). Server time (now()) is still the only
  -- clock consulted -- a client can send neither an alternate timestamp
  -- nor an alternate timezone through this RPC, there is no parameter for
  -- either. This is both the lifecycle gate immediately below and the day
  -- number used for battle-window eligibility further down (was UTC-only
  -- before this migration).
  v_tz := coalesce(v_trip.timezone, 'Europe/Bucharest');
  v_today := (now() at time zone v_tz)::date;
  v_current_trip_day := case
    when v_trip.start_date is null then 1
    else (v_today - v_trip.start_date) + 1
  end;
  v_trip_status := case
    when v_trip.start_date is null then 'active'
    when v_current_trip_day < 1 then 'scheduled'
    when v_current_trip_day > v_trip.duration_days then 'ended'
    else 'active'
  end;

  if v_trip_status <> 'active' then
    -- A scheduled/ended trip never accepts a NEW answer -- but an
    -- idempotent retry of an answer already on record (from while the
    -- trip WAS active) still resolves exactly as it would mid-trip, so a
    -- lost-confirmation retry right at the boundary, or simply reopening
    -- an already-answered question after the trip ended, never breaks.
    select * into v_existing from responses
    where participant_id = p_participant_id and question_id = p_question_id;

    if v_existing.id is not null then
      select exists (
        select 1 from battle_scores where response_id = v_existing.id
      ) into v_contributed;

      if v_existing.selected_option_id is not distinct from p_selected_option_id then
        return row('already_recorded', v_existing, v_contributed, v_correct_option)::record_answer_result;
      else
        return row('conflict', v_existing, v_contributed, v_correct_option)::record_answer_result;
      end if;
    end if;

    raise exception 'trip is not currently accepting answers (%)', v_trip_status using errcode = '42501';
  end if;

  v_score := case when v_is_correct then v_question.points else 0 end;
  v_team := case v_participant.role when 'adult'::participant_role then 'adults'::battle_team else 'kids'::battle_team end;

  begin
    insert into responses (participant_id, question_id, selected_option_id, is_correct)
    values (p_participant_id, p_question_id, p_selected_option_id, v_is_correct)
    returning * into v_response;

    if v_question.kind = 'battle'::question_kind and v_question.battle_id is not null then
      select * into v_battle from battles where id = v_question.battle_id;

      select min(created_at) into v_first_individual_at
      from battle_scores
      where battle_id = v_battle.id and participant_id is not null;

      if v_first_individual_at is not null then
        -- A window is already open (or already closed) for this battle:
        -- unchanged 15-minute rule, evaluated against server time.
        v_contributed := now() < v_first_individual_at + interval '15 minutes';
      else
        -- Nobody has answered this battle individually yet. Opening a
        -- fresh window is only allowed on the battle's own scheduled trip
        -- day (Final: on/after the trip's last day) -- unchanged rule,
        -- now evaluated against the trip's own timezone-aware day instead
        -- of a raw UTC date. A recovery answer outside that day still
        -- counts personally (the responses insert above already
        -- happened) but can never open -- or join -- a team window. Note
        -- this can now only ever be reached while v_trip_status = 'active'
        -- (the gate above already rejected anything else), so a Final
        -- Battle genuinely can no longer be re-opened for team credit
        -- after the trip has ended, on any later visit.
        v_contributed := coalesce(
          (v_battle.is_final and v_current_trip_day >= v_trip.duration_days)
          or (not v_battle.is_final and v_current_trip_day = v_battle.day_number),
          false
        );
      end if;

      if v_contributed then
        insert into battle_scores (battle_id, participant_id, team, score, response_id)
        values (v_battle.id, p_participant_id, v_team, v_score, v_response.id);
      end if;
    end if;

    return row('accepted', v_response, v_contributed, v_correct_option)::record_answer_result;

  exception when unique_violation then
    select * into v_existing from responses
    where participant_id = p_participant_id and question_id = p_question_id;

    select exists (
      select 1 from battle_scores where response_id = v_existing.id
    ) into v_contributed;

    if v_existing.selected_option_id is not distinct from p_selected_option_id then
      return row('already_recorded', v_existing, v_contributed, v_correct_option)::record_answer_result;
    else
      return row('conflict', v_existing, v_contributed, v_correct_option)::record_answer_result;
    end if;
  end;
end;
$$;
