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
-- exercise the real functions/policies. It is NOT a full Supabase Auth
-- emulation -- there is no phone/OTP provider, no JWT issuance, nothing
-- that mints a real session. auth.uid() below is a stub reading whatever
-- the *test file itself* puts in the `request.jwt.claim.sub` session
-- variable (`select set_config('request.jwt.claim.sub', '<uuid>', ...)`,
-- see r1_auth_ownership_rls.test.sql and every batch2_*.test.sql for the
-- pattern) -- a test that never sets it (or runs as anon) correctly sees
-- auth.uid() as NULL, exactly like an unauthenticated request would.
--
-- Base table privileges: a real Supabase project GRANTs SELECT/INSERT/
-- UPDATE/DELETE on every table to anon/authenticated at creation time
-- (RLS is what actually restricts access despite that broad grant, not
-- the grant itself) -- this bootstrap has to replicate that with `ALTER
-- DEFAULT PRIVILEGES`, run before any migration creates a table, so
-- every table created afterward picks it up automatically. Without this,
-- `set role anon`/`set role authenticated` inside a test fails outright
-- with "permission denied for table ..." before ever reaching an RLS
-- check -- confirmed the hard way: test:sql:r1 and the batch2_*.test.sql
-- files were wired into CI without this, and every one of them failed on
-- their very first `set role`/`select`, not on any real RLS assertion.

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

grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

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
