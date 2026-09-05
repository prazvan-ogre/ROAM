-- Batch 2 regression test (2026-09-05 architecture/security review, R1
-- continued): verifies 20260907092000_batch2_battle_aggregate_authz.sql
-- -- battle_team_score()/trip_battle_win_tally() now reject a caller who
-- isn't a member of the trip the battle/id belongs to, instead of
-- returning that family's result to anyone holding the anon key. Also
-- confirms the scoring formula itself is untouched (same result a
-- legitimate member gets as before this migration).
--
-- Same harness/setup requirements as r1_auth_ownership_rls.test.sql --
-- see that file's own header. Run:
--   PGPASSWORD=postgres psql -U postgres -h localhost -d roam_scratch \
--     -f supabase/tests/batch2_battle_aggregate_authz.test.sql

\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000030a1'), -- trip member
  ('00000000-0000-0000-0000-0000000030c1'); -- outsider, different trip

insert into trips (id, slug, name, duration_days) values
  ('00000000-0000-0000-0000-000000003001', 'batch2-battle-authz', 'Batch2 Battle Authz Trip', 5);

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000003011', '00000000-0000-0000-0000-000000003001', 'dev-1', 'Member', 'adult', '00000000-0000-0000-0000-0000000030a1');

insert into battles (id, trip_id, title) values
  ('00000000-0000-0000-0000-000000003021', '00000000-0000-0000-0000-000000003001', 'Battle 1');

insert into battle_scores (battle_id, participant_id, team, score) values
  ('00000000-0000-0000-0000-000000003021', '00000000-0000-0000-0000-000000003011', 'adults', 10);

commit;

-- -----------------------------------------------------------------------
-- Scenario 1: a genuine trip member can read the aggregate, and gets the
-- same numbers the pre-batch-2 formula produced (formula untouched).
-- -----------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030a1';
set role authenticated;
do $$
declare adults_score numeric;
begin
  select score into adults_score from battle_team_score('00000000-0000-0000-0000-000000003021') where team = 'adults';
  if adults_score = 10 then
    raise notice 'SCENARIO 1 PASS: a trip member reads the correct, unchanged aggregate score (adults=%).', adults_score;
  else
    raise exception 'SCENARIO 1 FAIL: expected adults=10, got %', adults_score;
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 2: an outsider (different trip entirely) cannot read this
-- trip's battle result via either function -- this is the actual fix.
-- -----------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030c1';
set role authenticated;
do $$
begin
  begin
    perform * from battle_team_score('00000000-0000-0000-0000-000000003021');
    raise exception 'SCENARIO 2a FAIL: an outsider read battle_team_score() for a trip they are not a member of.';
  exception when others then
    if sqlstate = '42501' then
      raise notice 'SCENARIO 2a PASS: outsider battle_team_score() call rejected (%).', sqlerrm;
    else
      raise exception 'SCENARIO 2a FAIL: rejected for the wrong reason (sqlstate=%, %)', sqlstate, sqlerrm;
    end if;
  end;

  begin
    perform * from trip_battle_win_tally('00000000-0000-0000-0000-000000003001');
    raise exception 'SCENARIO 2b FAIL: an outsider read trip_battle_win_tally() for a trip they are not a member of.';
  exception when others then
    if sqlstate = '42501' then
      raise notice 'SCENARIO 2b PASS: outsider trip_battle_win_tally() call rejected (%).', sqlerrm;
    else
      raise exception 'SCENARIO 2b FAIL: rejected for the wrong reason (sqlstate=%, %)', sqlstate, sqlerrm;
    end if;
  end;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 3: an unrecognized battle id (doesn't exist at all) is
-- rejected the same way as a real-but-foreign one, not with a different
-- error that would let a caller distinguish "exists but not yours" from
-- "doesn't exist".
-- -----------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000030c1';
set role authenticated;
do $$
begin
  perform * from battle_team_score('ffffffff-ffff-ffff-ffff-ffffffffffff');
  raise exception 'SCENARIO 3 FAIL: a nonexistent battle id did not raise.';
exception when others then
  if sqlstate = '42501' then
    raise notice 'SCENARIO 3 PASS: a nonexistent battle id is rejected the same way as a real, foreign one.';
  else
    raise exception 'SCENARIO 3 FAIL: rejected for the wrong reason (sqlstate=%, %)', sqlstate, sqlerrm;
  end if;
end $$;
reset role;
rollback;
