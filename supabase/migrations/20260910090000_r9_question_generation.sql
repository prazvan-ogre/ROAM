-- R9: AI-assisted question generation. An admin (or the trip's own
-- creator) can generate a batch of candidate Discover questions from a
-- trip's editorial brief (20260909090000_trip_editorial_brief.sql).
-- Generated content is ALWAYS a draft -- it is never verified/published
-- automatically, and publish_trip() (R7) refuses to publish a trip while
-- any draft still awaits human review. Reviewing (accepting, optionally
-- with edits, or rejecting) a draft IS the human verification step this
-- schema already requires for every other question -- see "Content
-- integrity" in docs/DATABASE.md -- there is no separate, later
-- Supabase-Studio-flip step for generated content the way seeded content
-- still needs one.
--
-- SCOPE (see the R9 report for the full justification): this batch
-- generates DISCOVER questions only (kind = 'discover', single_choice).
-- Battle-question generation would need a further, unspecified product
-- decision about auto-creating/attaching `battles` rows and is left out
-- entirely rather than guessed at -- "elimină orice funcționalitate ...
-- care nu este necesară". A generated question's "type" field from the
-- request's schema list maps to `slot` (morning/lunch) here, since
-- `kind` itself is fixed for this batch and slot is the only other
-- Discover-shape discriminator.
--
-- WHY TWO TABLES, NOT ONE: `trip_question_generation_runs` is the async
-- JOB (one call to the AI provider, one row, tracks status/who/when/how
-- many) -- exactly the concept `trips.content_status`'s existing
-- 'generating'/'failed' states already exist for for and, before this
-- migration, nothing ever actually used. `trip_generated_question_drafts`
-- is the CONTENT that job proposed -- one row per candidate question,
-- reviewed individually. Splitting them keeps "is a job running"
-- (checked on every brief save / generation start / publish attempt) a
-- cheap single-row lookup, independent of how many draft rows exist.
--
-- WHY REUSE trips.content_status FOR THE JOB STATE, NOT A NEW COLUMN:
-- the product request explicitly asks for exactly the four states R7
-- already defined on trips.content_status ("stare clară: pending,
-- generating, ready sau failed") -- "Folosește stările existente ale
-- pipeline-ului". This migration is the first thing that actually
-- transitions a trip INTO 'generating'/'failed' (R7 only ever defined
-- those values; public trip creation and R7 itself never set them).
-- 'ready' is still set ONLY by publish_trip() -- generation success
-- returns content_status to 'pending' (drafts exist, awaiting review),
-- never to 'ready' -- see "Relația cu R7" in the R9 report.
--
-- WHY NOT A GENERIC "content draft" SYSTEM: this batch has exactly one
-- draftable content shape (a Discover question) -- the same "no generic
-- mechanism, no versioning system" posture the editorial-brief migration
-- already took, for the same reason (nothing else needs one yet).
--
-- CONCURRENCY: start_trip_question_generation() takes the SAME
-- `select ... for update` lock on `trips` that publish_trip() and
-- save_trip_editorial_brief() already take, so "start a generation run",
-- "save the brief", and "publish the trip" are all mutually exclusive
-- for a given trip -- whichever call's transaction commits first is the
-- one that actually happens. A concurrent second "start" request sees
-- content_status = 'generating' (or the just-committed 'pending'/'ready')
-- and returns the CURRENT state instead of starting a second job; a
-- unique partial index (below) makes "at most one in-flight run per
-- trip" a real constraint, not just an application-level convention.
--
-- WHY A BRIEF CHANGE INVALIDATES OLD DRAFTS: a brief can only be edited
-- while content_status <> 'generating' (save_trip_editorial_brief's own
-- existing check), so it can never change mid-run -- but it CAN change
-- after a run finishes, before its drafts are reviewed. A successful
-- save_trip_editorial_brief() call (extended here) marks every still-
-- 'pending_review' draft for that trip 'invalidated' -- a distinct
-- terminal status from 'rejected' (an admin's own decision) purely for
-- audit clarity. accept_generated_question_draft() ALSO independently
-- re-checks the draft's own brief_version against the trip's current one
-- at accept time, as defense-in-depth against the same race
-- save_trip_editorial_brief/publish_trip already guard against via the
-- shared row lock.
--
-- AUTHORIZATION: every RPC below is reachable only via the service-role
-- key (revoked from anon/authenticated/PUBLIC) -- the Next.js routes
-- re-derive "is this caller the trip's creator or an admin" themselves,
-- via the existing src/lib/security/tripAuthorAccess.ts (the exact same
-- check the editorial brief routes already use), never a client-supplied
-- flag. Participants never reach any of this: both new tables carry RLS
-- enabled with ZERO anon/authenticated policies, same posture as
-- trip_editorial_briefs/creator_accounts.

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type generated_question_status as enum ('pending_review', 'accepted', 'rejected', 'invalidated');
create type question_theme_category as enum ('history', 'places', 'food', 'curiosities');
create type question_source as enum ('manual', 'generated', 'edited');
create type generation_run_status as enum ('generating', 'succeeded', 'failed');

-- ---------------------------------------------------------------------
-- questions: three new, nullable-by-default columns so every existing
-- (manual/seeded) row stays exactly as valid as it already was --
-- theme_category/difficulty are simply unset for content this batch
-- never touches, and `source` defaults to 'manual' (correct for every
-- row that predates this migration, and for anything hand-authored
-- going forward).
-- ---------------------------------------------------------------------
alter table questions
  add column theme_category question_theme_category,
  add column difficulty trip_difficulty,
  add column source question_source not null default 'manual';

-- ---------------------------------------------------------------------
-- trip_question_generation_runs: one row per generation attempt.
-- ---------------------------------------------------------------------
create table trip_question_generation_runs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  requested_by_account_id uuid not null references creator_accounts (id),
  -- trip_editorial_briefs.updated_at at the moment this run started --
  -- the "which brief version was used" half of the audit trail, and
  -- what each of this run's own drafts compares against at accept time.
  brief_version timestamptz not null,
  requested_count smallint not null check (requested_count between 1 and 10),
  status generation_run_status not null default 'generating',
  error_message text,
  draft_count smallint not null default 0,
  rejected_count smallint not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index trip_question_generation_runs_trip_id_idx on trip_question_generation_runs (trip_id);

-- At most one IN-FLIGHT run per trip -- a real database-level guarantee
-- under the shared trips row lock above, not just an application-level
-- convention. A finished run (status <> 'generating') is unlimited --
-- history is kept, never deleted.
create unique index trip_question_generation_runs_one_active_per_trip
  on trip_question_generation_runs (trip_id)
  where status = 'generating'::generation_run_status;

alter table trip_question_generation_runs enable row level security;
-- No anon/authenticated policies -- operator/audit data, never shown to
-- a participant, reachable only via the service-role key after the
-- Next.js route's own creator-or-admin check.

-- ---------------------------------------------------------------------
-- trip_generated_question_drafts: one row per candidate question a run
-- proposed. Never deleted (not even once accepted/rejected) -- the
-- audit trail this batch's request explicitly asks for.
-- ---------------------------------------------------------------------
create table trip_generated_question_drafts (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  generation_run_id uuid not null references trip_question_generation_runs (id) on delete cascade,
  brief_version timestamptz not null,
  day_number int not null check (day_number > 0),
  slot question_slot not null,
  theme_category question_theme_category not null,
  difficulty trip_difficulty not null,
  prompt text not null check (btrim(prompt) <> '' and char_length(prompt) <= 500),
  explanation text not null check (btrim(explanation) <> '' and char_length(explanation) <= 400),
  -- [{ "label": text, "is_correct": boolean }, ...]. A CHECK constraint
  -- cannot contain a subquery in Postgres (even one that only reads this
  -- same row's own jsonb column), so "exactly one correct option" is
  -- NOT expressible here -- it is validated in TypeScript before a
  -- draft is ever inserted (src/lib/generatedQuestions.ts), and
  -- re-validated procedurally inside accept_generated_question_draft()
  -- below (the actual authoritative choke point, since accepting is
  -- what turns this into a real, published question). This CHECK only
  -- guards the shape a subquery-free expression CAN verify.
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6),
  status generated_question_status not null default 'pending_review',
  edited boolean not null default false,
  resulting_question_id uuid references questions (id) on delete set null,
  accepted_by_account_id uuid references creator_accounts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index trip_generated_question_drafts_trip_id_idx on trip_generated_question_drafts (trip_id);
create index trip_generated_question_drafts_run_id_idx on trip_generated_question_drafts (generation_run_id);

alter table trip_generated_question_drafts enable row level security;
-- No anon/authenticated policies -- drafts are never shown to a
-- participant (product requirement: "Participanții nu pot vedea
-- drafturi sau rezultatele intermediare"), reachable only via the
-- service-role key after the same creator-or-admin check.

-- ---------------------------------------------------------------------
-- start_trip_question_generation: atomically claims the right to run a
-- generation job for a trip, or reports why it can't. Returns the run
-- row on ('started'|'already_running'); null on every rejection.
-- ---------------------------------------------------------------------
create type start_generation_result as (
  status text,
  run trip_question_generation_runs
);

create or replace function public.start_trip_question_generation(
  p_trip_id uuid,
  p_account_id uuid,
  p_requested_count smallint
)
returns start_generation_result
language plpgsql
as $$
declare
  v_status trip_content_status;
  v_brief_updated_at timestamptz;
  v_running trip_question_generation_runs;
  v_last_started_at timestamptz;
  v_last_status generation_run_status;
  v_cooldown constant interval := interval '30 seconds';
  -- Generous margin over the provider call's own timeout
  -- (AI_TIMEOUT_MS = 45s in src/lib/ai/questionGenerationProvider.ts)
  -- plus request/route overhead -- if a run is still 'generating' past
  -- this, the request that started it almost certainly crashed or was
  -- killed (a Vercel function timeout, a dropped connection) before it
  -- could ever call finish_trip_question_generation() itself. Without
  -- this, such a trip would be stuck in 'generating' forever -- "Eșecul
  -- trebuie să lase trip-ul într-o stare recuperabilă" (the product
  -- request's own words). Reclaiming marks the abandoned run 'failed'
  -- and falls through to start a fresh one in the same call -- one
  -- click both recovers and retries. Accepted, documented edge case: if
  -- the original request was merely SLOW rather than dead and later
  -- completes, its own drafts still insert fine and stay fully
  -- reviewable -- only that original run row's own status/draft_count
  -- bookkeeping stays at 'failed' rather than reflecting them (finish_
  -- trip_question_generation's idempotent guard no-ops for an already-
  -- finished run by design, see that function's own header).
  v_stale_threshold constant interval := interval '3 minutes';
  v_run trip_question_generation_runs;
begin
  -- Same lock publish_trip()/save_trip_editorial_brief() take on the
  -- same row -- this is what actually makes "start generation", "save
  -- the brief", and "publish" mutually exclusive for one trip, not just
  -- the status checks below on their own.
  select content_status into v_status from trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  if v_status = 'ready'::trip_content_status then
    return row('already_published', null)::start_generation_result;
  end if;

  if v_status = 'generating'::trip_content_status then
    select * into v_running from trip_question_generation_runs
      where trip_id = p_trip_id and status = 'generating'::generation_run_status
      limit 1;
    if v_running.id is not null and now() - v_running.started_at <= v_stale_threshold then
      return row('already_running', v_running)::start_generation_result;
    end if;
    -- Stale (or, defensively, no matching row at all) -- reclaim and
    -- fall through to start a fresh run below.
    if v_running.id is not null then
      update trip_question_generation_runs set
        status = 'failed'::generation_run_status,
        error_message = 'Generation timed out or was interrupted before it could complete.',
        finished_at = now()
      where id = v_running.id;
    end if;
    v_status := 'failed'::trip_content_status;
    update trips set content_status = v_status where id = p_trip_id;
  end if;

  select updated_at into v_brief_updated_at from trip_editorial_briefs where trip_id = p_trip_id;
  if v_brief_updated_at is null then
    return row('no_brief', null)::start_generation_result;
  end if;

  -- A simple, real rate limit: at most one generation attempt per trip
  -- every v_cooldown, independent of how many concurrent requests arrive
  -- -- protects against a mis-click or a rapid-fire loop hammering the
  -- AI provider, not meant as the only abuse control this feature will
  -- ever need. Deliberately does NOT apply when the most recent attempt
  -- FAILED: "Retry-ul ... după eșec" (the product request's own words)
  -- must be immediate, not gated behind the same cooldown meant for
  -- rapid successful-start spam -- a legitimate failure (a provider
  -- timeout, an invalid response) should be retriable right away.
  select started_at, status into v_last_started_at, v_last_status from trip_question_generation_runs
    where trip_id = p_trip_id order by started_at desc limit 1;
  if v_last_started_at is not null
    and v_last_status <> 'failed'::generation_run_status
    and now() - v_last_started_at < v_cooldown
  then
    return row('rate_limited', null)::start_generation_result;
  end if;

  update trips set content_status = 'generating'::trip_content_status where id = p_trip_id;

  insert into trip_question_generation_runs (
    trip_id, requested_by_account_id, brief_version, requested_count
  ) values (
    p_trip_id, p_account_id, v_brief_updated_at, p_requested_count
  ) returning * into v_run;

  return row('started', v_run)::start_generation_result;
end;
$$;

revoke execute on function public.start_trip_question_generation(uuid, uuid, smallint) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- finish_trip_question_generation: called once the AI provider call
-- (and per-item validation) has actually completed, success or not.
-- Idempotent -- finishing an already-finished run is a safe no-op.
-- ---------------------------------------------------------------------
create or replace function public.finish_trip_question_generation(
  p_run_id uuid,
  p_success boolean,
  p_error_message text,
  p_draft_count smallint,
  p_rejected_count smallint
)
returns trip_question_generation_runs
language plpgsql
as $$
declare
  v_trip_id uuid;
  v_run trip_question_generation_runs;
begin
  select trip_id into v_trip_id from trip_question_generation_runs where id = p_run_id;
  if not found then
    raise exception 'generation run not found' using errcode = 'P0002';
  end if;

  -- Same lock as start_trip_question_generation -- flipping
  -- content_status back off 'generating' is exactly as sensitive as
  -- setting it, and must serialize against a concurrent publish/brief-
  -- save/second-start attempt the same way.
  perform 1 from trips where id = v_trip_id for update;

  select * into v_run from trip_question_generation_runs where id = p_run_id;
  if v_run.status <> 'generating'::generation_run_status then
    -- Already finished (a retried finish call, or a rare double-invoke)
    -- -- report the current state rather than finishing it a second time.
    return v_run;
  end if;

  update trip_question_generation_runs set
    status = case when p_success then 'succeeded' else 'failed' end::generation_run_status,
    error_message = p_error_message,
    draft_count = coalesce(p_draft_count, 0),
    rejected_count = coalesce(p_rejected_count, 0),
    finished_at = now()
  where id = p_run_id
  returning * into v_run;

  update trips set
    content_status = case when p_success then 'pending' else 'failed' end::trip_content_status
  where id = v_trip_id;

  return v_run;
end;
$$;

revoke execute on function public.finish_trip_question_generation(uuid, boolean, text, smallint, smallint) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- accept_generated_question_draft: promotes ONE draft into a real,
-- verified+published `questions`/`answer_options` row -- the human
-- review step. Accepts optional edited field overrides (still validated
-- exactly as strictly as newly-generated content); passing back the
-- draft's own original values with p_edited = false is a plain accept.
-- ---------------------------------------------------------------------
create type accept_generated_draft_result as (
  status text,
  draft trip_generated_question_drafts,
  question_id uuid
);

create or replace function public.accept_generated_question_draft(
  p_draft_id uuid,
  p_account_id uuid,
  p_prompt text,
  p_explanation text,
  p_options jsonb,
  p_theme_category question_theme_category,
  p_difficulty trip_difficulty,
  p_day_number int,
  p_slot question_slot,
  p_edited boolean
)
returns accept_generated_draft_result
language plpgsql
as $$
declare
  v_draft trip_generated_question_drafts;
  v_trip trips;
  v_brief_updated_at timestamptz;
  v_correct_count int;
  v_question_id uuid;
  v_order int;
  v_option jsonb;
begin
  select * into v_draft from trip_generated_question_drafts where id = p_draft_id for update;
  if not found then
    return row('not_found', null, null)::accept_generated_draft_result;
  end if;
  if v_draft.status <> 'pending_review'::generated_question_status then
    return row('already_processed', v_draft, v_draft.resulting_question_id)::accept_generated_draft_result;
  end if;

  -- Same trips row lock every other content-mutating function in this
  -- pipeline takes -- an accept can never land between a publish and
  -- its own validation, or vice versa.
  select * into v_trip from trips where id = v_draft.trip_id for update;

  if v_trip.content_status = 'ready'::trip_content_status then
    return row('trip_published', v_draft, null)::accept_generated_draft_result;
  end if;

  select updated_at into v_brief_updated_at from trip_editorial_briefs where trip_id = v_draft.trip_id;
  if v_brief_updated_at is null or v_brief_updated_at <> v_draft.brief_version then
    return row('stale_brief', v_draft, null)::accept_generated_draft_result;
  end if;

  if btrim(p_prompt) = '' or char_length(p_prompt) > 500 then
    return row('invalid', v_draft, null)::accept_generated_draft_result;
  end if;
  if btrim(p_explanation) = '' or char_length(p_explanation) > 400 then
    return row('invalid', v_draft, null)::accept_generated_draft_result;
  end if;
  if p_day_number < 1 or p_day_number > v_trip.duration_days then
    return row('invalid', v_draft, null)::accept_generated_draft_result;
  end if;
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) < 2 or jsonb_array_length(p_options) > 6 then
    return row('invalid', v_draft, null)::accept_generated_draft_result;
  end if;
  select count(*) into v_correct_count
    from jsonb_array_elements(p_options) o
    where (o->>'is_correct')::boolean;
  if v_correct_count <> 1 then
    return row('invalid', v_draft, null)::accept_generated_draft_result;
  end if;
  if (select count(distinct btrim(o->>'label')) from jsonb_array_elements(p_options) o) <> jsonb_array_length(p_options) then
    return row('invalid', v_draft, null)::accept_generated_draft_result;
  end if;

  insert into questions (
    trip_id, kind, day_number, slot, prompt, question_type,
    correct_reveal_message, theme_category, difficulty, source,
    verified, published
  ) values (
    v_draft.trip_id, 'discover'::question_kind, p_day_number, p_slot, p_prompt, 'single_choice'::question_type_enum,
    p_explanation, p_theme_category, p_difficulty, case when p_edited then 'edited' else 'generated' end::question_source,
    true, true
  ) returning id into v_question_id;

  v_order := 0;
  for v_option in select * from jsonb_array_elements(p_options) loop
    insert into answer_options (question_id, order_index, label, is_correct)
    values (v_question_id, v_order, btrim(v_option->>'label'), (v_option->>'is_correct')::boolean);
    v_order := v_order + 1;
  end loop;

  update trip_generated_question_drafts set
    status = 'accepted'::generated_question_status,
    edited = p_edited,
    resulting_question_id = v_question_id,
    accepted_by_account_id = p_account_id,
    updated_at = now()
  where id = p_draft_id
  returning * into v_draft;

  return row('accepted', v_draft, v_question_id)::accept_generated_draft_result;
end;
$$;

revoke execute on function public.accept_generated_question_draft(
  uuid, uuid, text, text, jsonb, question_theme_category, trip_difficulty, int, question_slot, boolean
) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- reject_generated_question_draft: the admin explicitly doesn't want
-- this candidate. Never deletes the row -- audit trail.
-- ---------------------------------------------------------------------
create or replace function public.reject_generated_question_draft(p_draft_id uuid)
returns trip_generated_question_drafts
language plpgsql
as $$
declare
  v_draft trip_generated_question_drafts;
begin
  select * into v_draft from trip_generated_question_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  if v_draft.status = 'pending_review'::generated_question_status then
    update trip_generated_question_drafts set status = 'rejected'::generated_question_status, updated_at = now()
      where id = p_draft_id
      returning * into v_draft;
  end if;
  return v_draft;
end;
$$;

revoke execute on function public.reject_generated_question_draft(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- save_trip_editorial_brief: re-defined (signature unchanged, so the
-- revoke from 20260909090000_trip_editorial_brief.sql still applies) to
-- add exactly one thing -- a successful save invalidates any draft still
-- awaiting review for this trip, since it was generated against
-- preferences that no longer hold. See this migration's own header for
-- why this is the primary UX signal (accept_generated_question_draft's
-- own brief_version check above is the defense-in-depth backstop, not
-- the main path).
-- ---------------------------------------------------------------------
create or replace function public.save_trip_editorial_brief(
  p_trip_id uuid,
  p_difficulty trip_difficulty,
  p_style trip_question_style,
  p_narrator_character_name text,
  p_theme_history smallint,
  p_theme_places smallint,
  p_theme_food smallint,
  p_theme_curiosities smallint
)
returns save_editorial_brief_result
language plpgsql
as $$
declare
  v_status trip_content_status;
  v_brief trip_editorial_briefs;
begin
  select content_status into v_status from trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  if v_status = 'ready'::trip_content_status then
    return row('rejected_published', null)::save_editorial_brief_result;
  end if;
  if v_status = 'generating'::trip_content_status then
    return row('rejected_generating', null)::save_editorial_brief_result;
  end if;

  insert into trip_editorial_briefs (
    trip_id, difficulty, style, narrator_character_name,
    theme_history, theme_places, theme_food, theme_curiosities, updated_at
  ) values (
    p_trip_id, p_difficulty, p_style, p_narrator_character_name,
    p_theme_history, p_theme_places, p_theme_food, p_theme_curiosities, now()
  )
  on conflict (trip_id) do update set
    difficulty = excluded.difficulty,
    style = excluded.style,
    narrator_character_name = excluded.narrator_character_name,
    theme_history = excluded.theme_history,
    theme_places = excluded.theme_places,
    theme_food = excluded.theme_food,
    theme_curiosities = excluded.theme_curiosities,
    updated_at = now()
  returning * into v_brief;

  -- R9: this save just made every not-yet-reviewed draft's own
  -- captured brief_version stale -- mark them so, rather than leaving
  -- them silently unacceptable until someone tries.
  update trip_generated_question_drafts set
    status = 'invalidated'::generated_question_status,
    updated_at = now()
  where trip_id = p_trip_id and status = 'pending_review'::generated_question_status;

  return row('saved', v_brief)::save_editorial_brief_result;
end;
$$;

revoke execute on function public.save_trip_editorial_brief(
  uuid, trip_difficulty, trip_question_style, text, smallint, smallint, smallint, smallint
) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- validate_trip_content: re-defined (signature unchanged, existing
-- revoke from R7 still applies) to add exactly one more check -- a trip
-- with any draft still awaiting review can never publish. This is
-- STRUCTURAL only ("has every draft been resolved"), never a claim that
-- generated content's difficulty/tone/facts were verified -- that
-- remains a human judgment call, made exactly by accepting/editing/
-- rejecting each draft.
-- ---------------------------------------------------------------------
create or replace function public.validate_trip_content(p_trip_id uuid)
returns table (
  check_key text,
  severity text,
  message text,
  day_number int,
  entity_id uuid
)
language plpgsql
stable
as $$
declare
  v_trip trips;
  v_min_duration constant int := 3;  -- mirrors src/lib/constants.ts's
  v_max_duration constant int := 10; -- MIN/MAX_TRIP_DURATION_DAYS
  v_issues content_validation_issue[];
  v_error_count int;
begin
  select * into v_trip from trips where id = p_trip_id;
  if v_trip is null then
    return query select 'trip.not_found'::text, 'error'::text, 'Trip not found.'::text, null::int, p_trip_id;
    return;
  end if;

  v_issues := array(
    select row(x.check_key, x.severity, x.message, x.day_number, x.entity_id)::content_validation_issue
    from (
      -- ===================================================================
      -- A. Trip
      -- ===================================================================
      select 'trip.name_missing' check_key, 'error' severity, 'Trip has no name.' message, null::int day_number, p_trip_id entity_id
      where v_trip.name is null or btrim(v_trip.name) = ''
      union all
      select 'trip.destination_missing', 'error', 'Trip has no destination.', null::int, p_trip_id
      where v_trip.destination is null or btrim(v_trip.destination) = ''
      union all
      select 'trip.timezone_missing', 'error', 'Trip has no timezone set.', null::int, p_trip_id
      where v_trip.timezone is null
      union all
      select 'trip.timezone_invalid', 'error', format('Timezone "%s" is not a valid IANA identifier.', v_trip.timezone), null::int, p_trip_id
      where v_trip.timezone is not null and not is_valid_iana_timezone(v_trip.timezone)
      union all
      select 'trip.start_date_missing', 'error', 'Trip has no start date.', null::int, p_trip_id
      where v_trip.start_date is null
      union all
      select 'trip.duration_days_out_of_range', 'error',
        format('duration_days (%s) must be between %s and %s.', v_trip.duration_days, v_min_duration, v_max_duration),
        null::int, p_trip_id
      where v_trip.duration_days < v_min_duration or v_trip.duration_days > v_max_duration

      -- ===================================================================
      -- B. Discover -- every day 1..duration_days needs a published+
      -- verified Morning and Lunch question; every discover question
      -- that DOES exist (in or out of range) must itself be sound.
      -- ===================================================================
      union all
      select 'discover.missing', 'error', 'No Morning Discover question for this day.', d.day, null::uuid
      from generate_series(1, greatest(v_trip.duration_days, 0)) as d(day)
      where not exists (
        select 1 from questions q
        where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind and q.day_number = d.day and q.slot = 'morning'::question_slot
      )
      union all
      select 'discover.not_published', 'error', 'Morning Discover question exists but is not verified+published.', d.day, null::uuid
      from generate_series(1, greatest(v_trip.duration_days, 0)) as d(day)
      where exists (
        select 1 from questions q
        where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind and q.day_number = d.day and q.slot = 'morning'::question_slot
      ) and not exists (
        select 1 from questions q
        where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind and q.day_number = d.day and q.slot = 'morning'::question_slot
          and q.verified and q.published
      )
      union all
      select 'discover.missing', 'error', 'No Lunch Discover question for this day.', d.day, null::uuid
      from generate_series(1, greatest(v_trip.duration_days, 0)) as d(day)
      where not exists (
        select 1 from questions q
        where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind and q.day_number = d.day and q.slot = 'lunch'::question_slot
      )
      union all
      select 'discover.not_published', 'error', 'Lunch Discover question exists but is not verified+published.', d.day, null::uuid
      from generate_series(1, greatest(v_trip.duration_days, 0)) as d(day)
      where exists (
        select 1 from questions q
        where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind and q.day_number = d.day and q.slot = 'lunch'::question_slot
      ) and not exists (
        select 1 from questions q
        where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind and q.day_number = d.day and q.slot = 'lunch'::question_slot
          and q.verified and q.published
      )
      union all
      select 'discover.prompt_missing', 'error', 'Discover question has an empty prompt.', q.day_number, q.id
      from questions q where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind and (q.prompt is null or btrim(q.prompt) = '')
      union all
      select 'discover.published_without_verification', 'error', 'Discover question is published but not verified.', q.day_number, q.id
      from questions q where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind and q.published and not q.verified
      union all
      select 'discover.insufficient_options', 'error', 'Discover question needs at least 2 answer options.', q.day_number, q.id
      from questions q
      where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind
        and q.question_type in ('single_choice'::question_type_enum, 'multi_choice'::question_type_enum)
        and (select count(*) from answer_options ao where ao.question_id = q.id) < 2
      union all
      select 'discover.correct_option_count', 'error',
        format('single_choice Discover question must have exactly 1 correct option (has %s).',
          (select count(*) from answer_options ao where ao.question_id = q.id and ao.is_correct)),
        q.day_number, q.id
      from questions q
      where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind and q.question_type = 'single_choice'::question_type_enum
        and (select count(*) from answer_options ao where ao.question_id = q.id and ao.is_correct) <> 1
      union all
      select 'discover.points_invalid', 'error', 'Discover question points must be positive.', q.day_number, q.id
      from questions q where q.trip_id = p_trip_id and q.kind = 'discover'::question_kind and q.points <= 0

      -- ===================================================================
      -- C. Battle -- every day 1..(duration_days-1) needs exactly one
      -- active daily Battle with at least one question; exactly one
      -- active Final Battle exists for the trip (matching getFinalBattle()'s
      -- own match-on-is_final-alone behavior, regardless of its
      -- day_number); every battle question is sound and actually
      -- belongs to a battle on the SAME trip.
      -- ===================================================================
      union all
      select 'battle.daily_missing', 'error', 'No active daily Battle for this day.', d.day, null::uuid
      from generate_series(1, greatest(v_trip.duration_days - 1, 0)) as d(day)
      where not exists (select 1 from battles b where b.trip_id = p_trip_id and b.is_final = false and b.is_active and b.day_number = d.day)
      union all
      select 'battle.multiple_active_for_day', 'error', 'More than one active daily Battle for this day (ambiguous).', d.day, null::uuid
      from generate_series(1, greatest(v_trip.duration_days - 1, 0)) as d(day)
      where (select count(*) from battles b where b.trip_id = p_trip_id and b.is_final = false and b.is_active and b.day_number = d.day) > 1
      union all
      select 'battle.daily_empty', 'error', 'Daily Battle for this day has no questions.', d.day, null::uuid
      from generate_series(1, greatest(v_trip.duration_days - 1, 0)) as d(day)
      where exists (select 1 from battles b where b.trip_id = p_trip_id and b.is_final = false and b.is_active and b.day_number = d.day)
        and not exists (
          select 1 from battles b join questions q on q.battle_id = b.id
          where b.trip_id = p_trip_id and b.is_final = false and b.is_active and b.day_number = d.day
        )
      union all
      select 'battle.final_missing', 'error', 'No active Final Battle for this trip.', null::int, null::uuid
      where (select count(*) from battles b where b.trip_id = p_trip_id and b.is_final and b.is_active) = 0
      union all
      select 'battle.multiple_final', 'error', 'More than one active Final Battle for this trip (ambiguous).', null::int, null::uuid
      where (select count(*) from battles b where b.trip_id = p_trip_id and b.is_final and b.is_active) > 1
      union all
      select 'battle.final_empty', 'error', 'The active Final Battle has no questions.', null::int, null::uuid
      where (select count(*) from battles b where b.trip_id = p_trip_id and b.is_final and b.is_active) = 1
        and not exists (
          select 1 from battles b join questions q on q.battle_id = b.id where b.trip_id = p_trip_id and b.is_final and b.is_active
        )
      union all
      select 'battle.not_published', 'error', 'Daily Battle has a question that is not verified+published.', b.day_number, b.id
      from battles b
      where b.trip_id = p_trip_id and b.is_final = false and b.is_active
        and b.day_number between 1 and greatest(v_trip.duration_days - 1, 0)
        and exists (select 1 from questions q where q.battle_id = b.id and not (q.verified and q.published))
      union all
      select 'battle.not_published', 'error', 'Final Battle has a question that is not verified+published.', null::int, b.id
      from battles b
      where b.trip_id = p_trip_id and b.is_final and b.is_active
        and exists (select 1 from questions q where q.battle_id = b.id and not (q.verified and q.published))
      union all
      select 'battle.question_trip_mismatch', 'error', 'Battle question belongs to a battle on a different trip.', q.day_number, q.id
      from questions q join battles b on b.id = q.battle_id
      where q.trip_id = p_trip_id and q.kind = 'battle'::question_kind and b.trip_id <> p_trip_id
      union all
      select 'battle.duplicate_order_index', 'error', 'Two or more questions in the same Battle share an order_index (non-deterministic order).', b.day_number, b.id
      from battles b
      where b.trip_id = p_trip_id
        and (select count(*) from questions q where q.battle_id = b.id) <> (select count(distinct q.order_index) from questions q where q.battle_id = b.id)
      union all
      select 'battle.prompt_missing', 'error', 'Battle question has an empty prompt.', q.day_number, q.id
      from questions q where q.trip_id = p_trip_id and q.kind = 'battle'::question_kind and (q.prompt is null or btrim(q.prompt) = '')
      union all
      select 'battle.published_without_verification', 'error', 'Battle question is published but not verified.', q.day_number, q.id
      from questions q where q.trip_id = p_trip_id and q.kind = 'battle'::question_kind and q.published and not q.verified
      union all
      select 'battle.insufficient_options', 'error', 'Battle question needs at least 2 answer options.', q.day_number, q.id
      from questions q
      where q.trip_id = p_trip_id and q.kind = 'battle'::question_kind
        and q.question_type in ('single_choice'::question_type_enum, 'multi_choice'::question_type_enum)
        and (select count(*) from answer_options ao where ao.question_id = q.id) < 2
      union all
      select 'battle.correct_option_count', 'error',
        format('single_choice Battle question must have exactly 1 correct option (has %s).',
          (select count(*) from answer_options ao where ao.question_id = q.id and ao.is_correct)),
        q.day_number, q.id
      from questions q
      where q.trip_id = p_trip_id and q.kind = 'battle'::question_kind and q.question_type = 'single_choice'::question_type_enum
        and (select count(*) from answer_options ao where ao.question_id = q.id and ao.is_correct) <> 1
      union all
      select 'battle.points_invalid', 'error', 'Battle question points must be positive.', q.day_number, q.id
      from questions q where q.trip_id = p_trip_id and q.kind = 'battle'::question_kind and q.points <= 0

      -- ===================================================================
      -- D. Extras and links
      -- ===================================================================
      union all
      select 'extra.type_missing', 'error', 'Published Extra has no extra_type set.', e.day_number, e.id
      from extras e where e.trip_id = p_trip_id and e.published and e.extra_type is null
      union all
      select 'extra.published_without_verification', 'error', 'Extra is published but not verified.', e.day_number, e.id
      from extras e where e.trip_id = p_trip_id and e.published and not e.verified
      union all
      select 'extra.trip_mismatch', 'error', 'Extra references a question on a different trip.', e.day_number, e.id
      from extras e join questions q on q.id = e.question_id
      where e.trip_id = p_trip_id and q.trip_id <> p_trip_id
      union all
      select 'link.invalid_url', 'error', 'Explore link URL is not http(s).', null::int, l.id
      from explore_links l where l.trip_id = p_trip_id and l.url !~* '^https?://'
      union all
      select 'link.trip_mismatch', 'error', 'Explore link references an Extra on a different trip.', null::int, l.id
      from explore_links l join extras e on e.id = l.extra_id
      where l.trip_id = p_trip_id and e.trip_id <> p_trip_id
      union all
      select 'link.trip_mismatch', 'error', 'Explore link references a question on a different trip.', null::int, l.id
      from explore_links l join questions q on q.id = l.question_id
      where l.trip_id = p_trip_id and q.trip_id <> p_trip_id

      -- ===================================================================
      -- E. Prize -- a real vote needs at least 2 options, unless the
      -- trip documents a fixed, non-voted prize instead (the legacy
      -- `trips.prize` free-text column -- superseded as the DEFAULT
      -- mechanism by the prize_options vote, per seed.sql's own header,
      -- but still a valid documented "no vote for this trip" declaration
      -- when explicitly set).
      -- ===================================================================
      union all
      select 'prize.not_configured', 'error',
        'No prize vote configured (fewer than 2 prize_options) and no fixed trip.prize documented instead.',
        null::int, p_trip_id
      where (select count(*) from prize_options po where po.trip_id = p_trip_id) < 2
        and (v_trip.prize is null or btrim(v_trip.prize) = '')

      -- ===================================================================
      -- F. Editorial brief -- structural only (see this migration's own
      -- header for why this is the ONLY brief-related check, and why it
      -- can never actually fire through the normal write path).
      -- ===================================================================
      union all
      select 'brief.narrator_name_missing', 'error',
        'Editorial brief style is narrated_by_character but no character name is set.', null::int, p_trip_id
      from trip_editorial_briefs b
      where b.trip_id = p_trip_id and b.style = 'narrated_by_character'::trip_question_style
        and (b.narrator_character_name is null or btrim(b.narrator_character_name) = '')

      -- ===================================================================
      -- G. AI-assisted question generation (R9) -- structural only, same
      -- posture as section F: this never claims to verify a generated
      -- question's difficulty/tone/facts, only that every candidate has
      -- actually been reviewed (accepted, edited-then-accepted, or
      -- rejected) by a human before the trip can publish.
      -- ===================================================================
      union all
      select 'generation.review_pending', 'error',
        format('%s generated question(s) still await review (accept, edit, or reject) before this trip can be published.',
          (select count(*) from trip_generated_question_drafts d where d.trip_id = p_trip_id and d.status = 'pending_review'::generated_question_status)),
        null::int, p_trip_id
      where exists (
        select 1 from trip_generated_question_drafts d
        where d.trip_id = p_trip_id and d.status = 'pending_review'::generated_question_status
      )
    ) as x
  );

  v_error_count := (select count(*) from unnest(v_issues) i where (i).severity = 'error');

  if v_trip.content_status = 'ready'::trip_content_status and v_error_count > 0 then
    v_issues := v_issues || array[
      row(
        'trip.content_status_inconsistent', 'error',
        format('content_status is ''ready'' but validation found %s error(s).', v_error_count),
        null::int, p_trip_id
      )::content_validation_issue
    ];
  end if;

  return query select (i).check_key, (i).severity, (i).message, (i).day_number, (i).entity_id from unnest(v_issues) as i;
end;
$$;

-- Already revoked for validate_trip_content in 20260908090000_r7_content_
-- publishing_pipeline.sql -- `create or replace function` above keeps the
-- signature identical, so that revoke (and every existing grant/caller)
-- is unaffected; nothing to repeat here.
