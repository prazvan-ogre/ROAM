-- Admin view over /trips: a single flagged creator_accounts row that,
-- once logged in (same phone+PIN flow as any other account,
-- app/api/account/route.ts), sees every trip on the platform instead of
-- just the ones linked to that account id -- so pending/failed trip
-- requests are visible in one place too, not only "ready" ones.
--
-- No new auth mechanism: is_admin rides on the same accepted-risk model
-- as creator_accounts itself (docs/DATABASE.md "Security model") -- the
-- PIN is checked server-side once, the resulting flag is then trusted
-- client-side. Not a place to put anything more sensitive than "which
-- trips exist."

alter table creator_accounts
  add column is_admin boolean not null default false;

-- Seed the one admin account: phone 0721345678, PIN 1234 (scrypt hash
-- below, generated the same way app/api/account/route.ts hashes any
-- other PIN -- see src/lib/security/pin.ts). On conflict, promote the
-- existing account and reset its PIN to the known value so the login
-- above always works.
insert into creator_accounts (phone_number, pin_hash, is_admin)
values (
  '0721345678',
  '45b6319236e5d9e974fb1449336a9826:1feb6c5f2359f143c0a9582a82437bcdf7824705c6dcb0bd3ac9e753d8a9c39dd3d44aa9fff216d1b1d3b5f635a581037bd98421298fd1b22451af67ad3ae17a',
  true
)
on conflict (phone_number) do update
  set is_admin = true,
      pin_hash = excluded.pin_hash;
