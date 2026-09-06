-- Regression test for R5 (călătorii nou-create asociate corect
-- creatorului): verifies, against a real Postgres database (not a
-- mocked Supabase client), that:
--   * a trip's ownership is decided ONLY by created_by_auth_user_id
--     (server-verified), never by created_by_device_id (a plain
--     client-asserted rate-limit key) or a client-supplied accountId;
--   * the atomic conditional UPDATE app/api/account/route.ts and
--     app/api/account/link-trip/route.ts (via
--     src/lib/security/tripOwnership.ts) use to claim a trip can never
--     let two concurrent requests assign different owners, and never
--     implicitly transfers a trip already linked to another account;
--   * client_request_id (trip creation's own idempotency key) rejects a
--     true duplicate while leaving legacy NULL rows unaffected.
--
-- Requires the same scratch database setup as r1_auth_ownership_rls.test.sql
-- (all migrations applied, including 20260907130000_r5_trip_creator_
-- verification.sql, plus the auth.users stub -- see that file's own
-- header, or supabase/ci-bootstrap.sql for CI). Run as a superuser:
--   PGPASSWORD=postgres psql -U postgres -h localhost -d roam_r5 \
--     -f supabase/tests/r5_trip_creator_ownership.test.sql
--
-- Each scenario is its own transaction that rolls back, so the file is
-- safe to re-run.

\set ON_ERROR_STOP on

-- =======================================================================
-- Scenario 1: an authenticated creator's two trips both get associated,
-- using only the server-verified auth_user_id -- device_id plays no
-- part in the decision.
-- =======================================================================
begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000005a1');
insert into creator_accounts (id, phone_number, auth_user_id) values
  ('00000000-0000-0000-0000-0000000005c1', '+40700000501', '00000000-0000-0000-0000-0000000005a1');

insert into trips (id, slug, name, duration_days, created_by_device_id, created_by_auth_user_id) values
  ('00000000-0000-0000-0000-000000000511', 'r5-trip-one', 'R5 Trip One', 5, 'device-1', '00000000-0000-0000-0000-0000000005a1'),
  ('00000000-0000-0000-0000-000000000512', 'r5-trip-two', 'R5 Trip Two', 5, 'device-2', '00000000-0000-0000-0000-0000000005a1');

-- Same query shape as linkOwnedTripsToAccount (src/lib/security/
-- tripOwnership.ts): find every trip this exact verified auth user
-- created and hasn't linked anywhere, then claim each with an atomic
-- conditional update.
do $$
declare trip_id uuid;
begin
  for trip_id in
    select id from trips
    where created_by_auth_user_id = '00000000-0000-0000-0000-0000000005a1'
      and created_by_account_id is null
  loop
    update trips set created_by_account_id = '00000000-0000-0000-0000-0000000005c1'
      where id = trip_id and created_by_account_id is null;
  end loop;
end $$;

do $$
declare linked_count bigint;
begin
  select count(*) into linked_count from trips
  where id in ('00000000-0000-0000-0000-000000000511', '00000000-0000-0000-0000-000000000512')
    and created_by_account_id = '00000000-0000-0000-0000-0000000005c1';

  if linked_count = 2 then
    raise notice 'SCENARIO 1 PASS: both trips associated to the creator''s account via auth_user_id alone.';
  else
    raise exception 'SCENARIO 1 FAIL: expected both trips linked, got %', linked_count;
  end if;
end $$;

rollback;

-- =======================================================================
-- Scenario 2: two concurrent requests (two different creator_accounts,
-- both authenticated as the SAME device) racing to claim the SAME trip
-- -- only one may win, never both, never a silent last-write-wins
-- overwrite.
-- =======================================================================
begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000005a2');
insert into creator_accounts (id, phone_number, auth_user_id) values
  ('00000000-0000-0000-0000-0000000005c2', '+40700000502', '00000000-0000-0000-0000-0000000005a2'),
  ('00000000-0000-0000-0000-0000000005c3', '+40700000503', null);

insert into trips (id, slug, name, duration_days, created_by_auth_user_id) values
  ('00000000-0000-0000-0000-000000000521', 'r5-trip-race', 'R5 Trip Race', 5, '00000000-0000-0000-0000-0000000005a2');

do $$
declare first_affected bigint;
declare second_affected bigint;
declare final_owner uuid;
begin
  -- "Request 1" wins the race.
  update trips set created_by_account_id = '00000000-0000-0000-0000-0000000005c2'
    where id = '00000000-0000-0000-0000-000000000521' and created_by_account_id is null;
  get diagnostics first_affected = row_count;

  -- "Request 2" (a different account, same verified device) arrives a
  -- moment later -- the `created_by_account_id is null` guard is
  -- re-checked by Postgres at update time, so this must affect zero
  -- rows, not overwrite the winner.
  update trips set created_by_account_id = '00000000-0000-0000-0000-0000000005c3'
    where id = '00000000-0000-0000-0000-000000000521' and created_by_account_id is null;
  get diagnostics second_affected = row_count;

  select created_by_account_id into final_owner from trips where id = '00000000-0000-0000-0000-000000000521';

  if first_affected = 1 and second_affected = 0 and final_owner = '00000000-0000-0000-0000-0000000005c2' then
    raise notice 'SCENARIO 2 PASS: only the first request claimed the trip; the second was a no-op, never a transfer.';
  else
    raise exception 'SCENARIO 2 FAIL: first_affected=%, second_affected=%, final_owner=%', first_affected, second_affected, final_owner;
  end if;
end $$;

rollback;

-- =======================================================================
-- Scenario 3: knowing a trip's slug and its created_by_device_id (both
-- effectively public/guessable -- device_id is never exposed via
-- trips_public, but this proves the query itself doesn't depend on it
-- even if it were) grants no ownership to an account authenticated as a
-- DIFFERENT, unrelated auth_user_id.
-- =======================================================================
begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000005a4'), -- the real creator
  ('00000000-0000-0000-0000-0000000005a5'); -- an unrelated attacker session

insert into trips (id, slug, name, duration_days, created_by_device_id, created_by_auth_user_id) values
  ('00000000-0000-0000-0000-000000000531', 'r5-trip-target', 'R5 Trip Target', 5, 'device-known-to-attacker', '00000000-0000-0000-0000-0000000005a4');

do $$
declare matched_as_attacker uuid[];
begin
  -- Exactly the query linkOwnedTripsToAccount runs, as the attacker's
  -- own (genuinely verified, just different) auth_user_id -- device_id
  -- is not part of the WHERE clause at all, so knowing it changes
  -- nothing.
  select array_agg(id) into matched_as_attacker from trips
  where created_by_auth_user_id = '00000000-0000-0000-0000-0000000005a5'
    and created_by_account_id is null;

  if matched_as_attacker is null then
    raise notice 'SCENARIO 3 PASS: the attacker''s own verified identity matches none of the real creator''s trips.';
  else
    raise exception 'SCENARIO 3 FAIL: attacker query unexpectedly matched trips: %', matched_as_attacker;
  end if;
end $$;

rollback;

-- =======================================================================
-- Scenario 4: a trip already linked to one account is never implicitly
-- transferred to another, even when that other account is authenticated
-- as the exact same verified device.
-- =======================================================================
begin;

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000005a6');
insert into creator_accounts (id, phone_number, auth_user_id) values
  ('00000000-0000-0000-0000-0000000005c6', '+40700000506', '00000000-0000-0000-0000-0000000005a6'),
  ('00000000-0000-0000-0000-0000000005c7', '+40700000507', null);

insert into trips (id, slug, name, duration_days, created_by_auth_user_id, created_by_account_id) values
  ('00000000-0000-0000-0000-000000000541', 'r5-trip-owned', 'R5 Trip Owned', 5, '00000000-0000-0000-0000-0000000005a6', '00000000-0000-0000-0000-0000000005c6');

do $$
declare affected bigint;
declare owner_after uuid;
begin
  update trips set created_by_account_id = '00000000-0000-0000-0000-0000000005c7'
    where id = '00000000-0000-0000-0000-000000000541' and created_by_account_id is null;
  get diagnostics affected = row_count;

  select created_by_account_id into owner_after from trips where id = '00000000-0000-0000-0000-000000000541';

  if affected = 0 and owner_after = '00000000-0000-0000-0000-0000000005c6' then
    raise notice 'SCENARIO 4 PASS: an already-linked trip stayed with its original account.';
  else
    raise exception 'SCENARIO 4 FAIL: affected=%, owner_after=%', affected, owner_after;
  end if;
end $$;

rollback;

-- =======================================================================
-- Scenario 5: client_request_id (trip-creation idempotency) rejects a
-- true duplicate but never blocks two legacy (NULL) rows.
-- =======================================================================
begin;

insert into trips (id, slug, name, duration_days, client_request_id) values
  ('00000000-0000-0000-0000-000000000551', 'r5-trip-retry-a', 'R5 Trip Retry A', 5, '00000000-0000-0000-0000-0000000005d1');

do $$
begin
  begin
    insert into trips (id, slug, name, duration_days, client_request_id) values
      ('00000000-0000-0000-0000-000000000552', 'r5-trip-retry-b', 'R5 Trip Retry B', 5, '00000000-0000-0000-0000-0000000005d1');
    raise exception 'SCENARIO 5 FAIL: a duplicate client_request_id was allowed to insert a second trip.';
  exception
    when unique_violation then
      raise notice 'SCENARIO 5 PASS: a duplicate client_request_id was rejected (23505), exactly the retry-reconciliation signal the route expects.';
  end;
end $$;

insert into trips (id, slug, name, duration_days) values
  ('00000000-0000-0000-0000-000000000553', 'r5-trip-legacy-a', 'R5 Trip Legacy A', 5),
  ('00000000-0000-0000-0000-000000000554', 'r5-trip-legacy-b', 'R5 Trip Legacy B', 5);

do $$
declare legacy_count bigint;
begin
  select count(*) into legacy_count from trips
  where id in ('00000000-0000-0000-0000-000000000553', '00000000-0000-0000-0000-000000000554')
    and client_request_id is null;

  if legacy_count = 2 then
    raise notice 'SCENARIO 5b PASS: two legacy trips with no client_request_id both insert fine (NULLs never collide).';
  else
    raise exception 'SCENARIO 5b FAIL: expected 2 legacy rows, got %', legacy_count;
  end if;
end $$;

rollback;
