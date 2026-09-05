-- Batch 2 (2026-09-05 review, R1 continued): tightens the four activity
-- tables R1 (20260906090000_auth_ownership.sql) explicitly deferred --
-- "extra_assignments, prize_votes, feedback and analytics_events are NOT
-- touched here -- still using (true) as before, explicitly left for a
-- follow-up batch". All four still had blanket `using (true)`/
-- `with check (true)` policies (extra_assignments/prize_votes readable
-- *and* writable by anyone; feedback/analytics_events write-only by
-- anyone) -- any anon-key request could read or write any family's
-- assigned Extras, prize votes, or feedback, or spam analytics events
-- into any trip, the exact same "device_id/participant_id was never a
-- credential" problem R1 fixed for participants/responses/battle_scores.
--
-- Same trust model as R1: scope to trip membership via `is_trip_member`/
-- `participant_is_self_or_legacy` (already SECURITY DEFINER helpers from
-- 20260906090000_auth_ownership.sql), with the same legacy-row
-- grandfathering (a trip that still has no non-legacy member at all
-- keeps today's fully-open behavior for these four tables too, since
-- there is no verified identity yet to scope by) -- see that migration's
-- own comments for the full grandfathering rationale, unchanged here.
--
-- New helper `can_access_trip(trip_id)` factors out "verified member of
-- this trip, or this trip is still entirely legacy" -- the same
-- disjunction `is_trip_member(trip_id) or auth_user_id is null`-shaped
-- checks would otherwise repeat across all four tables below (none of
-- which have a single participant row to point `participant_is_self_or_
-- legacy` at the way participants/responses/battle_scores do).
create or replace function public.can_access_trip(p_trip_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select is_trip_member(p_trip_id)
    or exists (select 1 from participants where trip_id = p_trip_id and auth_user_id is null);
$$;

grant execute on function public.can_access_trip(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- extra_assignments: getOrAssignExtra() (src/lib/discover.ts) reads
-- every eligible Extra's assignment *count* across all of a trip's
-- participants to load-balance a new assignment -- not just the calling
-- participant's own row -- so SELECT has to stay trip-wide, not
-- self-only. Write (insert a new assignment, update its viewed/
-- completed status) stays scoped to the caller's own participant.
-- ---------------------------------------------------------------------
drop policy if exists "extra assignments are publicly readable" on extra_assignments;
drop policy if exists "anyone can record an extra assignment" on extra_assignments;
drop policy if exists "anyone can update their assignment status" on extra_assignments;

create policy "trip members (or legacy trips) can read extra assignments" on extra_assignments
  for select using (
    can_access_trip((select trip_id from participants where id = extra_assignments.participant_id))
  );

create policy "a session can record its own extra assignment" on extra_assignments
  for insert with check (
    participant_is_self_or_legacy(participant_id)
  );

create policy "a session can update only its own extra assignment" on extra_assignments
  for update using (
    participant_is_self_or_legacy(participant_id)
  ) with check (
    participant_is_self_or_legacy(participant_id)
  );

-- ---------------------------------------------------------------------
-- prize_votes: getPrizeStatus() (src/lib/prize.ts) reads every vote for
-- a trip to tally the winner -- trip-wide SELECT, same reasoning as
-- extra_assignments above. A vote can only ever be cast as the caller's
-- own participant, and only under the trip that participant actually
-- belongs to (closes the "cast a vote with someone else's participant_id,
-- or attribute my vote to a different trip's option" gap the old
-- `with check (true)` left wide open).
-- ---------------------------------------------------------------------
drop policy if exists "prize_votes are publicly readable" on prize_votes;
drop policy if exists "anyone can cast a prize vote" on prize_votes;

create policy "trip members (or legacy trips) can read prize votes" on prize_votes
  for select using (can_access_trip(trip_id));

create policy "a session can cast a prize vote only as its own participant" on prize_votes
  for insert with check (
    participant_is_self_or_legacy(participant_id)
    and trip_id = (select trip_id from participants where id = prize_votes.participant_id)
  );

-- ---------------------------------------------------------------------
-- feedback: insert-only, same as before (nothing reads it back through
-- the anon key -- the client tracks "already submitted" itself). Now
-- requires the caller to actually be a member of the trip it's filing
-- feedback for, and -- when a participant_id is given -- that it's the
-- caller's own (or a legacy row).
-- ---------------------------------------------------------------------
drop policy if exists "anyone can submit feedback" on feedback;

create policy "a trip member can submit feedback for its own participant" on feedback
  for insert with check (
    can_access_trip(trip_id)
    and (participant_id is null or participant_is_self_or_legacy(participant_id))
  );

-- ---------------------------------------------------------------------
-- analytics_events: insert-only, same shape as feedback. Low-stakes
-- telemetry (trackEvent() already swallows failures, "must never break
-- the product flow"), but there is no reason to let an arbitrary anon
-- request spam events into a trip it has no session on at all.
-- ---------------------------------------------------------------------
drop policy if exists "anyone can record an analytics event" on analytics_events;

create policy "a trip member can record its own analytics event" on analytics_events
  for insert with check (
    can_access_trip(trip_id)
    and (participant_id is null or participant_is_self_or_legacy(participant_id))
  );
