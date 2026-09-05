-- R1 (2026-09-05 architecture/security review): replaces client-asserted
-- identifiers as the trust boundary for participant/activity data with a
-- real, verifiable Supabase Auth session, and scopes access to a trip's
-- own members instead of every device on the internet.
--
-- WHY: participants/responses/battle_scores had `using (true)` policies
-- (see 20260825090100_activity_tables.sql, 20260825120000_profiles_and_
-- content_model.sql, 20260825140000_feedback_form.sql) -- any anon-key
-- request could read or write any family's data, because Postgres had no
-- per-request identity to scope by at all. device_id is a plain string
-- the client sets itself; it was never a credential, just a convenient
-- label.
--
-- HOW: every device now signs in anonymously (supabase.auth.
-- signInAnonymously(), src/lib/device.ts) before creating its first
-- participant, giving Postgres a real auth.uid() to check. New nullable
-- participants.auth_user_id records which auth identity created a given
-- participant row -- nullable and NOT backfilled for existing rows: this
-- migration cannot know which auth identity (if any) a pre-existing
-- participant belongs to, and this batch deliberately does not
-- auto-claim old rows onto a newly-asserted identity (that would be
-- exactly the "trust a public identifier" mistake this migration fixes).
-- A child's profile is created under the very same auth session as the
-- managing adult (same device, same signInAnonymously() call, exactly
-- parity with how device_id was already shared) -- no per-child sign-in,
-- no registration form, ever.
--
-- GRANDFATHERING (explicit product-decision default, see PR description
-- -- flagged there as needing sign-off, not a unilateral call): a row
-- with auth_user_id still null (created before this migration, or by a
-- client that hasn't deployed the signInAnonymously() change yet) keeps
-- exactly its old, fully-open behavior. Only a row that HAS an
-- auth_user_id gets the new, real per-owner/per-trip-member
-- restriction. This means a still-legacy participant remains visible/
-- writable by anyone, same as today -- a known, temporary gap, not a
-- silent regression, until a hard-cutover decision is made and existing
-- trips have had a chance to re-establish sessions.
--
-- SCOPE: only `participants`, `responses` and `battle_scores` are
-- tightened this batch (the review's own examples: "child profiles and
-- answers are also readable"). `extra_assignments`, `prize_votes`,
-- `feedback` and `analytics_events` are NOT touched here -- still
-- `using (true)` as before, explicitly left for a follow-up batch (see
-- PR description "remaining verification limits").

-- ---------------------------------------------------------------------
-- Identity: link a participant to the auth session that created it.
-- ---------------------------------------------------------------------
alter table participants
  add column auth_user_id uuid references auth.users (id) on delete set null;

create index participants_auth_user_id_idx on participants (auth_user_id);

-- ---------------------------------------------------------------------
-- Helpers (SECURITY DEFINER so they can read `participants` themselves
-- without recursing back into the very policies that call them).
-- ---------------------------------------------------------------------

-- Is the caller a member (any participant, adult or child) of this trip?
-- Legacy participants (auth_user_id is null) don't make anyone a
-- "member" via this check -- they only grandfather their *own* row's
-- direct access, not other members' visibility of the trip.
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from participants
    where trip_id = p_trip_id
      and auth_user_id is not null
      and auth_user_id = auth.uid()
  );
$$;

-- Is the caller either this exact participant (their own row), or is
-- this a legacy row that grandfathers open access?
create or replace function public.participant_is_self_or_legacy(p_participant_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select auth_user_id is null or auth_user_id = auth.uid()
     from participants where id = p_participant_id),
    false
  );
$$;

grant execute on function public.is_trip_member(uuid) to anon, authenticated;
grant execute on function public.participant_is_self_or_legacy(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- participants: replace blanket `using (true)` with membership/self
-- checks, grandfathering legacy (auth_user_id is null) rows exactly as
-- open as they are today.
-- ---------------------------------------------------------------------
drop policy if exists "participants are publicly readable" on participants;
drop policy if exists "anyone can join as a participant" on participants;
drop policy if exists "anyone can update participant heartbeat/name" on participants;
drop policy if exists "anyone can delete a participant" on participants;

create policy "trip members (or legacy rows) can read participants" on participants
  for select using (
    auth_user_id is null or is_trip_member(trip_id)
  );

-- A participant row can only ever be inserted claiming the inserting
-- session's own identity -- you cannot create a profile "as" someone
-- else's auth_user_id. A child's row is inserted under the managing
-- adult's own session, so this is the same auth_user_id as the adult,
-- not a separate identity.
create policy "a session can only create participants for itself" on participants
  for insert with check (auth_user_id = auth.uid());

create policy "a session can update its own (or a legacy) participant" on participants
  for update using (participant_is_self_or_legacy(id))
  with check (participant_is_self_or_legacy(id));

create policy "a session can delete its own (or a legacy) participant" on participants
  for delete using (participant_is_self_or_legacy(id));

-- ---------------------------------------------------------------------
-- responses: same shape -- read within the trip, write only as self.
-- ---------------------------------------------------------------------
drop policy if exists "responses are publicly readable" on responses;
drop policy if exists "anyone can submit a response" on responses;

create policy "trip members (or legacy participants) can read responses" on responses
  for select using (
    participant_is_self_or_legacy(participant_id)
    or is_trip_member((select trip_id from questions where id = responses.question_id))
  );

create policy "a session can submit a response only as its own participant" on responses
  for insert with check (participant_is_self_or_legacy(participant_id));

-- ---------------------------------------------------------------------
-- battle_scores: same shape. Legacy (participant_id is null,
-- pre-individual-scoring) rows have no participant to check against --
-- they stay readable/insertable exactly as before (has no bearing on
-- any specific person's data, only an aggregate team submission).
-- ---------------------------------------------------------------------
drop policy if exists "battle scores are publicly readable" on battle_scores;
drop policy if exists "anyone can submit a battle score" on battle_scores;

create policy "trip members (or legacy rows) can read battle scores" on battle_scores
  for select using (
    participant_id is null
    or participant_is_self_or_legacy(participant_id)
    or is_trip_member((select trip_id from battles where id = battle_scores.battle_id))
  );

create policy "a session can submit a battle score only as its own participant" on battle_scores
  for insert with check (
    participant_id is null or participant_is_self_or_legacy(participant_id)
  );
