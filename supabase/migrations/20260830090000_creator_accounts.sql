-- Product owner request: whoever creates a public trip should be able to
-- find their trip history again later, from any device -- not just this
-- one. trips.created_by_device_id (20260828100000_public_trip_creation.sql)
-- only ever identifies "this browser", so it can't survive a new phone
-- or a cleared localStorage. A lightweight account -- phone number + PIN,
-- no SMS verification -- lets the same person log back in from anywhere
-- and see every trip tied to their account id, on app/trips/page.tsx.
--
-- Deliberately not real auth: no OTP, no session tokens/cookies. A PIN
-- is checked server-side, once, in app/api/account/route.ts (service-role
-- only -- creator_accounts has no anon policies at all, so a phone
-- number/PIN hash is never reachable via the anon key); the resulting
-- account id is then trusted client-side (stored in localStorage), same
-- accepted-risk model as device_id itself -- see docs/DATABASE.md
-- "Security model". Fine while nothing sensitive rides on it; the fix if
-- that ever changes is real auth (e.g. Supabase Auth's phone/OTP flow).

create table creator_accounts (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,
  pin_hash text not null,
  created_at timestamptz not null default now()
);

alter table creator_accounts enable row level security;
-- Deliberately no select/insert/update policies -- reachable only from
-- app/api/account/route.ts via the service-role key.

alter table trips
  add column created_by_account_id uuid references creator_accounts (id) on delete set null;

create index trips_created_by_account_id_idx on trips (created_by_account_id);
