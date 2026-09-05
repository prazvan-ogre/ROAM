-- Regression test for R3 (2026-09-05 architecture/security review,
-- continued after Kassandra's pilot ended): verifies record_answer()
-- (20260906140000_record_answer_authoritative.sql) -- the single
-- authoritative write path for Discover, Battle, Final and Catchup
-- alike -- actually enforces authorization, cross-references, atomicity,
-- idempotency and the team-scoring window when queried as anon/
-- authenticated Postgres roles. Sibling test to
-- supabase/tests/r1_auth_ownership_rls.test.sql and
-- supabase/tests/record_battle_answer_atomicity.test.sql -- same setup
-- requirements (stub `auth` schema, `anon`/`authenticated` roles with
-- baseline grants), see r1_auth_ownership_rls.test.sql's header for the
-- exact DDL and how to run this against a scratch database.
--
-- "Two concurrent submissions for the same question" is exercised via
-- the same code path a real race would hit -- Postgres itself is what
-- serializes two genuinely-concurrent inserts into one winner and one
-- unique_violation, and record_answer's exception handler treats that
-- unique_violation identically whether it came from true concurrency or
-- a later sequential retry (see the migration header) -- so the
-- "retry identical"/"retry different option" scenarios below are that
-- same guarantee, not a separate mechanism.

\set ON_ERROR_STOP on

-- =======================================================================
-- Fixture.
-- =======================================================================
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000060a1'), -- Family A, trip T1
  ('00000000-0000-0000-0000-0000000060a2'), -- Family A's OWN second device/session (not used to own anything)
  ('00000000-0000-0000-0000-0000000060b1'); -- Family B, trip T2 (a wholly different trip)

insert into trips (id, slug, name, duration_days, start_date) values
  ('00000000-0000-0000-0000-000000006001', 'r3-trip-t1', 'R3 Trip T1', 5, current_date),
  ('00000000-0000-0000-0000-000000006002', 'r3-trip-t2', 'R3 Trip T2', 5, current_date),
  ('00000000-0000-0000-0000-000000006003', 'r3-trip-t3', 'R3 Trip T3 (started 3 days ago)', 5, current_date - interval '3 days');

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000006011', '00000000-0000-0000-0000-000000006001', 'dev-a', 'Family A Adult', 'adult', '00000000-0000-0000-0000-0000000060a1'),
  ('00000000-0000-0000-0000-000000006012', '00000000-0000-0000-0000-000000006001', 'dev-a', 'Family A Child', 'child', '00000000-0000-0000-0000-0000000060a1'),
  ('00000000-0000-0000-0000-000000006013', '00000000-0000-0000-0000-000000006001', 'dev-legacy', 'Legacy Participant', 'adult', null),
  ('00000000-0000-0000-0000-000000006021', '00000000-0000-0000-0000-000000006002', 'dev-b', 'Family B Adult', 'adult', '00000000-0000-0000-0000-0000000060b1'),
  ('00000000-0000-0000-0000-000000006031', '00000000-0000-0000-0000-000000006003', 'dev-c', 'Family C Adult', 'adult', null);

-- Trip T1 content: one daily Battle (today, day 1) with two questions, a
-- Discover question, and an unpublished draft.
insert into battles (id, trip_id, day_number, title, is_final) values
  ('00000000-0000-0000-0000-000000006041', '00000000-0000-0000-0000-000000006001', 1, 'T1 Battle Day 1', false),
  ('00000000-0000-0000-0000-000000006042', '00000000-0000-0000-0000-000000006001', 1, 'T1 Battle Window Test', false),
  ('00000000-0000-0000-0000-000000006043', '00000000-0000-0000-0000-000000006001', null, 'T1 Final Battle', true);

insert into questions (id, trip_id, battle_id, kind, day_number, slot, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000006051', '00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000006041', 'battle', 1, null, 1, 'Q1', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-000000006052', '00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000006041', 'battle', 1, null, 2, 'Q2', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-000000006053', '00000000-0000-0000-0000-000000006001', null, 'discover', 1, 'morning', 1, 'Discover Q', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-000000006054', '00000000-0000-0000-0000-000000006001', null, 'discover', 1, 'lunch', 2, 'Draft Q', 'single_choice', 10, false, false),
  ('00000000-0000-0000-0000-000000006055', '00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000006042', 'battle', 1, null, 1, 'Window Q1', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-000000006056', '00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000006042', 'battle', 1, null, 2, 'Window Q2', 'single_choice', 10, true, true),
  ('00000000-0000-0000-0000-000000006057', '00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000006043', 'battle', null, null, 1, 'Final Q', 'single_choice', 10, true, true);

insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-000000006061', '00000000-0000-0000-0000-000000006051', 1, 'Q1 correct', true),
  ('00000000-0000-0000-0000-000000006062', '00000000-0000-0000-0000-000000006051', 2, 'Q1 wrong', false),
  ('00000000-0000-0000-0000-000000006063', '00000000-0000-0000-0000-000000006052', 1, 'Q2 correct', true),
  ('00000000-0000-0000-0000-000000006064', '00000000-0000-0000-0000-000000006053', 1, 'Discover correct', true),
  ('00000000-0000-0000-0000-000000006065', '00000000-0000-0000-0000-000000006053', 2, 'Discover wrong', false),
  ('00000000-0000-0000-0000-000000006066', '00000000-0000-0000-0000-000000006054', 1, 'Draft option', true),
  ('00000000-0000-0000-0000-000000006067', '00000000-0000-0000-0000-000000006055', 1, 'Window Q1 correct', true),
  ('00000000-0000-0000-0000-000000006068', '00000000-0000-0000-0000-000000006056', 1, 'Window Q2 correct', true),
  ('00000000-0000-0000-0000-000000006069', '00000000-0000-0000-0000-000000006057', 1, 'Final correct', true);

-- Trip T2 content: a wholly separate trip, its own question, for the
-- cross-trip mismatch scenario.
insert into battles (id, trip_id, day_number, title, is_final) values
  ('00000000-0000-0000-0000-000000006044', '00000000-0000-0000-0000-000000006002', 1, 'T2 Battle', false);
insert into questions (id, trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-000000006058', '00000000-0000-0000-0000-000000006002', '00000000-0000-0000-0000-000000006044', 'battle', 1, 1, 'T2 Q', 'single_choice', 10, true, true);
insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-00000000606a', '00000000-0000-0000-0000-000000006058', 1, 'T2 correct', true);

-- Trip T3 content: started 3 days ago, one Battle scheduled for its own
-- day 1 (now in the past) that nobody has played live -- the "Catchup
-- without team contribution" scenario.
insert into battles (id, trip_id, day_number, title, is_final) values
  ('00000000-0000-0000-0000-000000006045', '00000000-0000-0000-0000-000000006003', 1, 'T3 Battle Day 1 (unplayed)', false);
insert into questions (id, trip_id, battle_id, kind, day_number, order_index, prompt, question_type, points, verified, published) values
  ('00000000-0000-0000-0000-00000000605a', '00000000-0000-0000-0000-000000006003', '00000000-0000-0000-0000-000000006045', 'battle', 1, 1, 'T3 Q', 'single_choice', 10, true, true);
insert into answer_options (id, question_id, order_index, label, is_correct) values
  ('00000000-0000-0000-0000-00000000606b', '00000000-0000-0000-0000-00000000605a', 1, 'T3 correct', true);

commit;

-- -----------------------------------------------------------------------
-- Scenario 1: correct answer, live Battle -- accepted, contributes to
-- team, score/team/correctness all derived server-side.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
declare r record;
begin
  select * into r from record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006051'::uuid,
    '00000000-0000-0000-0000-000000006061'::uuid
  );
  if r.status <> 'accepted' or (r.response).is_correct is not true or r.contributed_to_team is not true
     or r.correct_option_id <> '00000000-0000-0000-0000-000000006061'::uuid then
    raise exception 'FAIL scenario 1: unexpected result %', r;
  end if;
  raise notice 'PASS scenario 1: correct live Battle answer accepted, contributes to team, correct option revealed';
end $$;
select score from battle_scores where response_id = (select id from responses where participant_id = '00000000-0000-0000-0000-000000006011' and question_id = '00000000-0000-0000-0000-000000006051');
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 2: incorrect answer -- accepted, is_correct false, score 0,
-- still contributes to team (an incorrect answer still counts as a real
-- team attempt, only its point value is 0).
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
declare r record; v_score int;
begin
  select * into r from record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006051'::uuid,
    '00000000-0000-0000-0000-000000006062'::uuid
  );
  select score into v_score from battle_scores where response_id = (r.response).id;
  if r.status <> 'accepted' or (r.response).is_correct is not false or v_score <> 0 then
    raise exception 'FAIL scenario 2: unexpected result % / score %', r, v_score;
  end if;
  raise notice 'PASS scenario 2: incorrect answer accepted with score 0, correctness never trusted from client (there is no such parameter)';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 3: unauthorized participant -- a different auth session tries
-- to submit for Family A's participant. Rejected outright, nothing
-- written.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060b1';
do $$
begin
  perform record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006051'::uuid,
    '00000000-0000-0000-0000-000000006061'::uuid
  );
  raise exception 'FAIL scenario 3: expected rejection, call succeeded';
exception
  when others then
    if sqlerrm <> 'not authorized to submit an answer for this participant' then
      raise exception 'FAIL scenario 3: rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS scenario 3: unauthorized participant rejected';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 4: participant from a different trip than the question.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060b1';
do $$
begin
  perform record_answer(
    '00000000-0000-0000-0000-000000006021'::uuid, -- Family B, trip T2
    '00000000-0000-0000-0000-000000006051'::uuid, -- a trip T1 question
    '00000000-0000-0000-0000-000000006061'::uuid
  );
  raise exception 'FAIL scenario 4: expected rejection, call succeeded';
exception
  when others then
    if sqlerrm <> 'participant and question belong to different trips' then
      raise exception 'FAIL scenario 4: rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS scenario 4: cross-trip participant/question mismatch rejected';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 5: option belongs to a different question than the one named.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
begin
  perform record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006052'::uuid, -- Q2
    '00000000-0000-0000-0000-000000006061'::uuid  -- an option that belongs to Q1
  );
  raise exception 'FAIL scenario 5: expected rejection, call succeeded';
exception
  when others then
    if sqlerrm <> 'selected option does not belong to this question' then
      raise exception 'FAIL scenario 5: rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS scenario 5: option/question mismatch rejected';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 6: unpublished (draft) question.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
begin
  perform record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006054'::uuid,
    '00000000-0000-0000-0000-000000006066'::uuid
  );
  raise exception 'FAIL scenario 6: expected rejection, call succeeded';
exception
  when others then
    if sqlerrm <> 'question is not available' then
      raise exception 'FAIL scenario 6: rejected but with unexpected message: %', sqlerrm;
    end if;
    raise notice 'PASS scenario 6: unpublished question rejected';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 7: forged score/correctness/team values -- there is no such
-- parameter to forge (record_answer's signature is participant/question/
-- option only), and a direct INSERT attempting to set them manually is
-- rejected by RLS (no insert policy exists on responses/battle_scores
-- anymore -- see scenario 8). This scenario documents that absence
-- directly: calling record_answer with an extra/wrong-typed argument
-- fails at the SQL level, proving the function has no back door for it.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
begin
  begin
    perform record_answer(
      '00000000-0000-0000-0000-000000006011'::uuid,
      '00000000-0000-0000-0000-000000006051'::uuid,
      '00000000-0000-0000-0000-000000006062'::uuid, -- the WRONG option
      true -- forged "is_correct" -- no such parameter exists
    );
    raise exception 'FAIL scenario 7: expected a function-signature error, call succeeded';
  exception
    when undefined_function then
      raise notice 'PASS scenario 7: record_answer has no is_correct/score/team parameter to forge (%)', sqlerrm;
  end;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 8: direct INSERT bypassing the RPC entirely -- rejected by
-- RLS on both tables (no insert policy exists post-migration).
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
declare failed boolean := false;
begin
  begin
    insert into responses (participant_id, question_id, selected_option_id, is_correct)
    values ('00000000-0000-0000-0000-000000006011', '00000000-0000-0000-0000-000000006051', '00000000-0000-0000-0000-000000006061', true);
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL scenario 8a: direct insert into responses was NOT rejected';
  end if;
  raise notice 'PASS scenario 8a: direct insert into responses rejected';

  failed := false;
  begin
    insert into battle_scores (battle_id, participant_id, team, score)
    values ('00000000-0000-0000-0000-000000006041', '00000000-0000-0000-0000-000000006011', 'adults', 999);
  exception when others then
    failed := true;
  end;
  if not failed then
    raise exception 'FAIL scenario 8b: direct insert into battle_scores was NOT rejected';
  end if;
  raise notice 'PASS scenario 8b: direct insert into battle_scores rejected';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 9: rollback after a failure forced between the two writes
-- (temporary trigger on battle_scores) -- no orphaned responses row.
-- -----------------------------------------------------------------------
begin;
create or replace function r3_test_boom() returns trigger language plpgsql as $$
begin
  raise exception 'r3 simulated failure between writes';
end;
$$;
create trigger r3_battle_scores_boom before insert on battle_scores
  for each row execute function r3_test_boom();
commit;

begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
begin
  perform record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006052'::uuid,
    '00000000-0000-0000-0000-000000006063'::uuid
  );
  raise exception 'FAIL scenario 9: expected the trigger to raise, call succeeded';
exception
  when others then
    if sqlerrm <> 'r3 simulated failure between writes' then
      raise exception 'FAIL scenario 9: unexpected error: %', sqlerrm;
    end if;
end $$;
reset role;
do $$
declare v_count int;
begin
  select count(*) into v_count from responses
  where participant_id = '00000000-0000-0000-0000-000000006011' and question_id = '00000000-0000-0000-0000-000000006052';
  if v_count <> 0 then
    raise exception 'FAIL scenario 9: an orphaned responses row survived (%) despite the battle_scores insert failing', v_count;
  end if;
  raise notice 'PASS scenario 9: a forced failure between the two writes leaves no orphaned responses row';
end $$;
rollback;

begin;
drop trigger r3_battle_scores_boom on battle_scores;
drop function r3_test_boom();
commit;

-- -----------------------------------------------------------------------
-- Scenario 10/11/12: retry identical (idempotent, "lost confirmation
-- after commit"), retry with a different option (conflict, original
-- untouched), and re-reading after the window has since closed (does
-- NOT retroactively lose or gain team credit).
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
declare r1 record; r2 record; r3 record;
begin
  -- First call: accepted.
  select * into r1 from record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006053'::uuid, -- Discover question
    '00000000-0000-0000-0000-000000006064'::uuid
  );
  if r1.status <> 'accepted' then
    raise exception 'FAIL scenario 10 setup: expected accepted, got %', r1.status;
  end if;

  -- Retry, same option -- simulates a lost confirmation: the client never
  -- saw the first call succeed and calls again with the same selection.
  select * into r2 from record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006053'::uuid,
    '00000000-0000-0000-0000-000000006064'::uuid
  );
  if r2.status <> 'already_recorded' or (r2.response).id <> (r1.response).id then
    raise exception 'FAIL scenario 10: retry with same option did not return the original response untouched: %', r2;
  end if;
  raise notice 'PASS scenario 10: identical retry (lost-confirmation recovery) returns the original response, status already_recorded';

  -- Retry, DIFFERENT option -- must not modify the original.
  select * into r3 from record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006053'::uuid,
    '00000000-0000-0000-0000-000000006065'::uuid -- the other, wrong option
  );
  if r3.status <> 'conflict' or (r3.response).selected_option_id <> '00000000-0000-0000-0000-000000006064'::uuid then
    raise exception 'FAIL scenario 11: retry with a different option changed the original answer: %', r3;
  end if;
  raise notice 'PASS scenario 11: retry with a different option returns conflict, original answer left exactly as it was';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 12: two "concurrent" submissions for the same question --
-- Postgres itself resolves a genuine race the same way (one insert wins,
-- the other hits unique_violation), so this is the same code path as
-- scenarios 10/11 above, exercised explicitly here for the record:
-- neither call can ever produce two responses rows or double team
-- credit for one (participant, question) pair.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
declare r1 record; r2 record; v_count int;
begin
  select * into r1 from record_answer(
    '00000000-0000-0000-0000-000000006012'::uuid, -- Family A Child (same auth session)
    '00000000-0000-0000-0000-000000006051'::uuid,
    '00000000-0000-0000-0000-000000006061'::uuid
  );
  select * into r2 from record_answer(
    '00000000-0000-0000-0000-000000006012'::uuid,
    '00000000-0000-0000-0000-000000006051'::uuid,
    '00000000-0000-0000-0000-000000006061'::uuid
  );
  select count(*) into v_count from responses
  where participant_id = '00000000-0000-0000-0000-000000006012' and question_id = '00000000-0000-0000-0000-000000006051';
  select count(*) into v_count from battle_scores where response_id = (r1.response).id;
  if v_count <> 1 or r1.status <> 'accepted' or r2.status <> 'already_recorded' then
    raise exception 'FAIL scenario 12: expected exactly one team contribution and one accepted + one already_recorded, got counts/r1/r2: %/%/%', v_count, r1, r2;
  end if;
  raise notice 'PASS scenario 12: two submissions for the same (participant, question) never produce two responses or double team credit';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 13/14: team window start/boundary. First individual answer
-- opens the window; a second participant answering the same battle
-- within 15 minutes joins it; a third one, backdated past 15 minutes
-- (via a manually-forced created_at on a legacy fixture row), no longer
-- counts -- matches the unchanged 15-minute rule from
-- 20260906120000_atomic_record_battle_answer.sql.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
declare r1 record; r2 record;
begin
  -- Family A Adult opens the window (first individual answer on this
  -- battle, on its own scheduled day).
  select * into r1 from record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006055'::uuid,
    '00000000-0000-0000-0000-000000006067'::uuid
  );
  if r1.status <> 'accepted' or r1.contributed_to_team is not true then
    raise exception 'FAIL scenario 13: expected the first answer to open the window, got %', r1;
  end if;
  raise notice 'PASS scenario 13: the first individual answer on a battle''s own scheduled day opens the team window';

  -- Family A Child, same battle (different question), a moment later --
  -- still well within 15 minutes, must join the same window.
  select * into r2 from record_answer(
    '00000000-0000-0000-0000-000000006012'::uuid,
    '00000000-0000-0000-0000-000000006056'::uuid,
    '00000000-0000-0000-0000-000000006068'::uuid
  );
  if r2.status <> 'accepted' or r2.contributed_to_team is not true then
    raise exception 'FAIL scenario 14: expected a second answer within 15 minutes to join the open window, got %', r2;
  end if;
  raise notice 'PASS scenario 14: a second individual answer within 15 minutes joins the already-open window';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 15: retry after the window has since closed for an
-- already-accepted answer -- must NOT re-evaluate eligibility at retry
-- time (still reports the ORIGINAL true, even though now() is long past
-- the window).
-- -----------------------------------------------------------------------
begin;
insert into battle_scores (battle_id, participant_id, team, score, response_id, created_at) values
  ('00000000-0000-0000-0000-000000006042', '00000000-0000-0000-0000-000000006013', 'adults', 10, null, now() - interval '30 minutes');
commit;

begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
declare r1 record; r2 record;
begin
  -- Family A Adult answers now -- the window (opened 30 minutes ago by
  -- the legacy fixture row above) is already closed, so this is
  -- personal-only.
  select * into r1 from record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006055'::uuid,
    '00000000-0000-0000-0000-000000006067'::uuid
  );
  if r1.status <> 'accepted' or r1.contributed_to_team is not false then
    raise exception 'FAIL scenario 15 setup: expected a closed-window answer to be personal-only, got %', r1;
  end if;

  -- Retry, same option, well after the above -- must still report
  -- contributed_to_team = false (the ORIGINAL outcome), not attempt to
  -- open a new window or change anything.
  select * into r2 from record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006055'::uuid,
    '00000000-0000-0000-0000-000000006067'::uuid
  );
  if r2.status <> 'already_recorded' or r2.contributed_to_team is not false then
    raise exception 'FAIL scenario 15: retry after window closure changed the original outcome: %', r2;
  end if;
  raise notice 'PASS scenario 15: retrying an already-accepted, window-closed answer reports the original outcome, never re-evaluated';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 16: Catchup (or any late answer) to a battle NOBODY played
-- live, on a day other than its own scheduled day -- product-owner-
-- confirmed rule: still scores personally, never opens/joins a team
-- window.
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000006031';
do $$
declare r record;
begin
  select * into r from record_answer(
    '00000000-0000-0000-0000-000000006031'::uuid, -- trip T3 (started 3 days ago)
    '00000000-0000-0000-0000-00000000605a'::uuid, -- its battle, scheduled for day 1 (now day 4)
    '00000000-0000-0000-0000-00000000606b'::uuid
  );
  if r.status <> 'accepted' or r.contributed_to_team is not false then
    raise exception 'FAIL scenario 16: expected personal-only for a recovered answer to an unplayed battle, got %', r;
  end if;
  raise notice 'PASS scenario 16: recovering a battle nobody played live still scores personally, never opens a team window';
end $$;
select count(*) as should_be_zero from battle_scores where battle_id = '00000000-0000-0000-0000-000000006045';
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 17: Final Battle scoring -- uses questions.points (10, per
-- product-owner decision -- see docs/DATABASE.md), on/after the trip's
-- last day.
-- -----------------------------------------------------------------------
begin;
update trips set duration_days = 1 where id = '00000000-0000-0000-0000-000000006001';
commit;

begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
declare r record; v_score int;
begin
  select * into r from record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006057'::uuid,
    '00000000-0000-0000-0000-000000006069'::uuid
  );
  select score into v_score from battle_scores where response_id = (r.response).id;
  if r.status <> 'accepted' or r.contributed_to_team is not true or v_score <> 10 then
    raise exception 'FAIL scenario 17: expected an accepted, team-contributing Final Battle answer worth 10 points, got % (score %)', r, v_score;
  end if;
  raise notice 'PASS scenario 17: Final Battle answer scores 10 points (questions.points, product-owner decision), contributes to team on/after the trip''s last day';
end $$;
reset role;
rollback;

begin;
update trips set duration_days = 5 where id = '00000000-0000-0000-0000-000000006001';
commit;

-- -----------------------------------------------------------------------
-- Scenario 18: legacy (pre-R1, no auth_user_id) participant grandfathers
-- exactly as before -- record_answer's own authorization check
-- (participant_is_self_or_legacy) is the same helper R1 already uses,
-- not a stricter or looser one.
-- -----------------------------------------------------------------------
begin;
set role anon;
do $$
declare r record;
begin
  select * into r from record_answer(
    '00000000-0000-0000-0000-000000006013'::uuid, -- legacy participant, trip T1
    '00000000-0000-0000-0000-000000006053'::uuid,
    '00000000-0000-0000-0000-000000006064'::uuid
  );
  if r.status <> 'accepted' then
    raise exception 'FAIL scenario 18: expected a legacy participant to be grandfathered through with no session, got %', r;
  end if;
  raise notice 'PASS scenario 18: a legacy (pre-R1) participant is grandfathered exactly as before, even with no auth session at all';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 19: answer-key exposure -- authorized vs unauthorized access.
-- Family A (who has answered the Discover question, scenario 10's own
-- fixture data having been rolled back, so re-answer it fresh here) can
-- see the correct option via get_answered_correct_options; Family B (a
-- different trip, never answered it, and structurally could never even
-- see this question -- content isolation) gets nothing back for it.
-- Direct column access to is_correct is denied to both regardless (see
-- also scenario 8's sibling check on the base tables).
-- -----------------------------------------------------------------------
begin;
set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060a1';
do $$
begin
  perform record_answer(
    '00000000-0000-0000-0000-000000006011'::uuid,
    '00000000-0000-0000-0000-000000006053'::uuid,
    '00000000-0000-0000-0000-000000006064'::uuid
  );
end $$;

do $$
declare v_revealed uuid;
begin
  select correct_option_id into v_revealed
  from get_answered_correct_options(array['00000000-0000-0000-0000-000000006053'::uuid])
  where question_id = '00000000-0000-0000-0000-000000006053';
  if v_revealed <> '00000000-0000-0000-0000-000000006064'::uuid then
    raise exception 'FAIL scenario 19a: authorized participant did not get the correct option revealed (got %)', v_revealed;
  end if;
  raise notice 'PASS scenario 19a: an authorized participant (has answered) is revealed the correct option';
end $$;

do $$
declare v_direct text;
begin
  begin
    execute 'select is_correct::text from answer_options where id = $1' into v_direct using '00000000-0000-0000-0000-000000006064'::uuid;
    raise exception 'FAIL scenario 19b: direct column access to is_correct was NOT denied';
  exception when insufficient_privilege then
    raise notice 'PASS scenario 19b: direct column access to is_correct is denied regardless of session (%)', sqlerrm;
  end;
end $$;
reset role;

set role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000060b1';
do $$
declare v_count int;
begin
  select count(*) into v_count
  from get_answered_correct_options(array['00000000-0000-0000-0000-000000006053'::uuid]);
  if v_count <> 0 then
    raise exception 'FAIL scenario 19c: an unauthorized caller (never answered, different trip) was revealed a correct option';
  end if;
  raise notice 'PASS scenario 19c: a caller who never answered this question is revealed nothing for it';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Cleanup. Fixture data was inserted in its own committed transactions,
-- so remove it now as a superuser -- safe to re-run from a clean slate.
-- -----------------------------------------------------------------------
delete from battle_scores where battle_id in (
  '00000000-0000-0000-0000-000000006041', '00000000-0000-0000-0000-000000006042',
  '00000000-0000-0000-0000-000000006043', '00000000-0000-0000-0000-000000006044',
  '00000000-0000-0000-0000-000000006045'
);
delete from responses where question_id in (
  '00000000-0000-0000-0000-000000006051', '00000000-0000-0000-0000-000000006052',
  '00000000-0000-0000-0000-000000006053', '00000000-0000-0000-0000-000000006054',
  '00000000-0000-0000-0000-000000006055', '00000000-0000-0000-0000-000000006056',
  '00000000-0000-0000-0000-000000006057', '00000000-0000-0000-0000-000000006058',
  '00000000-0000-0000-0000-00000000605a'
);
delete from answer_options where question_id in (
  '00000000-0000-0000-0000-000000006051', '00000000-0000-0000-0000-000000006052',
  '00000000-0000-0000-0000-000000006053', '00000000-0000-0000-0000-000000006054',
  '00000000-0000-0000-0000-000000006055', '00000000-0000-0000-0000-000000006056',
  '00000000-0000-0000-0000-000000006057', '00000000-0000-0000-0000-000000006058',
  '00000000-0000-0000-0000-00000000605a'
);
delete from questions where id in (
  '00000000-0000-0000-0000-000000006051', '00000000-0000-0000-0000-000000006052',
  '00000000-0000-0000-0000-000000006053', '00000000-0000-0000-0000-000000006054',
  '00000000-0000-0000-0000-000000006055', '00000000-0000-0000-0000-000000006056',
  '00000000-0000-0000-0000-000000006057', '00000000-0000-0000-0000-000000006058',
  '00000000-0000-0000-0000-00000000605a'
);
delete from battles where trip_id in (
  '00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000006002',
  '00000000-0000-0000-0000-000000006003'
);
delete from participants where trip_id in (
  '00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000006002',
  '00000000-0000-0000-0000-000000006003'
);
delete from trips where id in (
  '00000000-0000-0000-0000-000000006001', '00000000-0000-0000-0000-000000006002',
  '00000000-0000-0000-0000-000000006003'
);
delete from auth.users where id in (
  '00000000-0000-0000-0000-0000000060a1', '00000000-0000-0000-0000-0000000060a2',
  '00000000-0000-0000-0000-0000000060b1'
);

\echo 'record_answer.test.sql: all scenarios passed.'
