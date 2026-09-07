-- R9 (AI-assisted question generation) regression: start/finish_trip_
-- question_generation()'s state machine and concurrency guarantees,
-- accept/reject_generated_question_draft()'s validation and promotion
-- into real questions/answer_options rows, validate_trip_content()'s
-- new "unreviewed draft blocks publish" check (proven against the REAL
-- publish_trip(), not a simulated update), the brief-change invalidation
-- cascade, the RLS boundary (service-role only), and the retry/rate-
-- limit contract. Sibling test to supabase/tests/trip_editorial_brief.
-- test.sql -- same setup requirements (stub `auth` schema, `anon`/
-- `authenticated` roles with baseline grants); see r1_auth_ownership_
-- rls.test.sql's header for the exact DDL and how to run this against a
-- scratch database.
--
-- What this file does NOT cover: authorization (creator vs. admin vs.
-- another trip's creator vs. a participant) is pure application-layer
-- logic (src/lib/security/tripAuthorAccess.ts) -- there is no RLS policy
-- scoping these tables by creator account at all, by design (same as
-- trip_editorial_briefs). Covered by tests/unit/api-trips-generate*.
-- test.ts against the real route code instead. The AI provider itself
-- (fake vs. real, JSON parsing, per-field content validation) is pure
-- TypeScript, covered by tests/unit/generated-questions-validation.
-- test.ts and tests/unit/question-generation-provider.test.ts.

\set ON_ERROR_STOP on

-- =======================================================================
-- Fixture: one pending trip with a saved brief, for scenarios A-D and F-I.
-- =======================================================================
begin;
insert into creator_accounts (id, phone_number, pin_hash) values
  ('00000000-0000-0000-0000-0000000f0001', '0700000101', 'x');

insert into trips (id, slug, name, duration_days, start_date, timezone, destination, content_status) values
  ('00000000-0000-0000-0000-0000000f0011', 'gen-pending-trip', 'Gen Pending Trip', 5, current_date, 'UTC', 'Nowhere', 'pending'),
  ('00000000-0000-0000-0000-0000000f0012', 'gen-ready-trip', 'Gen Ready Trip', 5, current_date, 'UTC', 'Nowhere', 'ready'),
  ('00000000-0000-0000-0000-0000000f0013', 'gen-no-brief-trip', 'Gen No Brief Trip', 5, current_date, 'UTC', 'Nowhere', 'pending');

select save_trip_editorial_brief('00000000-0000-0000-0000-0000000f0011'::uuid, 'medium'::trip_difficulty, 'fun'::trip_question_style, null, 25::smallint, 25::smallint, 25::smallint, 25::smallint);
select save_trip_editorial_brief('00000000-0000-0000-0000-0000000f0012'::uuid, 'medium'::trip_difficulty, 'fun'::trip_question_style, null, 25::smallint, 25::smallint, 25::smallint, 25::smallint);
commit;

-- -----------------------------------------------------------------------
-- Scenario A: start_trip_question_generation's own state machine.
-- -----------------------------------------------------------------------
begin;
do $$
declare r record;
begin
  select * into r from start_trip_question_generation('00000000-0000-0000-0000-0000000f0013'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 3::smallint);
  if r.status <> 'no_brief' then
    raise exception 'FAIL scenario A1: expected no_brief for a trip with no saved brief, got %', r.status;
  end if;
  raise notice 'PASS scenario A1: a legacy/no-brief trip cannot start generation (no_brief)';
end $$;

do $$
declare r record;
begin
  select * into r from start_trip_question_generation('00000000-0000-0000-0000-0000000f0012'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 3::smallint);
  if r.status <> 'already_published' then
    raise exception 'FAIL scenario A2: expected already_published for a ready trip, got %', r.status;
  end if;
  raise notice 'PASS scenario A2: a published trip cannot start generation (already_published)';
end $$;

do $$
declare r record; v_status trip_content_status;
begin
  select * into r from start_trip_question_generation('00000000-0000-0000-0000-0000000f0011'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 3::smallint);
  if r.status <> 'started' then
    raise exception 'FAIL scenario A3: expected started, got %', r.status;
  end if;
  select content_status into v_status from trips where id = '00000000-0000-0000-0000-0000000f0011';
  if v_status <> 'generating'::trip_content_status then
    raise exception 'FAIL scenario A3: trips.content_status was not set to generating, got %', v_status;
  end if;
  raise notice 'PASS scenario A3: a valid trip with a brief starts generation and flips content_status to generating';
end $$;

-- Scenario A4: a CONCURRENT second start (sequential calls exercise the
-- same code path a true concurrent race would hit, same convention as
-- record_answer.test.sql and the brief migration's own race test)
-- returns the SAME run's current state, never a duplicate job -- proven
-- by the unique partial index on (trip_id) where status='generating' as
-- much as by the status check itself.
do $$
declare r record; v_run_count int;
begin
  select * into r from start_trip_question_generation('00000000-0000-0000-0000-0000000f0011'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 3::smallint);
  if r.status <> 'already_running' then
    raise exception 'FAIL scenario A4: expected already_running for a concurrent second start, got %', r.status;
  end if;
  select count(*) into v_run_count from trip_question_generation_runs where trip_id = '00000000-0000-0000-0000-0000000f0011' and status = 'generating';
  if v_run_count <> 1 then
    raise exception 'FAIL scenario A4: expected exactly 1 in-flight run, found %', v_run_count;
  end if;
  raise notice 'PASS scenario A4: a concurrent start returns the existing run, never a duplicate job';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario B: finish_trip_question_generation -- success/failure content_
-- status transitions, and idempotency.
-- -----------------------------------------------------------------------
begin;
do $$
declare v_run_id uuid; v_status trip_content_status;
begin
  select (start_trip_question_generation('00000000-0000-0000-0000-0000000f0011'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 2::smallint)).run.id into v_run_id;

  perform finish_trip_question_generation(v_run_id, true, null, 2::smallint, 0::smallint);
  select content_status into v_status from trips where id = '00000000-0000-0000-0000-0000000f0011';
  if v_status <> 'pending'::trip_content_status then
    raise exception 'FAIL scenario B1: a successful finish should return content_status to pending (never ready), got %', v_status;
  end if;
  raise notice 'PASS scenario B1: a successful generation returns content_status to pending, never ready';

  -- Idempotent: finishing an already-finished run again is a safe no-op
  -- (doesn't re-flip content_status, doesn't error).
  perform finish_trip_question_generation(v_run_id, false, 'should be ignored', 0::smallint, 0::smallint);
  select content_status into v_status from trips where id = '00000000-0000-0000-0000-0000000f0011';
  if v_status <> 'pending'::trip_content_status then
    raise exception 'FAIL scenario B2: finishing an already-finished run changed content_status to %', v_status;
  end if;
  raise notice 'PASS scenario B2: finishing an already-finished run is an idempotent no-op';
end $$;

-- B1/B2's own run just succeeded moments ago -- push it back past the
-- cooldown so B3 below tests content_status on failure, not the
-- (separately covered, see scenario C) retry/rate-limit contract.
update trip_question_generation_runs set started_at = started_at - interval '1 minute'
  where trip_id = '00000000-0000-0000-0000-0000000f0011';

do $$
declare v_run_id uuid; v_status trip_content_status;
begin
  select (start_trip_question_generation('00000000-0000-0000-0000-0000000f0011'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 2::smallint)).run.id into v_run_id;
  perform finish_trip_question_generation(v_run_id, false, 'Provider error', 0::smallint, 2::smallint);
  select content_status into v_status from trips where id = '00000000-0000-0000-0000-0000000f0011';
  if v_status <> 'failed'::trip_content_status then
    raise exception 'FAIL scenario B3: a failed finish should set content_status to failed, got %', v_status;
  end if;
  raise notice 'PASS scenario B3: a failed generation sets content_status to failed';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario C: retry contract -- immediate retry after a FAILURE is
-- allowed (no rate limit); a rapid re-attempt right after a SUCCESS is
-- rate-limited.
-- -----------------------------------------------------------------------
begin;
do $$
declare v_run_id uuid; r record;
begin
  select (start_trip_question_generation('00000000-0000-0000-0000-0000000f0011'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 2::smallint)).run.id into v_run_id;
  perform finish_trip_question_generation(v_run_id, false, 'Provider timed out', 0::smallint, 2::smallint);
  -- Everything in this test runs inside one wrapping transaction, so
  -- now() (transaction_timestamp -- fixed for the whole transaction, a
  -- well-known Postgres behavior, not a bug) is IDENTICAL for every
  -- started_at stamped below -- age this one back so the cooldown
  -- check's own `order by started_at desc` deterministically picks the
  -- run created next, exactly as it would across two genuinely separate
  -- requests in production (each its own transaction, each its own
  -- now()).
  update trip_question_generation_runs set started_at = started_at - interval '2 minutes' where id = v_run_id;

  select * into r from start_trip_question_generation('00000000-0000-0000-0000-0000000f0011'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 2::smallint);
  if r.status <> 'started' then
    raise exception 'FAIL scenario C1: an immediate retry right after a failure should be allowed, got %', r.status;
  end if;
  raise notice 'PASS scenario C1: retry immediately after a failure is never rate-limited';

  perform finish_trip_question_generation((r.run).id, true, null, 2::smallint, 0::smallint);

  select * into r from start_trip_question_generation('00000000-0000-0000-0000-0000000f0011'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 2::smallint);
  if r.status <> 'rate_limited' then
    raise exception 'FAIL scenario C2: a rapid re-attempt right after a SUCCESS should be rate-limited, got %', r.status;
  end if;
  raise notice 'PASS scenario C2: a rapid re-attempt right after a success is rate-limited';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario D: a run abandoned mid-flight (crash/timeout, never finished)
-- is reclaimed as 'failed' and a fresh run starts in the same call --
-- "Eșecul trebuie să lase trip-ul într-o stare recuperabilă".
-- -----------------------------------------------------------------------
begin;
do $$
declare v_old_run_id uuid; v_new_run_id uuid; r record; v_old_status generation_run_status;
begin
  select (start_trip_question_generation('00000000-0000-0000-0000-0000000f0011'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 2::smallint)).run.id into v_old_run_id;
  update trip_question_generation_runs set started_at = now() - interval '10 minutes' where id = v_old_run_id;

  select * into r from start_trip_question_generation('00000000-0000-0000-0000-0000000f0011'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 2::smallint);
  if r.status <> 'started' then
    raise exception 'FAIL scenario D: a stale abandoned run should be reclaimed and a fresh one started, got %', r.status;
  end if;
  select status into v_old_status from trip_question_generation_runs where id = v_old_run_id;
  if v_old_status <> 'failed'::generation_run_status then
    raise exception 'FAIL scenario D: the abandoned run should be marked failed, found %', v_old_status;
  end if;
  if (r.run).id = v_old_run_id then
    raise exception 'FAIL scenario D: expected a genuinely NEW run id, got the same one back';
  end if;
  raise notice 'PASS scenario D: an abandoned (stale) run is reclaimed as failed and a fresh run starts in the same call';
end $$;
rollback;

-- =======================================================================
-- Fixture for scenarios E-I: a valid, minimal 3-day trip (R7's own
-- MIN_TRIP_DURATION_DAYS) with a saved brief, ready to publish once its
-- drafts are resolved.
-- =======================================================================
begin;
insert into trips (id, slug, name, duration_days, start_date, timezone, destination, content_status) values
  ('00000000-0000-0000-0000-0000000f0031', 'gen-race-trip', 'Gen Race Trip', 3, current_date, 'UTC', 'Nowhere', 'pending');

insert into questions (id, trip_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-0000000f0041', '00000000-0000-0000-0000-0000000f0031', 'discover', 1, 'morning', 1, 'D1 Morning Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000f0042', '00000000-0000-0000-0000-0000000f0031', 'discover', 1, 'lunch', 1, 'D1 Lunch Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000f0044', '00000000-0000-0000-0000-0000000f0031', 'discover', 2, 'morning', 1, 'D2 Morning Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000f0045', '00000000-0000-0000-0000-0000000f0031', 'discover', 2, 'lunch', 1, 'D2 Lunch Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000f0046', '00000000-0000-0000-0000-0000000f0031', 'discover', 3, 'morning', 1, 'D3 Morning Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000f0047', '00000000-0000-0000-0000-0000000f0031', 'discover', 3, 'lunch', 1, 'D3 Lunch Q', 'single_choice', 10, true, true);
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from questions q
join (values (1, 'Correct', true), (2, 'Wrong', false)) as o(order_index, label, is_correct) on true
where q.id in (
  '00000000-0000-0000-0000-0000000f0041', '00000000-0000-0000-0000-0000000f0042',
  '00000000-0000-0000-0000-0000000f0044', '00000000-0000-0000-0000-0000000f0045',
  '00000000-0000-0000-0000-0000000f0046', '00000000-0000-0000-0000-0000000f0047'
);

insert into battles (id, trip_id, day_number, title, is_final) values
  ('00000000-0000-0000-0000-0000000f0052', '00000000-0000-0000-0000-0000000f0031', 1, 'D1 Battle', false),
  ('00000000-0000-0000-0000-0000000f0053', '00000000-0000-0000-0000-0000000f0031', 2, 'D2 Battle', false),
  ('00000000-0000-0000-0000-0000000f0051', '00000000-0000-0000-0000-0000000f0031', null, 'Final Battle', true);
insert into questions (id, trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-0000000f0048', '00000000-0000-0000-0000-0000000f0031', '00000000-0000-0000-0000-0000000f0052', 'battle', 1, 1, 'D1 Battle Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000f0049', '00000000-0000-0000-0000-0000000f0031', '00000000-0000-0000-0000-0000000f0053', 'battle', 2, 1, 'D2 Battle Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-0000000f0043', '00000000-0000-0000-0000-0000000f0031', '00000000-0000-0000-0000-0000000f0051', 'battle', null, 1, 'Final Q', 'single_choice', 10, true, true);
insert into answer_options (question_id, order_index, label, is_correct)
select q.id, o.order_index, o.label, o.is_correct
from questions q
join (values (1, 'Correct', true), (2, 'Wrong', false)) as o(order_index, label, is_correct) on true
where q.id in (
  '00000000-0000-0000-0000-0000000f0048', '00000000-0000-0000-0000-0000000f0049', '00000000-0000-0000-0000-0000000f0043'
);

insert into prize_options (trip_id, title, order_index) values
  ('00000000-0000-0000-0000-0000000f0031', 'Prize A', 1),
  ('00000000-0000-0000-0000-0000000f0031', 'Prize B', 2);

select save_trip_editorial_brief('00000000-0000-0000-0000-0000000f0031'::uuid, 'medium'::trip_difficulty, 'fun'::trip_question_style, null, 25::smallint, 25::smallint, 25::smallint, 25::smallint);

-- Sanity: this fixture is fully valid and publishable BEFORE any draft exists.
do $$
declare v_errors int;
begin
  select count(*) into v_errors from validate_trip_content('00000000-0000-0000-0000-0000000f0031'::uuid) where severity = 'error';
  if v_errors <> 0 then
    raise exception 'FAIL fixture sanity: expected a fully valid trip with zero errors, found %', v_errors;
  end if;
end $$;
commit;

-- -----------------------------------------------------------------------
-- Scenario E: a pending_review draft blocks REAL publish_trip() (not
-- just validate_trip_content in isolation) -- proves the actual
-- function-to-function interaction, same standard as the brief
-- migration's own race scenario.
-- -----------------------------------------------------------------------
begin;
do $$
declare v_run_id uuid; v_draft_id uuid; r record;
begin
  select (start_trip_question_generation('00000000-0000-0000-0000-0000000f0031'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 1::smallint)).run.id into v_run_id;

  insert into trip_generated_question_drafts (trip_id, generation_run_id, brief_version, day_number, slot, theme_category, difficulty, prompt, explanation, options)
  values (
    '00000000-0000-0000-0000-0000000f0031', v_run_id,
    (select updated_at from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000f0031'),
    1, 'morning', 'history', 'medium', 'Extra Q?', 'Because.',
    '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb
  ) returning id into v_draft_id;

  perform finish_trip_question_generation(v_run_id, true, null, 1::smallint, 0::smallint);

  select * into r from publish_trip('00000000-0000-0000-0000-0000000f0031'::uuid);
  if r.status <> 'rejected' then
    raise exception 'FAIL scenario E1: publish_trip should reject a trip with an unreviewed draft, got %', r.status;
  end if;
  if not exists (select 1 from jsonb_array_elements(r.issues) i where i->>'check_key' = 'generation.review_pending') then
    raise exception 'FAIL scenario E1: expected a generation.review_pending issue, got %', r.issues;
  end if;
  raise notice 'PASS scenario E1: publish_trip() itself rejects a trip with a still-unreviewed generated draft';

  -- Reject the draft -- publish should now succeed (rejected is a
  -- resolved, terminal state -- it no longer blocks).
  perform reject_generated_question_draft(v_draft_id);
  select * into r from publish_trip('00000000-0000-0000-0000-0000000f0031'::uuid);
  if r.status <> 'published' then
    raise exception 'FAIL scenario E2: publish_trip should succeed once the only draft is resolved (rejected), got %: %', r.status, r.issues;
  end if;
  raise notice 'PASS scenario E2: resolving (rejecting) the only pending draft unblocks publish_trip()';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario F: accept_generated_question_draft -- valid accept promotes
-- into a real, verified+published questions/answer_options row with the
-- correct source/theme_category/difficulty; invalid inputs are rejected
-- WITHOUT writing anything; already-processed/stale-brief/trip-
-- published are reported, not raised as exceptions.
-- -----------------------------------------------------------------------
begin;
do $$
declare v_run_id uuid; v_draft_id uuid; v_brief_version timestamptz; r record; v_question_id uuid;
begin
  select updated_at into v_brief_version from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000f0031';
  select (start_trip_question_generation('00000000-0000-0000-0000-0000000f0031'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 1::smallint)).run.id into v_run_id;

  insert into trip_generated_question_drafts (trip_id, generation_run_id, brief_version, day_number, slot, theme_category, difficulty, prompt, explanation, options)
  values (
    '00000000-0000-0000-0000-0000000f0031', v_run_id, v_brief_version,
    1, 'morning', 'history', 'medium', 'Ce insulă e cunoscută pentru Achilleion?', 'Corfu găzduiește Achilleion.',
    '[{"label":"Corfu","is_correct":true},{"label":"Rodos","is_correct":false}]'::jsonb
  ) returning id into v_draft_id;
  perform finish_trip_question_generation(v_run_id, true, null, 1::smallint, 0::smallint);

  -- F1: duplicate option labels rejected, nothing written.
  select * into r from accept_generated_question_draft(
    v_draft_id, '00000000-0000-0000-0000-0000000f0001'::uuid, 'Q?', 'E.',
    '[{"label":"A","is_correct":true},{"label":"A","is_correct":false}]'::jsonb,
    'history'::question_theme_category, 'medium'::trip_difficulty, 1, 'morning'::question_slot, false
  );
  if r.status <> 'invalid' then raise exception 'FAIL scenario F1: duplicate option labels should be rejected, got %', r.status; end if;

  -- F2: zero/two correct answers rejected.
  select * into r from accept_generated_question_draft(
    v_draft_id, '00000000-0000-0000-0000-0000000f0001'::uuid, 'Q?', 'E.',
    '[{"label":"A","is_correct":false},{"label":"B","is_correct":false}]'::jsonb,
    'history'::question_theme_category, 'medium'::trip_difficulty, 1, 'morning'::question_slot, false
  );
  if r.status <> 'invalid' then raise exception 'FAIL scenario F2: zero correct options should be rejected, got %', r.status; end if;

  -- F3: day out of range (trip is 3 days) rejected.
  select * into r from accept_generated_question_draft(
    v_draft_id, '00000000-0000-0000-0000-0000000f0001'::uuid, 'Q?', 'E.',
    '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb,
    'history'::question_theme_category, 'medium'::trip_difficulty, 99, 'morning'::question_slot, false
  );
  if r.status <> 'invalid' then raise exception 'FAIL scenario F3: an out-of-range day should be rejected, got %', r.status; end if;

  if exists (select 1 from questions where trip_id = '00000000-0000-0000-0000-0000000f0031' and prompt in ('Q?', '')) then
    raise exception 'FAIL scenario F1-F3: an invalid accept attempt wrote a questions row';
  end if;
  raise notice 'PASS scenario F1-F3: invalid accept attempts (duplicate options, wrong correct count, day out of range) are rejected without writing anything';

  -- F4: a valid, unedited accept promotes into questions/answer_options
  -- with source='generated', verified=true, published=true, and the
  -- draft's own theme_category/difficulty carried over.
  select * into r from accept_generated_question_draft(
    v_draft_id, '00000000-0000-0000-0000-0000000f0001'::uuid,
    'Ce insulă e cunoscută pentru Achilleion?', 'Corfu găzduiește Achilleion.',
    '[{"label":"Corfu","is_correct":true},{"label":"Rodos","is_correct":false}]'::jsonb,
    'history'::question_theme_category, 'medium'::trip_difficulty, 1, 'morning'::question_slot, false
  );
  if r.status <> 'accepted' then raise exception 'FAIL scenario F4: a valid accept should succeed, got %: %', r.status, r; end if;
  v_question_id := r.question_id;
  perform 1 from questions where id = v_question_id and source = 'generated'::question_source and verified and published
    and theme_category = 'history'::question_theme_category and difficulty = 'medium'::trip_difficulty and kind = 'discover'::question_kind;
  if not found then raise exception 'FAIL scenario F4: the promoted question does not have the expected fields'; end if;
  if (select count(*) from answer_options where question_id = v_question_id) <> 2 then
    raise exception 'FAIL scenario F4: expected 2 answer_options for the promoted question';
  end if;
  raise notice 'PASS scenario F4: a valid accept promotes the draft into a real, verified+published question with source=generated';

  -- F5: already-processed -- accepting the same draft again is reported,
  -- not an exception, and doesn't create a second question.
  select * into r from accept_generated_question_draft(
    v_draft_id, '00000000-0000-0000-0000-0000000f0001'::uuid,
    'Ce insulă e cunoscută pentru Achilleion?', 'Corfu găzduiește Achilleion.',
    '[{"label":"Corfu","is_correct":true},{"label":"Rodos","is_correct":false}]'::jsonb,
    'history'::question_theme_category, 'medium'::trip_difficulty, 1, 'morning'::question_slot, false
  );
  if r.status <> 'already_processed' then raise exception 'FAIL scenario F5: expected already_processed, got %', r.status; end if;
  if (select count(*) from questions where trip_id = '00000000-0000-0000-0000-0000000f0031' and prompt = 'Ce insulă e cunoscută pentru Achilleion?') <> 1 then
    raise exception 'FAIL scenario F5: a repeated accept created a second question';
  end if;
  raise notice 'PASS scenario F5: accepting an already-processed draft is reported (already_processed), never a duplicate question';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario G: an edited accept (fields differ from the draft's own
-- stored values) is promoted with source='edited', not 'generated'.
-- -----------------------------------------------------------------------
begin;
do $$
declare v_run_id uuid; v_draft_id uuid; v_brief_version timestamptz; r record;
begin
  select updated_at into v_brief_version from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000f0031';
  select (start_trip_question_generation('00000000-0000-0000-0000-0000000f0031'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 1::smallint)).run.id into v_run_id;
  insert into trip_generated_question_drafts (trip_id, generation_run_id, brief_version, day_number, slot, theme_category, difficulty, prompt, explanation, options)
  values (
    '00000000-0000-0000-0000-0000000f0031', v_run_id, v_brief_version,
    2, 'lunch', 'food', 'medium', 'Original prompt?', 'Original explanation.',
    '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb
  ) returning id into v_draft_id;
  perform finish_trip_question_generation(v_run_id, true, null, 1::smallint, 0::smallint);

  select * into r from accept_generated_question_draft(
    v_draft_id, '00000000-0000-0000-0000-0000000f0001'::uuid,
    'Edited prompt?', 'Original explanation.',
    '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb,
    'food'::question_theme_category, 'medium'::trip_difficulty, 2, 'lunch'::question_slot, true
  );
  if r.status <> 'accepted' then raise exception 'FAIL scenario G: accept with an edited prompt should succeed, got %', r.status; end if;
  perform 1 from questions where id = r.question_id and source = 'edited'::question_source;
  if not found then raise exception 'FAIL scenario G: an accept with a changed prompt should promote with source=edited'; end if;
  raise notice 'PASS scenario G: an admin-edited accept promotes with source=edited, not generated';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario H: changing the brief invalidates every still-pending_review
-- draft for that trip (does NOT touch accepted/rejected ones), and an
-- invalidated draft can no longer be accepted -- the accept-time
-- brief_version check is independent defense-in-depth for the same rule.
-- -----------------------------------------------------------------------
begin;
do $$
declare v_run_id uuid; v_pending_draft_id uuid; v_accepted_draft_id uuid; r record; v_status generated_question_status;
begin
  select (start_trip_question_generation('00000000-0000-0000-0000-0000000f0031'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 2::smallint)).run.id into v_run_id;
  insert into trip_generated_question_drafts (trip_id, generation_run_id, brief_version, day_number, slot, theme_category, difficulty, prompt, explanation, options)
  values
    ('00000000-0000-0000-0000-0000000f0031', v_run_id, (select updated_at from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000f0031'),
     3, 'morning', 'curiosities', 'medium', 'Pending Q?', 'E.', '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb)
  returning id into v_pending_draft_id;
  insert into trip_generated_question_drafts (trip_id, generation_run_id, brief_version, day_number, slot, theme_category, difficulty, prompt, explanation, options)
  values
    ('00000000-0000-0000-0000-0000000f0031', v_run_id, (select updated_at from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000f0031'),
     3, 'lunch', 'places', 'medium', 'To Be Accepted?', 'E.', '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb)
  returning id into v_accepted_draft_id;
  perform finish_trip_question_generation(v_run_id, true, null, 2::smallint, 0::smallint);

  select * into r from accept_generated_question_draft(
    v_accepted_draft_id, '00000000-0000-0000-0000-0000000f0001'::uuid, 'To Be Accepted?', 'E.',
    '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb,
    'places'::question_theme_category, 'medium'::trip_difficulty, 3, 'lunch'::question_slot, false
  );
  if r.status <> 'accepted' then raise exception 'FAIL scenario H setup: accept should have succeeded, got %', r.status; end if;

  perform save_trip_editorial_brief('00000000-0000-0000-0000-0000000f0031'::uuid, 'hard'::trip_difficulty, 'fun'::trip_question_style, null, 25::smallint, 25::smallint, 25::smallint, 25::smallint);

  select status into v_status from trip_generated_question_drafts where id = v_pending_draft_id;
  if v_status <> 'invalidated'::generated_question_status then
    raise exception 'FAIL scenario H1: a still-pending draft should be invalidated after the brief changes, got %', v_status;
  end if;
  raise notice 'PASS scenario H1: saving the brief invalidates every still-pending draft for that trip';

  select status into v_status from trip_generated_question_drafts where id = v_accepted_draft_id;
  if v_status <> 'accepted'::generated_question_status then
    raise exception 'FAIL scenario H2: an already-accepted draft must never be touched by a later brief change, got %', v_status;
  end if;
  raise notice 'PASS scenario H2: an already-accepted draft is untouched by a later brief change';

  -- Defense-in-depth: accept_generated_question_draft's own
  -- brief_version check independently rejects a stale draft too (in
  -- case a future code path ever bypasses the invalidation cascade).
  update trip_generated_question_drafts set status = 'pending_review'::generated_question_status where id = v_pending_draft_id;
  select * into r from accept_generated_question_draft(
    v_pending_draft_id, '00000000-0000-0000-0000-0000000f0001'::uuid, 'Pending Q?', 'E.',
    '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb,
    'curiosities'::question_theme_category, 'medium'::trip_difficulty, 3, 'morning'::question_slot, false
  );
  if r.status <> 'stale_brief' then raise exception 'FAIL scenario H3: expected stale_brief, got %', r.status; end if;
  raise notice 'PASS scenario H3: accept_generated_question_draft independently rejects a draft whose brief_version no longer matches';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario I: retry (a new generation run) never deletes or otherwise
-- disturbs a manually-accepted draft from a PRIOR run.
-- -----------------------------------------------------------------------
begin;
do $$
declare v_run1_id uuid; v_accepted_draft_id uuid; v_question_id uuid; r record; v_run2_id uuid;
begin
  select (start_trip_question_generation('00000000-0000-0000-0000-0000000f0031'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 1::smallint)).run.id into v_run1_id;
  insert into trip_generated_question_drafts (trip_id, generation_run_id, brief_version, day_number, slot, theme_category, difficulty, prompt, explanation, options)
  values (
    '00000000-0000-0000-0000-0000000f0031', v_run1_id, (select updated_at from trip_editorial_briefs where trip_id = '00000000-0000-0000-0000-0000000f0031'),
    1, 'morning', 'history', 'medium', 'Keep me?', 'E.', '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb
  ) returning id into v_accepted_draft_id;
  perform finish_trip_question_generation(v_run1_id, true, null, 1::smallint, 0::smallint);
  select * into r from accept_generated_question_draft(
    v_accepted_draft_id, '00000000-0000-0000-0000-0000000f0001'::uuid, 'Keep me?', 'E.',
    '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb,
    'history'::question_theme_category, 'medium'::trip_difficulty, 1, 'morning'::question_slot, false
  );
  v_question_id := r.question_id;

  -- Push run1 back past the cooldown -- this scenario is about drafts
  -- surviving a retry, not the retry/rate-limit contract itself (see
  -- scenario C for that).
  update trip_question_generation_runs set started_at = started_at - interval '1 minute' where id = v_run1_id;

  -- A brand new ("retry") generation run for the same trip.
  select (start_trip_question_generation('00000000-0000-0000-0000-0000000f0031'::uuid, '00000000-0000-0000-0000-0000000f0001'::uuid, 1::smallint)).run.id into v_run2_id;
  perform finish_trip_question_generation(v_run2_id, false, 'unrelated failure', 0::smallint, 1::smallint);

  perform 1 from trip_generated_question_drafts where id = v_accepted_draft_id and status = 'accepted'::generated_question_status and resulting_question_id = v_question_id;
  if not found then raise exception 'FAIL scenario I: a later generation run altered or removed the earlier accepted draft'; end if;
  perform 1 from questions where id = v_question_id;
  if not found then raise exception 'FAIL scenario I: the earlier accepted draft''s resulting question was deleted'; end if;
  raise notice 'PASS scenario I: a later (retry) generation run never touches an earlier manually-accepted draft or its resulting question';
end $$;
rollback;

-- -----------------------------------------------------------------------
-- Scenario J: RLS boundary -- both new tables are reachable only via the
-- service-role key, matching trip_editorial_briefs/creator_accounts.
-- -----------------------------------------------------------------------
begin;
insert into trip_question_generation_runs (id, trip_id, requested_by_account_id, brief_version, requested_count, status)
values ('00000000-0000-0000-0000-0000000f0061', '00000000-0000-0000-0000-0000000f0011', '00000000-0000-0000-0000-0000000f0001', now(), 1, 'succeeded');
insert into trip_generated_question_drafts (id, trip_id, generation_run_id, brief_version, day_number, slot, theme_category, difficulty, prompt, explanation, options)
values ('00000000-0000-0000-0000-0000000f0062', '00000000-0000-0000-0000-0000000f0011', '00000000-0000-0000-0000-0000000f0061', now(), 1, 'morning', 'history', 'medium', 'Q?', 'E.', '[{"label":"A","is_correct":true},{"label":"B","is_correct":false}]'::jsonb);

set role anon;
do $$
begin
  insert into trip_question_generation_runs (trip_id, requested_by_account_id, brief_version, requested_count)
  values ('00000000-0000-0000-0000-0000000f0011', '00000000-0000-0000-0000-0000000f0001', now(), 1);
  raise exception 'FAIL scenario J1: a direct INSERT into trip_question_generation_runs by anon was NOT rejected';
exception
  when insufficient_privilege then
    raise notice 'PASS scenario J1: a direct INSERT into trip_question_generation_runs by anon is rejected (%)', sqlerrm;
end $$;
reset role;

set role authenticated;
do $$
declare v_count int;
begin
  select count(*) into v_count from trip_generated_question_drafts where id = '00000000-0000-0000-0000-0000000f0062';
  if v_count <> 0 then
    raise exception 'FAIL scenario J2: authenticated could read a real trip_generated_question_drafts row (no select policy grants this)';
  end if;
  raise notice 'PASS scenario J2: authenticated sees zero rows for a real draft -- participants never see generated drafts';
end $$;
reset role;
rollback;
