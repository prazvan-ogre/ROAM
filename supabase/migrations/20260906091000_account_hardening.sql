-- R1 continued: rate-limits phone+PIN attempts, and stops the publicly
-- readable `trips` projection from exposing ownership identifiers.

-- ---------------------------------------------------------------------
-- Login attempt tracking (app/api/account/route.ts). Service-role only
-- (RLS enabled, zero policies) -- same "reachable only via the
-- service-role key" pattern as creator_accounts itself
-- (20260830090000_creator_accounts.sql).
-- ---------------------------------------------------------------------
create table account_login_attempts (
  phone_number text primary key,
  failed_count int not null default 0,
  first_failed_at timestamptz not null default now(),
  locked_until timestamptz
);

alter table account_login_attempts enable row level security;

-- ---------------------------------------------------------------------
-- Public trip data must not carry who created it. created_by_account_id/
-- created_by_device_id are for the account/trip-creation server routes
-- only (already service-role-only writers) -- ordinary trip reads (join
-- flow, Discover/Battle content lookups, etc.) go through this view
-- instead of the base table, so those two columns are never in a
-- publicly-readable response even via a raw column-specific query.
-- ---------------------------------------------------------------------
revoke select on trips from anon, authenticated;

-- Deliberately NOT security_invoker: the view must keep working for
-- anon/authenticated even though direct table SELECT was just revoked
-- from them above -- the same "define with owner's rights" behavior
-- Postgres views have by default is what makes that possible. The
-- underlying "trips are publicly readable" RLS policy is `using (true)`
-- regardless of role, so this doesn't add any actual exposure beyond
-- what the base table's own policy already allows.
create view trips_public as
  select
    id, slug, name, language, start_date, duration_days, destination,
    location_info, content_status, is_active, is_demo, created_at
  from trips;

grant select on trips_public to anon, authenticated;
