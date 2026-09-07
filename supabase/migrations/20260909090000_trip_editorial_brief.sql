-- Trip editorial brief: the creator (or an admin) records difficulty,
-- thematic distribution, and writing style preferences for a trip's
-- content, BEFORE that content is drafted. This is not itself content --
-- it is a small, structured brief a human content preparer (today) and
-- an eventual AI generator (a later batch, explicitly out of scope here)
-- read before writing/drafting questions. See docs/DATABASE.md for the
-- full contract and exactly where a future generator would read this
-- from.
--
-- WHY A DEDICATED TABLE, NOT COLUMNS ON `trips`: this is optional,
-- mutable, editorial-preference metadata -- conceptually separate from a
-- trip's own identity/schedule columns, exactly like `prize_options`/
-- `prize_results` are their own tables rather than columns bolted onto
-- `trips`. A dedicated 1:1 table (trip_id primary key) keeps `trips`
-- itself unchanged, lets this feature's constraints live in one place,
-- and means a trip with no row here is simply "no preferences recorded"
-- -- never a `trips` row with a pile of nullable, easy-to-forget columns.
-- Rejected alternatives: (a) a JSONB blob column -- Postgres CHECK
-- constraints can express "these 4 named percentages must sum to 100"
-- and "this enum value requires that other column to be set" far more
-- directly, and more safely, against real typed columns than against
-- arbitrary JSON keys; (b) a generic key/value "trip settings" table --
-- explicitly rejected by the product request itself ("nu introduce un
-- sistem generic de configurare sau versionare") -- this batch has
-- exactly one fixed, small shape, not an extensible settings system.
-- Rejected versioning: only the current brief is ever needed by this
-- batch (no "compare past preferences," no "content drafted against
-- brief version N") -- `updated_at` is enough to know it changed, and
-- point 4 of the request explicitly excludes multi-version content.
--
-- WHY A SEPARATE MIGRATION, NOT A trips.content_status CHECK: this
-- table's own constraints (percentages, enum-conditional name
-- requirement) are independent of R7's content-completeness rules
-- (validate_trip_content/publish_trip, 20260908090000_r7_content_
-- publishing_pipeline.sql) -- a brief is a PREFERENCE, never itself
-- "content" R7's validator requires to exist. This migration only ADDS
-- one narrow, structural check to validate_trip_content (see the bottom
-- of this file) -- it never requires a brief to exist for a trip to
-- publish, and never touches questions/battles/extras.
--
-- AUTHORIZATION: save_trip_editorial_brief() below is reachable ONLY via
-- the service-role key (revoked from anon/authenticated/PUBLIC, same
-- "explicitly revoke the default grant" pattern R7 already established
-- -- see supabase/ci-bootstrap.sql for why a bare `create function`
-- needs this). It does not re-derive "is this caller allowed" itself:
-- that's decided in the Next.js route (src/lib/security/
-- tripAuthorAccess.ts's requireTripAuthorOrAdmin, reusing
-- resolveAccountSession + creator_accounts.is_admin + trips.
-- created_by_account_id -- the same verified-session mechanism R1/R5/R7
-- already rely on, never a client-supplied flag) -- only THEN does the
-- route call this function via the service-role client. The table
-- itself carries RLS enabled with ZERO policies for anon/authenticated
-- -- same "reachable only through the owning function/route" pattern as
-- creator_accounts and ip_rate_limits -- this is editorial/operator data,
-- never shown to an ordinary participant.
--
-- CONCURRENCY (edit vs. publish): save_trip_editorial_brief() takes the
-- IDENTICAL `select ... for update` lock on the trip's own `trips` row
-- that publish_trip() already takes before flipping content_status to
-- 'ready'. This makes "save the brief" and "publish the trip" mutually
-- exclusive for a given trip: whichever call acquires the lock first
-- fully commits (or rolls back) before the other can even read
-- content_status, so an edit can never land on a trip that has, by the
-- time it actually writes, already been published -- and a publish can
-- never race an in-flight edit either. Same technique, same reason, as
-- R7's own publish_trip/publish_trip serialization.

-- ---------------------------------------------------------------------
-- Enums. Difficulty and writing style are a small, fixed set (per the
-- product request) -- real Postgres enums, not free text, matching this
-- schema's own established convention (participant_role, question_kind,
-- trip_content_status, ...).
-- ---------------------------------------------------------------------
create type trip_difficulty as enum ('easy', 'medium', 'hard');
create type trip_question_style as enum ('fun', 'academic', 'narrated_by_character');

-- ---------------------------------------------------------------------
-- trip_editorial_briefs: one row per trip, written only via
-- save_trip_editorial_brief() below.
-- ---------------------------------------------------------------------
create table trip_editorial_briefs (
  trip_id uuid primary key references trips (id) on delete cascade,
  difficulty trip_difficulty not null,
  style trip_question_style not null,
  -- Required only when style = 'narrated_by_character' -- enforced by
  -- the CHECK below, not just at the application layer, so a direct
  -- service-role write (a future migration, a manual fix) can't
  -- accidentally create an inconsistent row either.
  narrator_character_name text,
  theme_history smallint not null,
  theme_places smallint not null,
  theme_food smallint not null,
  theme_curiosities smallint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trip_editorial_briefs_theme_percent_range check (
    theme_history between 0 and 100
    and theme_places between 0 and 100
    and theme_food between 0 and 100
    and theme_curiosities between 0 and 100
  ),
  -- Integer percentages across the 4 fixed categories must sum to
  -- exactly 100 -- the product rule ("Totalul trebuie să fie exact
  -- 100%"), enforced here so it can never be bypassed by a direct
  -- write, not just by the application's own pre-save check.
  constraint trip_editorial_briefs_theme_percent_total check (
    theme_history + theme_places + theme_food + theme_curiosities = 100
  ),
  constraint trip_editorial_briefs_narrator_name_required_for_style check (
    style <> 'narrated_by_character'::trip_question_style
    or (narrator_character_name is not null and btrim(narrator_character_name) <> '')
  ),
  -- A reasonable length backstop (matches app/page.tsx's own destination
  -- field's 80-character cap) -- the application layer normalizes
  -- whitespace and enforces this same limit first, with a clear error;
  -- this is the non-bypassable floor under it.
  constraint trip_editorial_briefs_narrator_name_length check (
    narrator_character_name is null or char_length(narrator_character_name) <= 80
  )
);

alter table trip_editorial_briefs enable row level security;
-- No policies for anon/authenticated -- reachable only via the
-- service-role client, after the Next.js route's own creator-or-admin
-- check (see this file's header). Matches creator_accounts/
-- ip_rate_limits, not the public-readable content tables -- an
-- editorial brief is operator-facing, never shown to a participant.

-- ---------------------------------------------------------------------
-- save_trip_editorial_brief: the only way to write this table. Atomic
-- (one row lock, one upsert) and idempotent (calling it again with the
-- same values is a harmless no-op update). Rejects a write outright,
-- WITHOUT touching the row, once the trip is published or while content
-- generation is in progress -- see this file's header for the
-- concurrency guarantee the shared `trips` row lock provides.
-- ---------------------------------------------------------------------
create type save_editorial_brief_status as enum ('saved', 'rejected_published', 'rejected_generating');

create type save_editorial_brief_result as (
  status save_editorial_brief_status,
  brief trip_editorial_briefs
);

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
  -- Same lock publish_trip() takes on the same row -- see this
  -- migration's header for why this is what actually makes "edit" and
  -- "publish" mutually exclusive, not just the status check below on
  -- its own.
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

  return row('saved', v_brief)::save_editorial_brief_result;
end;
$$;

revoke execute on function public.save_trip_editorial_brief(
  uuid, trip_difficulty, trip_question_style, text, smallint, smallint, smallint, smallint
) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- validate_trip_content: one narrow, STRUCTURAL addition -- a
-- narrated_by_character brief with no character name would already be
-- impossible to write via save_trip_editorial_brief() (the CHECK
-- constraint above prevents it at the row level), so in practice this
-- branch can never fire through the normal write path. It is kept
-- anyway as real defense-in-depth, exactly like this same migration
-- file's own `trip.timezone_invalid` check already does for a value the
-- database's own CHECK constraint also prevents -- see that check's own
-- comment in 20260907140000_r6_trip_timezone_and_lifecycle.sql for the
-- precedent. This is DELIBERATELY the only brief-related check added
-- here: validate_trip_content never requires a brief to exist (a trip
-- with none is unaffected -- see docs/DATABASE.md), and it never claims
-- to verify that the difficulty is accurate or that the writing style
-- was actually followed -- neither is something SQL can check; only a
-- human (or, later, a generator prompted with this brief) can.
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
