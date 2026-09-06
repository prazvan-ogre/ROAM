-- R5 (călătorii nou-create asociate corect creatorului): trips has never
-- recorded a server-verified creator identity. created_by_device_id
-- (20260828100000_public_trip_creation.sql) was introduced ONLY for the
-- "at most one new trip per device per 24h" rate limit -- a plain
-- client-asserted string, reset by clearing localStorage. It was later
-- reused in app/api/account/route.ts and app/api/account/link-trip/
-- route.ts as if it were proof of ownership (`created_by_device_id ===
-- <value the client just sent in this request>`), which is exactly the
-- "trust a client-supplied identifier" mistake 20260906090000_auth_
-- ownership.sql fixed for participants.auth_user_id -- just never
-- ported to trips. docs/ARCHITECTURE.md's own "Public trip creation"
-- section already calls this out as "a cheap check", so this was known
-- to be weak, just never hardened.
--
-- created_by_auth_user_id is the fix, mirroring participants.auth_user_id
-- exactly: stamped server-side at creation time (app/api/trips/create/
-- route.ts) from a bearer token verified against Supabase Auth
-- (resolveBearerAuthUserId), never from a value the client asserts.
-- Every later ownership decision (linking a trip to a creator_accounts
-- row) compares THIS column against the caller's own verified auth user
-- id -- never created_by_device_id, and never a client-supplied
-- accountId/deviceId.
--
-- Nullable, and deliberately NOT backfilled from created_by_device_id:
-- there is no way to verify, after the fact, that a given device_id
-- string actually belonged to the auth session that created a given
-- trip (device_id was never tied to auth.uid() at creation time for
-- these existing rows) -- attempting to backfill would be exactly the
-- "trust a public/client identifier" mistake this migration exists to
-- remove. An existing trip with created_by_auth_user_id still null
-- simply cannot be self-service-linked to a creator_accounts row
-- through this mechanism any more; see the R5 report for the accepted,
-- narrow, manual recovery path for that (device_id is still on the row
-- for whoever needs to investigate a specific case).
--
-- client_request_id: real idempotency key for trip creation itself
-- (same pattern as participants.client_request_id/feedback.
-- client_request_id from R4) -- the client generates one id per
-- creation attempt, kept stable across a retry of that attempt. A lost
-- confirmation (the insert commits, the response never reaches the
-- client) used to mean a retry created a second trip with a different
-- slug; the unique index below makes a retry with the same id return
-- the original trip instead.
alter table trips
  add column created_by_auth_user_id uuid references auth.users (id) on delete set null,
  add column client_request_id uuid;

create index trips_created_by_auth_user_id_idx on trips (created_by_auth_user_id);

create unique index trips_client_request_id_key
  on trips (client_request_id)
  where client_request_id is not null;
