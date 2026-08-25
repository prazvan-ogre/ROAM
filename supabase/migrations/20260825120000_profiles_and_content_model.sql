-- Extends the initial schema with the actual product model from the ROAM
-- Track A spec: child profiles managed by an adult, the full Discover
-- content shape (slot, Common Core, One Thing, reveal-message pools,
-- sources, verified/published gating), and richer Extras (type/audience).
--
-- Also relaxes RLS on `responses` and `extra_assignments` to add SELECT:
-- the spec requires progress ("Discover completion per profile", "same
-- profile sees the same assigned Extra on reopen") to survive a refresh,
-- which is impossible without reading a device's own prior writes back.
-- Same accepted-risk model as `participants` (docs/DATABASE.md): device_id
-- is client-asserted, not a credential, so this is technically browsable
-- by a determined user who already has another participant's id -- not
-- exposed by the UI, and an accepted tradeoff for a private pilot.

-- ---------------------------------------------------------------------
-- participants: child profiles are managed by an adult participant, not
-- their own device. The adult participant *is* the "adult profile" (per
-- spec section 4.1); a child profile is just another participants row
-- with role='child' and managed_by_participant_id set.
-- ---------------------------------------------------------------------
alter table participants
  add column age smallint,
  add column managed_by_participant_id uuid references participants (id) on delete cascade;

-- NOT VALID: skips checking pre-existing rows (safe against whatever
-- test data already exists) while still enforcing for every future
-- insert/update. Only relevant if the table is non-empty at apply time.
alter table participants
  add constraint child_needs_manager
    check (role <> 'child' or managed_by_participant_id is not null)
    not valid;

create index participants_managed_by_idx on participants (managed_by_participant_id);

-- Child rows share their managing adult's device_id (a child has no
-- device/session of its own), so the original "one row per device"
-- constraint can only apply to adult rows.
alter table participants drop constraint participants_trip_id_device_id_key;
create unique index participants_one_adult_per_device
  on participants (trip_id, device_id)
  where role = 'adult';

-- Child profiles insert through the existing "anyone can join as a
-- participant" policy -- no separate policy needed.

-- ---------------------------------------------------------------------
-- questions: add the full Discover/Battle content shape.
-- ---------------------------------------------------------------------
alter table questions
  add column slot text check (slot in ('morning', 'lunch')),
  add column common_core text,
  add column one_thing text,
  add column correct_reveal_message text,
  add column alternative_reveal_message text,
  add column sources jsonb not null default '[]'::jsonb,
  add column verified boolean not null default false,
  add column published boolean not null default false;

-- NOT VALID: the previous seed content was 'discover'-kind with no slot
-- (the column didn't exist yet), so validating against it here would
-- fail. seed.sql replaces that content in the same pass anyway.
alter table questions
  add constraint discover_needs_slot
    check (kind <> 'discover' or slot is not null)
    not valid;

-- Content integrity (spec section 13): unverified/unpublished content
-- must never be served to participants. Replaces the earlier blanket
-- "publicly readable" policy.
drop policy if exists "questions are publicly readable" on questions;
create policy "published and verified questions are publicly readable" on questions
  for select using (verified and published);

-- answer_options has no verified/published of its own -- it inherits its
-- parent question's gate.
drop policy if exists "answer_options are publicly readable" on answer_options;
create policy "options for published questions are publicly readable" on answer_options
  for select using (
    exists (
      select 1 from questions q
      where q.id = answer_options.question_id
        and q.verified and q.published
    )
  );

-- ---------------------------------------------------------------------
-- extras: add type/audience/sources/verified/published.
-- ---------------------------------------------------------------------
alter table extras
  add column question_id uuid references questions (id) on delete cascade,
  add column extra_type text check (extra_type in ('know', 'think', 'connect', 'ask', 'explore')),
  add column audience text not null default 'all' check (audience in ('all', 'adult', 'child')),
  add column sources jsonb not null default '[]'::jsonb,
  add column verified boolean not null default false,
  add column published boolean not null default false;

create index extras_question_id_idx on extras (question_id);

drop policy if exists "extras are publicly readable" on extras;
create policy "published and verified extras are publicly readable" on extras
  for select using (verified and published);

-- ---------------------------------------------------------------------
-- explore_links: a rabbit hole can be attached directly to a Discover
-- question, not only to an Extra.
-- ---------------------------------------------------------------------
alter table explore_links
  add column question_id uuid references questions (id) on delete cascade;

create index explore_links_question_id_idx on explore_links (question_id);

-- ---------------------------------------------------------------------
-- responses / extra_assignments: allow a device to read back its own
-- prior activity so completion state survives a refresh (see header).
-- ---------------------------------------------------------------------
create policy "responses are publicly readable" on responses
  for select using (true);

create policy "extra assignments are publicly readable" on extra_assignments
  for select using (true);

-- ---------------------------------------------------------------------
-- Trip-level Parents-vs-Kids tally (spec section 17: "PĂRINȚI 2 — COPII
-- 1" is cumulative across every Battle in the trip, not per-battle).
-- Complements the existing per-battle battle_leaderboard().
-- ---------------------------------------------------------------------
create or replace function public.trip_battle_leaderboard(p_trip_id uuid)
returns table (team text, total_score bigint)
language sql
security definer
set search_path = public
as $$
  select bs.team, coalesce(sum(bs.score), 0) as total_score
  from battle_scores bs
  join battles b on b.id = bs.battle_id
  where b.trip_id = p_trip_id and bs.team is not null
  group by bs.team;
$$;

grant execute on function public.trip_battle_leaderboard(uuid) to anon, authenticated;
