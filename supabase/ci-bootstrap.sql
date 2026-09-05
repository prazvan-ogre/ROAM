-- CI-only bootstrap for a bare `postgres:16` service container (no
-- Supabase project behind it), run once, before supabase/migrations/*.sql.
--
-- WHY THIS EXISTS: a real Supabase project provisions the `anon` and
-- `authenticated` roles, an `auth` schema (with `auth.users` and
-- `auth.uid()`), and a `supabase_realtime` publication automatically. CI's
-- battle-scoring-tests job (.github/workflows/ci.yml) only gets a stock
-- postgres:16 image with none of that -- migrations that `grant ... to
-- anon, authenticated`, reference `auth.users`/`auth.uid()`, or `alter
-- publication supabase_realtime add table ...` all fail outright without
-- this step (confirmed: 20260825090100_activity_tables.sql was the first
-- to fail, with `ON_ERROR_STOP=1` aborting the whole migration sequence
-- before any later migration -- including the ones the SQL regression
-- tests actually exercise -- ever got a chance to run).
--
-- WHAT THIS IS NOT: this is the minimum needed for `psql -f` to apply
-- every migration in supabase/migrations/ without erroring, so that
-- supabase/tests/*.test.sql can run against a fully-migrated schema and
-- exercise the real functions/policies. It is NOT a Supabase Auth
-- emulation -- auth.uid() below is a bare stub that only ever returns
-- NULL (nothing in this repo's CI sets `request.jwt.claim.sub`), so any
-- RLS policy that depends on a specific authenticated identity (e.g.
-- "a session can only create participants for itself", see
-- 20260906100000_participants_self_read_fix.sql and
-- 20260906090000_auth_ownership.sql) cannot be meaningfully exercised
-- through this bootstrap alone -- it only proves those migrations *apply*
-- cleanly, not that the RLS policies they create behave correctly under a
-- real authenticated session. Verifying that needs either a real
-- Supabase local dev stack (`supabase start`) or a test harness that can
-- set `request.jwt.claim.sub` per statement (e.g. `set local
-- request.jwt.claim.sub = '...'`) -- out of scope for this batch.

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end
$$;

-- Every real Supabase project creates this publication by default;
-- 20260831090000_realtime_publication.sql only ever ALTERs it.
do $$
begin
  if not exists (select from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

-- Minimal stand-in for Supabase's `auth` schema: just enough structure
-- (a `users` table with the `id` column 20260906090000_auth_ownership.sql
-- foreign-keys `participants.auth_user_id` against, plus a stub
-- `auth.uid()`) for CREATE TABLE/CREATE POLICY/CREATE FUNCTION statements
-- referencing them to succeed. No row is ever inserted into auth.users by
-- these migrations or by supabase/tests/*.test.sql, and auth.uid()
-- always returns NULL here -- see "WHAT THIS IS NOT" above.
create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
