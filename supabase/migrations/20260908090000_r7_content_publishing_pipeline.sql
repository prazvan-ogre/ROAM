-- R7: a clear pipeline for preparing, validating, and publishing a
-- trip's content -- pending -> (generating) -> ready, with a `failed`
-- state for operator intervention.
--
-- WHY: content_status has existed since 20260828100000_public_trip_
-- creation.sql (public trip creation left new rows at 'pending', flipped
-- to 'ready' as part of the same manual migration that inserts real
-- content -- see seed.sql's own header for that pattern), but two gaps
-- remained: (1) the column's own DEFAULT is 'ready'
-- (20260901090000_enum_types.sql, kept for pre-existing rows that
-- predated the column entirely) -- a bare `insert into trips (...)` that
-- forgets to set content_status explicitly (exactly seed.sql's own
-- pattern) silently gets 'ready' with zero actual content, and nothing
-- ever checked that a trip marked 'ready' actually HAD a complete,
-- verified, published set of Discover/Battle/Extras/prize content
-- before this migration; (2) there was no repeatable way to check that
-- at all -- readiness was "an admin eyeballed Supabase Studio and
-- believed it was done."
--
-- HOW: this migration does NOT change how content itself is authored --
-- still Supabase Studio / seed migrations, per the product's current
-- operational model (see docs/DATABASE.md's own R7 section and the R7
-- report for why a CMS/AI-generation pipeline is explicitly out of
-- scope for this batch). It adds:
--   1. validate_trip_content(trip_id) -- a read-only, STABLE function
--      that checks the real relationships between trips/questions/
--      answer_options/battles/extras/explore_links/prize_options (not
--      just "does a row exist"), returning a structured list of issues.
--      Reused by both the operator UI (app/api/admin/trips/[slug]/
--      validate) and publish_trip below, so there is exactly one set of
--      rules for "is this trip's content actually complete."
--   2. publish_trip(trip_id) -- re-runs that same validation, and only
--      flips content_status to 'ready' if there are zero errors, inside
--      one transaction (a `select ... for update` row lock makes two
--      concurrent publish attempts serialize rather than race, and
--      re-running it once already 'ready' is a safe no-op, never a
--      second write). A trip with any error-severity issue is REJECTED
--      outright -- content_status is never touched -- and the full issue
--      list is returned so the caller (the admin route) can show the
--      operator exactly what's missing, without exposing anything a
--      participant-facing error message shouldn't (question prompts,
--      answer text, etc. never appear in a message -- only check keys,
--      day numbers, and entity ids).
--   3. content_status's own DEFAULT changes from 'ready' to 'pending' --
--      a bare insert that forgets the column now fails safe (nothing is
--      silently "ready" with no content) instead of failing dangerous.
--      This does NOT touch any existing row's stored value (a column
--      DEFAULT only ever applies to a future insert that omits the
--      column) -- see the R7 report's "date istorice" section for the
--      audit of what this means for already-seeded trips (Kassandra
--      2026 included).
--
-- AUTHORIZATION: both functions are reachable ONLY by the service-role
-- key, the same trust boundary every other admin-only operation in this
-- codebase already relies on (app/api/trips/create/route.ts,
-- app/api/account/trips/route.ts) -- explicitly revoked from anon/
-- authenticated/PUBLIC below, since a bare `create function` in this
-- schema is otherwise granted execute to anon/authenticated by default
-- (see supabase/ci-bootstrap.sql's own comment on why -- CI replicates a
-- real Supabase project's default privilege behavior). Neither function
-- re-derives "is this caller an admin" itself: creator_accounts.is_admin
-- is checked server-side, in the Next.js route, against a verified
-- account session (src/lib/security/session.ts's resolveAccountSession,
-- the same mechanism app/api/account/trips/route.ts already uses) --
-- never a client-supplied isAdmin flag, accountId, or deviceId -- and
-- only THEN does the route call these functions via the service-role
-- client, which already bypasses RLS for every other admin write in this
-- codebase.

-- ---------------------------------------------------------------------
-- content_status: fail safe, not fail ready.
-- ---------------------------------------------------------------------
alter table trips alter column content_status set default 'pending'::trip_content_status;

-- ---------------------------------------------------------------------
-- One issue row shape, shared by validate_trip_content's return table
-- and publish_trip's own aggregation of it.
-- ---------------------------------------------------------------------
create type content_validation_issue as (
  check_key text,
  severity text,
  message text,
  day_number int,
  entity_id uuid
);

-- ---------------------------------------------------------------------
-- validate_trip_content: every relational check from the R7 spec
-- (trip / Discover / Battle / Extras+links / Prize), returned as rows
-- rather than a single pass/fail so the operator UI can show a useful
-- summary instead of a bare yes/no. Empty result = fully valid.
--
-- Built as one big issues array (each section a UNION ALL branch) rather
-- than a sequence of separate `return query` statements, specifically so
-- the final "content_status_inconsistent" meta-check can see the total
-- error count from every OTHER check before deciding whether to add
-- itself -- plpgsql's RETURN QUERY streams rows out immediately, with no
-- way to inspect what's already been emitted.
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
      -- Mirrors discover.not_published: a required Battle existing (with
      -- questions) is not the same as it being ACTUALLY publishable --
      -- every one of its questions must be verified+published too, or
      -- the Battle would go live half-empty.
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
    ) as x
  );

  v_error_count := (select count(*) from unnest(v_issues) i where (i).severity = 'error');

  -- content_status consistency: a trip already marked 'ready' that no
  -- longer (or never did) actually pass validation is a real,
  -- reportable inconsistency -- surfaced as one more issue instead of
  -- left for the operator to notice on their own.
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

-- ---------------------------------------------------------------------
-- publish_trip: the one explicit, atomic, idempotent publish operation.
-- Re-validates from scratch every call (never trusts a stale client-side
-- validation result) and only ever flips content_status forward into
-- 'ready' -- never touches verified/published on individual rows (those
-- stay a Studio/seed-migration step, per the product's current
-- operational model; see docs/DATABASE.md's R7 section).
-- ---------------------------------------------------------------------
create type publish_trip_result as (
  status text,     -- 'published' | 'already_published' | 'rejected'
  error_count int,
  warning_count int,
  issues jsonb
);

create or replace function public.publish_trip(p_trip_id uuid)
returns publish_trip_result
language plpgsql
as $$
declare
  v_status trip_content_status;
  v_issues jsonb;
  v_error_count int;
  v_warning_count int;
begin
  -- Row lock held for the rest of this transaction: a second concurrent
  -- publish_trip(same id) call blocks here until this one commits or
  -- rolls back, then re-reads the (by then current) content_status --
  -- never a race where both calls decide "not ready yet" against the
  -- same stale read and both attempt the UPDATE.
  select content_status into v_status from trips where id = p_trip_id for update;
  if not found then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'check_key', v.check_key, 'severity', v.severity, 'message', v.message,
      'day_number', v.day_number, 'entity_id', v.entity_id
    )), '[]'::jsonb),
    count(*) filter (where v.severity = 'error'),
    count(*) filter (where v.severity = 'warning')
  into v_issues, v_error_count, v_warning_count
  from validate_trip_content(p_trip_id) v;

  if v_error_count > 0 then
    return row('rejected', v_error_count, v_warning_count, v_issues)::publish_trip_result;
  end if;

  if v_status = 'ready'::trip_content_status then
    -- Idempotent: already published, still valid -- no write, not an error.
    return row('already_published', 0, v_warning_count, v_issues)::publish_trip_result;
  end if;

  update trips set content_status = 'ready'::trip_content_status where id = p_trip_id;

  return row('published', 0, v_warning_count, v_issues)::publish_trip_result;
end;
$$;

-- ---------------------------------------------------------------------
-- Both functions are reachable ONLY via the service-role key (see this
-- migration's own header for why) -- explicitly revoked from the
-- default execute grant every new function in this schema otherwise
-- gets.
-- ---------------------------------------------------------------------
revoke execute on function public.validate_trip_content(uuid) from public, anon, authenticated;
revoke execute on function public.publish_trip(uuid) from public, anon, authenticated;
