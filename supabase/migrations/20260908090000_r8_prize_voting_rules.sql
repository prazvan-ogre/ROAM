-- R8: prize voting, made a real product-defined contract instead of an
-- open-ended "12h after the first vote" window computed entirely on the
-- client.
--
-- WHY: the previous design (prize_vote migration, 20260826130000) had no
-- server-side concept of "voting is closed" at all -- prize_votes' own
-- insert policy was `with check (true)` (batch 2 tightened it to
-- "caller's own participant, same trip" but still never checked the
-- OPTION belonged to that trip -- a vote could be cast for a different
-- trip's prize_options row), and getPrizeStatus() (src/lib/prize.ts)
-- computed "closes 12h after the first vote, winner = most votes, ties
-- broken by order_index" ENTIRELY on every read, client-side. That has
-- two real bugs baked in: (1) a trip with zero votes never closes at all
-- (closesAt/winner stay null forever -- nothing ever announces a prize
-- if nobody votes), and (2) nothing stops the winner from being
-- RECOMPUTED differently on two different reads once a random tie-break
-- is introduced (the whole point of this batch) -- two family members
-- opening the app moments apart could see two different "winners" if
-- ties were broken by anything non-deterministic computed on each read.
--
-- HOW: two new SQL functions, both SECURITY DEFINER, granted to anon/
-- authenticated (same trust model as record_answer -- a participant's own
-- verified anonymous session, never an admin check):
--   - cast_prize_vote(participant_id, prize_option_id): the only way to
--     write prize_votes now (its old anon/authenticated insert policy is
--     dropped below). Atomic and idempotent, same retry contract as
--     record_answer: 'recorded' (new), 'already_recorded' (idempotent
--     retry of the same choice), 'conflict' (a DIFFERENT choice than
--     what's already on record -- rejected, the original stands),
--     'voting_closed' (a genuinely new vote attempted after the closing
--     instant), 'invalid_option' (the option doesn't exist or belongs to
--     a different trip), 'not_configured' (fewer than 2 valid options
--     exist for this trip -- see the constraints below).
--   - get_prize_status(trip_id): read path. Voting closes at the END OF
--     THE TRIP'S FIRST DAY, in the trip's own destination timezone (the
--     same "trip's own IANA zone, never the device's" rule R6 already
--     established for the calendar -- prize_voting_closes_at below is
--     exactly the same day-1/day-2 boundary record_answer() computes for
--     trip-day rollover, just read once instead of on every call). Once
--     that instant has passed and no result is stored yet, this function
--     resolves the winner ONCE (locking the trip row, so it can never run
--     concurrently with a vote still being cast for the same trip -- see
--     below) and PERSISTS it in the new prize_results table; every later
--     call, by anyone, returns that same stored row -- never recomputed,
--     so a random tie-break can never re-roll on a later read.
--
-- CONCURRENCY: both functions take `select ... for update` on the trip's
-- own `trips` row before doing anything vote-count-sensitive (same
-- pattern publish_trip already uses for a trip's content_status). This
-- makes "cast a vote" and "resolve the result" mutually exclusive for a
-- given trip: whichever transaction acquires the lock first fully
-- commits (or rolls back) before the other can even read the closing
-- time/vote counts, so a vote can never be simultaneously accepted as
-- open by one side and excluded from the tally by the other. Two
-- concurrent votes from two different participants are simply two
-- separate lock-acquire/release cycles -- neither blocks on the other's
-- own participant_id, only on both briefly locking the same trip row in
-- turn -- so ordinary concurrent voting is unaffected; only the boundary
-- between "still voting" and "already resolving" is serialized.
--
-- TIE-BREAK: "random, but controlled and testable" (product requirement)
-- is implemented as a deterministic hash order, never Postgres's own
-- random()/session RNG state: among the options tied for the most votes,
-- the winner is whichever has the lowest md5(trip_id || ':' || option_id)
-- value. This is fully reproducible from the trip id and the tied option
-- ids alone (a test can compute the same value independently and assert
-- the exact expected winner), looks arbitrary to a human (nothing about
-- an option's title/order/created_at predicts it), and needs no session-
-- level state that could interact badly with the FOR UPDATE locking
-- above.
--
-- CONSTRAINTS: prize_options gets two new constraints (title can't be
-- blank; title must be unique per trip) enforcing "distinct, non-null
-- options" at the row level. "At least two options" (also a product
-- requirement) is NOT a row-level CHECK -- Postgres can't count sibling
-- rows in one -- it's enforced where it actually matters instead: both
-- RPCs below treat a trip with fewer than 2 valid options as
-- "not_configured", never silently running a real vote/resolution against
-- a single (or zero) option set. The real Kassandra 2026 seed data
-- already has 3 distinct, non-blank titles -- unaffected by either new
-- constraint.

-- ---------------------------------------------------------------------
-- prize_options: enforce "distinct, non-null" at the row level.
-- ---------------------------------------------------------------------
alter table prize_options
  add constraint prize_options_title_not_blank check (btrim(title) <> '');

alter table prize_options
  add constraint prize_options_unique_title_per_trip unique (trip_id, title);

-- ---------------------------------------------------------------------
-- prize_results: one row per trip, written exactly once by
-- get_prize_status() below (never by anon/authenticated directly -- no
-- insert/update/delete policy at all, same "reachable only through the
-- owning SECURITY DEFINER function" pattern as responses/battle_scores
-- since record_answer_authoritative.sql). Once a row exists for a trip,
-- that IS the trip's prize result, permanently -- nothing in this app
-- ever updates or deletes one.
-- ---------------------------------------------------------------------
create type prize_resolution_method as enum ('plurality', 'tie_break_random', 'no_votes_default');

create table prize_results (
  trip_id uuid primary key references trips (id) on delete cascade,
  winner_option_id uuid not null references prize_options (id),
  resolution_method prize_resolution_method not null,
  resolved_at timestamptz not null default now()
);

alter table prize_results enable row level security;

create policy "trip members (or legacy trips) can read prize results" on prize_results
  for select using (can_access_trip(trip_id));

-- ---------------------------------------------------------------------
-- prize_votes: the old fully-open (batch 2: trip-scoped but still
-- direct-insert) policy is replaced by cast_prize_vote() below, the only
-- way to write this table from anon/authenticated from here on -- it
-- performs every check the old policy did (own participant, same trip)
-- PLUS the ones it never could as a bare RLS `with check` (the option
-- belongs to the same trip; voting hasn't closed; fewer than 2 options
-- configured never counts as a real vote).
-- ---------------------------------------------------------------------
drop policy if exists "a session can cast a prize vote only as its own participant" on prize_votes;

-- ---------------------------------------------------------------------
-- Shared closing-time computation -- exactly the day-1/day-2 boundary
-- record_answer() already computes for trip-day rollover
-- (20260907140000_r6_trip_timezone_and_lifecycle.sql), factored out here
-- so cast_prize_vote/get_prize_status can't independently drift out of
-- sync with each other (or with the calendar day logic itself) the way
-- record_answer's UTC-only day computation once drifted from the
-- device-local one it replaced. `timestamp at time zone tz` on a plain
-- `date` treats the date as midnight WALL-CLOCK time in `tz` and returns
-- the UTC instant that actually is -- exactly "the end of day 1, in the
-- trip's own zone". Null only when the trip has no start_date at all (no
-- schedule to enforce -- same "permanently active" fallback
-- getTripTemporalState/record_answer already use for that case).
-- ---------------------------------------------------------------------
create or replace function public.prize_voting_closes_at(p_trip_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select case
    when t.start_date is null then null
    else (t.start_date + 1)::timestamp at time zone coalesce(t.timezone, 'Europe/Bucharest')
  end
  from trips t
  where t.id = p_trip_id;
$$;

create type prize_vote_status as enum (
  'recorded', 'already_recorded', 'conflict', 'voting_closed', 'invalid_option', 'not_configured'
);

create type cast_prize_vote_result as (
  status prize_vote_status,
  vote prize_votes
);

create or replace function public.cast_prize_vote(
  p_participant_id uuid,
  p_prize_option_id uuid
)
returns cast_prize_vote_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant participants;
  v_option prize_options;
  v_trip trips;
  v_option_count int;
  v_closes_at timestamptz;
  v_existing prize_votes;
  v_vote prize_votes;
begin
  if not participant_is_self_or_legacy(p_participant_id) then
    raise exception 'not authorized to vote for this participant' using errcode = '42501';
  end if;

  select * into v_participant from participants where id = p_participant_id;
  if v_participant is null then
    raise exception 'participant not found' using errcode = 'P0002';
  end if;

  -- Rule: at least 2 distinct, non-null options must exist before a vote
  -- means anything -- checked live (not just at authoring time), so a
  -- trip that somehow regresses below 2 configured options never accepts
  -- a vote it can't meaningfully resolve later.
  select count(*) into v_option_count from prize_options where trip_id = v_participant.trip_id;
  if v_option_count < 2 then
    return row('not_configured', null)::cast_prize_vote_result;
  end if;

  select * into v_option from prize_options where id = p_prize_option_id;
  if v_option is null or v_option.trip_id is distinct from v_participant.trip_id then
    -- Covers both "no such option" and "that option belongs to a
    -- different trip" -- the exact cross-trip vote this batch closes off
    -- (the old RLS `with check` never verified this at all).
    return row('invalid_option', null)::cast_prize_vote_result;
  end if;

  -- Locks the trip row for the rest of this call -- see this migration's
  -- header for why this is what actually makes voting/resolution mutually
  -- exclusive, not just the closing-time check on its own.
  select * into v_trip from trips where id = v_participant.trip_id for update;
  if v_trip is null then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  v_closes_at := prize_voting_closes_at(v_trip.id);

  if v_closes_at is not null and now() >= v_closes_at then
    -- Voting is closed -- but an idempotent retry of a vote already on
    -- record (a lost confirmation right at the boundary) still resolves
    -- exactly as it would have moments earlier; only a genuinely NEW vote
    -- is rejected. Mirrors record_answer's own scheduled/ended handling.
    select * into v_existing from prize_votes where participant_id = p_participant_id;
    if v_existing.id is not null then
      if v_existing.prize_option_id = p_prize_option_id then
        return row('already_recorded', v_existing)::cast_prize_vote_result;
      else
        return row('conflict', v_existing)::cast_prize_vote_result;
      end if;
    end if;
    return row('voting_closed', null)::cast_prize_vote_result;
  end if;

  begin
    insert into prize_votes (trip_id, prize_option_id, participant_id)
    values (v_participant.trip_id, p_prize_option_id, p_participant_id)
    returning * into v_vote;
    return row('recorded', v_vote)::cast_prize_vote_result;
  exception when unique_violation then
    -- prize_votes' own unique(participant_id): a second, distinct INSERT
    -- attempt for a participant who already has a vote on record --
    -- reconciled the same way as the closed-voting branch above (same
    -- option = idempotent retry, different option = rejected conflict).
    -- Rule 3 ("once cast, a vote can never be changed or withdrawn")
    -- holds here regardless of whether voting is still open.
    select * into v_existing from prize_votes where participant_id = p_participant_id;
    if v_existing.prize_option_id = p_prize_option_id then
      return row('already_recorded', v_existing)::cast_prize_vote_result;
    else
      return row('conflict', v_existing)::cast_prize_vote_result;
    end if;
  end;
end;
$$;

grant execute on function public.cast_prize_vote(uuid, uuid) to anon, authenticated;

create type prize_status_result as (
  configured boolean,
  voting_open boolean,
  closes_at timestamptz,
  winner_option_id uuid,
  resolution_method prize_resolution_method
);

create or replace function public.get_prize_status(p_trip_id uuid)
returns prize_status_result
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip trips;
  v_result prize_results;
  v_option_count int;
  v_closes_at timestamptz;
  v_max_votes int;
  v_tied_count int;
  v_winner_id uuid;
  v_method prize_resolution_method;
begin
  select * into v_trip from trips where id = p_trip_id;
  if v_trip is null then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  -- Already resolved -- the stored result IS the answer, forever. Never
  -- recomputed: a random tie-break must never re-roll on a later read,
  -- and a late joiner (rule: "sees the winning prize directly") gets
  -- exactly the same value everyone else already saw.
  select * into v_result from prize_results where trip_id = p_trip_id;
  if v_result.trip_id is not null then
    return row(true, false, null::timestamptz, v_result.winner_option_id, v_result.resolution_method)::prize_status_result;
  end if;

  select count(*) into v_option_count from prize_options where trip_id = p_trip_id;
  if v_option_count < 2 then
    return row(false, false, null::timestamptz, null::uuid, null::prize_resolution_method)::prize_status_result;
  end if;

  v_closes_at := prize_voting_closes_at(p_trip_id);

  if v_closes_at is null or now() < v_closes_at then
    return row(true, true, v_closes_at, null::uuid, null::prize_resolution_method)::prize_status_result;
  end if;

  -- Past closing time, not yet resolved -- resolve now. Locks the trip
  -- row (the identical lock cast_prize_vote takes), then re-checks under
  -- that lock in case a concurrent caller resolved it a moment ago
  -- (double-checked locking -- avoids two callers both computing/
  -- inserting a result for the same trip).
  select * into v_trip from trips where id = p_trip_id for update;

  select * into v_result from prize_results where trip_id = p_trip_id;
  if v_result.trip_id is not null then
    return row(true, false, null::timestamptz, v_result.winner_option_id, v_result.resolution_method)::prize_status_result;
  end if;

  select max(cnt) into v_max_votes
  from (
    select count(*) as cnt from prize_votes where trip_id = p_trip_id group by prize_option_id
  ) counts;

  if v_max_votes is null or v_max_votes = 0 then
    -- Zero votes: the first configured option wins, by the stable
    -- configuration order (order_index, then created_at as a tiebreak for
    -- two options sharing an order_index).
    select id into v_winner_id from prize_options
    where trip_id = p_trip_id
    order by order_index asc, created_at asc
    limit 1;
    v_method := 'no_votes_default';
  else
    select count(*) into v_tied_count
    from (
      select prize_option_id from prize_votes
      where trip_id = p_trip_id
      group by prize_option_id
      having count(*) = v_max_votes
    ) tied;

    select po.id into v_winner_id
    from prize_options po
    left join prize_votes pv on pv.prize_option_id = po.id
    where po.trip_id = p_trip_id
    group by po.id
    having count(pv.id) = v_max_votes
    order by md5(p_trip_id::text || ':' || po.id::text) asc
    limit 1;

    v_method := case when v_tied_count > 1 then 'tie_break_random' else 'plurality' end;
  end if;

  insert into prize_results (trip_id, winner_option_id, resolution_method)
  values (p_trip_id, v_winner_id, v_method)
  returning * into v_result;

  return row(true, false, null::timestamptz, v_result.winner_option_id, v_result.resolution_method)::prize_status_result;
end;
$$;

grant execute on function public.get_prize_status(uuid) to anon, authenticated;
