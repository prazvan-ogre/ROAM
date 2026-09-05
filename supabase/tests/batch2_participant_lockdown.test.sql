-- Batch 2 regression test (2026-09-05 architecture/security review, R1
-- continued): verifies 20260907091000_batch2_participant_lockdown.sql --
-- a participant's ownership/identity columns (trip_id, device_id,
-- auth_user_id, managed_by_participant_id, account_id) cannot be
-- self-granted at INSERT or changed afterward via UPDATE, even by a
-- session that legitimately owns the row.
--
-- Same harness/setup requirements as r1_auth_ownership_rls.test.sql --
-- see that file's own header. Run:
--   PGPASSWORD=postgres psql -U postgres -h localhost -d roam_scratch \
--     -f supabase/tests/batch2_participant_lockdown.test.sql

\set ON_ERROR_STOP on

begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000020a1'), -- the acting session
  ('00000000-0000-0000-0000-0000000020a2'); -- someone else's session

insert into trips (id, slug, name, duration_days) values
  ('00000000-0000-0000-0000-000000002001', 'batch2-lockdown-1', 'Batch2 Lockdown Trip 1', 5),
  ('00000000-0000-0000-0000-000000002002', 'batch2-lockdown-2', 'Batch2 Lockdown Trip 2', 5);

insert into creator_accounts (id, phone_number, pin_hash) values
  ('00000000-0000-0000-0000-000000002099', '+40700000099', null);

insert into participants (id, trip_id, device_id, display_name, role, auth_user_id) values
  ('00000000-0000-0000-0000-000000002011', '00000000-0000-0000-0000-000000002001', 'dev-1', 'Me', 'adult', '00000000-0000-0000-0000-0000000020a1');

commit;

-- -----------------------------------------------------------------------
-- Scenario 1: display_name/role/age/last_seen_at remain freely editable
-- by the owner (Setări > Utilizatori's own edit path must keep working).
-- -----------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000020a1';
set role authenticated;
do $$
declare updated_name text;
begin
  update participants set display_name = 'Me (edited)', age = 34, last_seen_at = now()
  where id = '00000000-0000-0000-0000-000000002011';
  select display_name into updated_name from participants where id = '00000000-0000-0000-0000-000000002011';
  if updated_name = 'Me (edited)' then
    raise notice 'SCENARIO 1 PASS: profile fields remain editable by the owner.';
  else
    raise exception 'SCENARIO 1 FAIL: profile edit did not take effect.';
  end if;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 2: the owner cannot move their own row to a different trip,
-- reassign it to a different auth identity, or self-grant creator-account
-- membership, via UPDATE.
-- -----------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000020a1';
set role authenticated;
do $$
begin
  begin
    update participants set trip_id = '00000000-0000-0000-0000-000000002002' where id = '00000000-0000-0000-0000-000000002011';
    raise exception 'SCENARIO 2a FAIL: trip_id was reassignable via UPDATE.';
  exception when insufficient_privilege then
    raise notice 'SCENARIO 2a PASS: trip_id is immutable via UPDATE.';
  end;

  begin
    update participants set auth_user_id = '00000000-0000-0000-0000-0000000020a2' where id = '00000000-0000-0000-0000-000000002011';
    raise exception 'SCENARIO 2b FAIL: auth_user_id was reassignable via UPDATE.';
  exception when insufficient_privilege then
    raise notice 'SCENARIO 2b PASS: auth_user_id is immutable via UPDATE.';
  end;

  begin
    update participants set account_id = '00000000-0000-0000-0000-000000002099' where id = '00000000-0000-0000-0000-000000002011';
    raise exception 'SCENARIO 2c FAIL: account_id was self-grantable via UPDATE (privilege escalation).';
  exception when insufficient_privilege then
    raise notice 'SCENARIO 2c PASS: account_id cannot be self-granted via UPDATE.';
  end;

  begin
    update participants set device_id = 'someone-elses-device' where id = '00000000-0000-0000-0000-000000002011';
    raise exception 'SCENARIO 2d FAIL: device_id was reassignable via UPDATE.';
  exception when insufficient_privilege then
    raise notice 'SCENARIO 2d PASS: device_id is immutable via UPDATE.';
  end;
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 3: account_id cannot be self-granted at INSERT time either
-- (must be null; only the service role sets it, after verifying a real
-- creator-account session -- see src/lib/security/participantLink.ts).
-- -----------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000020a2';
set role authenticated;
do $$
begin
  insert into participants (id, trip_id, device_id, display_name, role, auth_user_id, account_id)
  values ('00000000-0000-0000-0000-000000002021', '00000000-0000-0000-0000-000000002001', 'dev-2', 'Attacker', 'adult', '00000000-0000-0000-0000-0000000020a2', '00000000-0000-0000-0000-000000002099');
  raise exception 'SCENARIO 3 FAIL: a brand-new participant could self-grant creator-account membership at INSERT.';
exception when insufficient_privilege then
  raise notice 'SCENARIO 3 PASS: account_id must be null at INSERT.';
end $$;
reset role;
rollback;

-- -----------------------------------------------------------------------
-- Scenario 4: managed_by_participant_id at INSERT must point at a
-- participant the SAME session already owns -- can't claim to be managed
-- by an arbitrary other family's adult.
-- -----------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000020a2';
set role authenticated;
do $$
begin
  insert into participants (id, trip_id, device_id, display_name, role, auth_user_id, managed_by_participant_id)
  values ('00000000-0000-0000-0000-000000002031', '00000000-0000-0000-0000-000000002001', 'dev-2', 'Kid', 'child', '00000000-0000-0000-0000-0000000020a2', '00000000-0000-0000-0000-000000002011');
  raise exception 'SCENARIO 4 FAIL: a child could be inserted under a manager the inserting session does not own.';
exception when insufficient_privilege then
  raise notice 'SCENARIO 4 PASS: managed_by_participant_id must belong to the caller''s own session.';
end $$;
reset role;
rollback;

-- A legitimate child insert (own device, no manager, and a manager owned
-- by the same session) must still both work -- this migration must not
-- regress either onboarding-wizard path.
begin;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000020a1';
set role authenticated;
do $$
begin
  insert into participants (id, trip_id, device_id, display_name, role, auth_user_id, managed_by_participant_id)
  values ('00000000-0000-0000-0000-000000002041', '00000000-0000-0000-0000-000000002001', 'dev-1', 'Kid (managed)', 'child', '00000000-0000-0000-0000-0000000020a1', '00000000-0000-0000-0000-000000002011');
  insert into participants (id, trip_id, device_id, display_name, role, auth_user_id)
  values ('00000000-0000-0000-0000-000000002042', '00000000-0000-0000-0000-000000002001', 'dev-3', 'Kid (unmanaged)', 'child', '00000000-0000-0000-0000-0000000020a1');
  raise notice 'SCENARIO 5 PASS: a managed child and an unmanaged child can still be created under the owning session.';
end $$;
reset role;
rollback;
