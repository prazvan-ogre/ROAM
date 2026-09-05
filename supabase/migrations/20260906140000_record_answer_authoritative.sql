-- R3 (2026-09-05 architecture/security review, continued after Kassandra's
-- pilot ended): replaces client-trusted answer submission with a single
-- server-authoritative RPC, for Discover, Battle, Final AND Catchup alike.
--
-- WHY: two gaps survived the earlier R3 batches (hypothesis B's atomicity
-- fix, 20260906120000_atomic_record_battle_answer.sql; hypothesis C's
-- fractional-average fix, 20260906110000_fix_battle_score_fractional_average.sql):
--
--   1. Both submitResponse() (src/lib/discover.ts, a plain client-side
--      insert, used by Discover AND Catchup) and record_battle_answer()
--      took `is_correct`/`score`/`team` as parameters supplied BY THE
--      CLIENT and wrote them verbatim. RLS on responses/battle_scores
--      (20260906090000_auth_ownership.sql) only ever checked that the
--      caller owns the participant_id -- never that the question/option
--      belong to the same trip, that the option belongs to the question,
--      that the question is published, or that the claimed correctness/
--      score/team match reality. A direct REST call (or a compromised
--      client) holding a legitimate session could submit any is_correct/
--      score/team it liked for its own participant_id.
--   2. answer_options was (and column-grants aside, still is at the base
--      table level) `select *` public before an answer is even submitted
--      -- is_correct reached the client the moment a question loaded, not
--      when it was earned.
--
-- HOW: one SECURITY DEFINER function, record_answer(participant_id,
-- question_id, selected_option_id), replaces both submitResponse() and
-- record_battle_answer(). No mode/isFinal/is_correct/score/team parameter
-- exists to trust: every one of those is derived from the row data itself
-- (questions.points, answer_options.is_correct, participants.role,
-- battles.is_final), and the only client-controlled inputs are the three
-- identifiers whose OWNERSHIP and CROSS-REFERENCES are independently
-- re-verified here regardless of what the client's own UI would normally
-- have prevented.
--
-- IDEMPOTENCY: no separate token. responses' existing
-- `unique (question_id, participant_id)` constraint IS the idempotency
-- key -- both a sequential retry-after-lost-confirmation and a genuine
-- concurrent double-submit hit the exact same Postgres unique_violation,
-- handled by the exact same code path below (catch, re-read, compare).
-- battle_scores gains a new `response_id` (nullable, unique) column that
-- ties a team contribution 1:1 to the response row that earned it -- see
-- "HISTORICAL DATA" below for why it can't be backfilled onto existing
-- rows.
--
-- RETRY CONTRACT (record_answer_result.status):
--   'accepted'         -- first time; both rows written (battle_scores
--                          only if eligible -- see WINDOW LOGIC).
--   'already_recorded' -- retried with the SAME option as an existing
--                          response. Returns that original response
--                          untouched; contributed_to_team reflects
--                          whatever was decided AT THE ORIGINAL CALL,
--                          never re-evaluated against the window at
--                          retry time (a late retry cannot silently gain
--                          -- or lose -- team credit).
--   'conflict'          -- retried with a DIFFERENT option than an
--                          existing response. The original response is
--                          returned, untouched -- this function never
--                          overwrites a prior answer.
-- A raised exception (not a status) means the call was rejected outright
-- (unauthorized participant, cross-trip mismatch, unpublished question,
-- option/question mismatch) -- nothing was written.
--
-- WINDOW LOGIC (team contribution -- unchanged 15-minute duration/rule,
-- see 20260906120000_atomic_record_battle_answer.sql): a battle-kind
-- question can only ever contribute to battle_scores. If the battle
-- already has an individual answer within the last 15 minutes, this
-- answer joins that window exactly as before. If NOBODY has answered
-- this battle individually yet, opening a brand-new window is only
-- allowed when this is happening on the battle's own scheduled trip day
-- (or, for the Final Battle, on/after the trip's last day) -- computed
-- from trips.start_date (a plain `date` column, so this is calendar-date
-- arithmetic in UTC, not a time-of-day/timezone computation; schedule.ts's
-- hour-level windows are deliberately device-local with no stored
-- timezone, per its own header, so they cannot be replicated server-side
-- with the same precision, and this migration does not try to). This is
-- the fix for the product-owner-confirmed case: a battle nobody played
-- live, recovered days later via Catchup (or a direct call to this same
-- RPC -- there is no separate "Catchup mode" anymore), still records a
-- normal personal answer/score, but can never become the team's first --
-- or any -- contribution for that battle.
--
-- HISTORICAL DATA: battle_scores.response_id is added nullable, with NO
-- backfill onto existing rows. A pre-existing battle_scores row only
-- ever stored battle_id (not question_id), so for any battle with more
-- than one question there is no way to determine, after the fact, which
-- specific responses row a given historical battle_scores row came from
-- -- backfilling would mean guessing. Every such row keeps response_id
-- = null permanently; a plain (non-partial) unique constraint on a
-- nullable column already treats multiple nulls as non-conflicting in
-- Postgres, so this is safe as-is. battle_team_score()/
-- trip_battle_win_tally() are untouched -- they aggregate by
-- battle_id/participant_id/team/score exactly as before, never by
-- response_id, so this migration has no effect on any already-computed
-- historical result.
--
-- Answer-key exposure (answer_options.is_correct) is closed in the same
-- migration below, via column-level REVOKE -- not by adding a view, and
-- not by trusting the client to stop asking for it: a raw
-- `select=is_correct` REST call is rejected by Postgres itself now,
-- regardless of what src/lib/discover.ts's own .select() list asks for.

-- ---------------------------------------------------------------------
-- battle_scores: link a team contribution to the response that earned it.
-- ---------------------------------------------------------------------
alter table battle_scores add column response_id uuid references responses (id) on delete cascade;
alter table battle_scores add constraint battle_scores_response_id_key unique (response_id);

-- ---------------------------------------------------------------------
-- Result contract for record_answer().
-- ---------------------------------------------------------------------
create type answer_submission_status as enum ('accepted', 'already_recorded', 'conflict');

create type record_answer_result as (
  status answer_submission_status,
  response responses,
  contributed_to_team boolean,
  correct_option_id uuid
);

-- ---------------------------------------------------------------------
-- The one authoritative write path for every answer submission.
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

  v_score := case when v_is_correct then v_question.points else 0 end;
  v_team := case v_participant.role when 'adult'::participant_role then 'adults'::battle_team else 'kids'::battle_team end;

  begin
    insert into responses (participant_id, question_id, selected_option_id, is_correct)
    values (p_participant_id, p_question_id, p_selected_option_id, v_is_correct)
    returning * into v_response;

    if v_question.kind = 'battle'::question_kind and v_question.battle_id is not null then
      select * into v_battle from battles where id = v_question.battle_id;
      select * into v_trip from trips where id = v_battle.trip_id;

      select min(created_at) into v_first_individual_at
      from battle_scores
      where battle_id = v_battle.id and participant_id is not null;

      if v_first_individual_at is not null then
        -- A window is already open (or already closed) for this battle:
        -- unchanged 15-minute rule, evaluated against server time.
        v_contributed := now() < v_first_individual_at + interval '15 minutes';
      else
        -- Nobody has answered this battle individually yet. Opening a
        -- fresh window is only allowed on the battle's own scheduled
        -- trip day (Final: on/after the trip's last day) -- see WINDOW
        -- LOGIC above. A recovery answer outside that day still counts
        -- personally (the responses insert above already happened) but
        -- can never open -- or join -- a team window.
        v_current_trip_day := case
          when v_trip.start_date is null then 1
          else least(greatest(((now() at time zone 'utc')::date - v_trip.start_date) + 1, 1), v_trip.duration_days)
        end;

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

grant execute on function public.record_answer(uuid, uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- record_battle_answer() is superseded by record_answer() above --
-- src/lib/battle.ts no longer calls it. Left in place (not dropped) only
-- because it's still exercised by
-- supabase/tests/record_battle_answer_atomicity.test.sql as a historical
-- regression fixture for hypothesis B; no code path in the app calls it
-- anymore.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Direct writes to responses/battle_scores are no longer possible for
-- anon/authenticated at all -- record_answer() (SECURITY DEFINER) is now
-- the only way in. Both tables' RLS SELECT policies (R1) are untouched.
-- ---------------------------------------------------------------------
drop policy if exists "a session can submit a response only as its own participant" on responses;
drop policy if exists "a session can submit a battle score only as its own participant" on battle_scores;

-- ---------------------------------------------------------------------
-- Close the answer-key exposure: is_correct is no longer selectable by
-- anon/authenticated at the column level, regardless of what a client's
-- own .select() list asks for or what a raw REST call requests directly.
-- record_answer()'s own returned correct_option_id (SECURITY DEFINER,
-- bypasses this) is the only way an authorized participant learns which
-- option was correct, and only once they have a response on record for
-- that question.
-- ---------------------------------------------------------------------
revoke select on answer_options from anon, authenticated;
grant select (id, question_id, order_index, label, created_at) on answer_options to anon, authenticated;

-- ---------------------------------------------------------------------
-- Batch reveal for the post-trip recap ("Întrebări" page, src/lib/
-- history.ts) -- the other legitimate place (besides record_answer's own
-- immediate return) where the app needs to know which option was
-- correct after the fact, for potentially many questions at once. Same
-- rule as record_answer: only reveals a question's correct option if the
-- caller already has a responses row for it (self or legacy) -- a
-- question this device never answered stays hidden, exactly as today.
-- ---------------------------------------------------------------------
create or replace function public.get_answered_correct_options(p_question_ids uuid[])
returns table (question_id uuid, correct_option_id uuid)
language sql
security definer
stable
set search_path = public
as $$
  select distinct on (r.question_id) r.question_id, ao.id
  from responses r
  join answer_options ao on ao.question_id = r.question_id and ao.is_correct
  where r.question_id = any(p_question_ids)
    and participant_is_self_or_legacy(r.participant_id)
  order by r.question_id, ao.id;
$$;

grant execute on function public.get_answered_correct_options(uuid[]) to anon, authenticated;
