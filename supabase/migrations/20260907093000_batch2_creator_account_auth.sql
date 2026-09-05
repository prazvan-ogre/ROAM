-- Batch 2 (2026-09-05 review, R1 continued): "Călătoriile mele" creator
-- accounts still had no server-*verifiable* session at all -- R1
-- (20260906090000_auth_ownership.sql's PR) replaced the bare
-- client-supplied accountId with a small HMAC-signed, httpOnly cookie
-- (src/lib/security/session.ts), which is real hardening (a forged
-- accountId can no longer be asserted), but it's still a hand-rolled
-- token scheme, not the auth provider's own session mechanism -- exactly
-- what this batch's review explicitly asks to replace ("use the
-- provider's existing mechanisms; don't build your own token/auth
-- system"), the same way device participants already sit on a real
-- Supabase Auth session (supabase.auth.signInAnonymously()) instead of a
-- bare device_id.
--
-- creator_accounts.auth_user_id links each account to its own real
-- Supabase Auth user (phone + password, the "password" being the same
-- 4-6 digit PIN the product already uses -- see app/api/account/route.ts
-- for how login/signup now work). This is a SEPARATE Supabase Auth
-- identity from a device's own anonymous participant session -- a
-- browser can hold both at once because the creator-account session is
-- never touched by the browser's own supabase-js client instance at all;
-- it lives only as httpOnly cookies a server route reads/verifies
-- directly (src/lib/security/creatorSession.ts). See that file and
-- app/api/account/route.ts for the full login/signup/lazy-migration
-- flow, and the PR description for the operational rollout step this
-- needs (Supabase project Auth settings: phone provider enabled,
-- minimum password length lowered to match the existing PIN policy --
-- see that same file's header).
--
-- Nullable, like participants.auth_user_id: an existing creator_accounts
-- row (pin_hash only, no Supabase Auth user yet) is lazily migrated the
-- next time its phone+PIN successfully logs in (verified against the old
-- scrypt hash exactly once), never backfilled here -- see
-- app/api/account/route.ts's handleAccount(). pin_hash itself is kept
-- (not dropped) for exactly that one-time bridge; a freshly created
-- account after this migration never has one written, and a lazily
-- migrated account has it cleared once its Supabase Auth user exists, so
-- pin_hash being non-null becomes the "not yet migrated" signal itself.
alter table creator_accounts
  add column auth_user_id uuid references auth.users (id) on delete set null,
  alter column pin_hash drop not null;

create unique index creator_accounts_auth_user_id_idx on creator_accounts (auth_user_id);

-- creator_accounts keeps zero RLS policies for anon/authenticated (same
-- as 20260830090000_creator_accounts.sql -- reachable only via the
-- service-role key from app/api/account/*): the account's own Supabase
-- Auth session is verified server-side (admin.auth.getUser(accessToken)),
-- then creator_accounts is looked up by auth_user_id using the
-- service-role client, exactly like every other creator_accounts read/
-- write already worked. There is no defense-in-depth reason to also open
-- a direct-Supabase-call path here the app itself never uses.
