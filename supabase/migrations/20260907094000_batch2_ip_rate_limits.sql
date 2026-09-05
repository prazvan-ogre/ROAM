-- Batch 2 (2026-09-05 review, R1 continued): "Limitează încercările de
-- autentificare și abuzul asupra creării identităților ... nu baza
-- limitele exclusiv pe un deviceId trimis de client." Two identity-
-- creation paths had exactly that gap:
--   - app/api/trips/create/route.ts capped new trips at 1/device/24h
--     (trips.created_by_device_id) plus a global daily circuit breaker --
--     but device_id is a plain client-asserted string
--     (src/lib/device.ts), trivially reset by clearing localStorage or
--     spoofed outright in a scripted request.
--   - app/api/account (POST, brand-new-phone-number branch) had NO limit
--     at all on creating new creator_accounts rows (only *failed
--     logins* against an already-existing phone number were rate-limited,
--     account_login_attempts, 20260906091000_account_hardening.sql) --
--     an attacker could mass-create accounts (and, once this batch wires
--     up real Supabase Auth users per account, mass-create auth.users
--     rows) with no limit whatsoever.
--
-- ip_rate_limits adds a second, IP-keyed signal alongside both existing
-- per-identifier checks (never a replacement for them -- a device/phone
-- number is still checked too) -- service-role only (RLS enabled, zero
-- policies), same "reachable only via the service-role key" pattern as
-- account_login_attempts. Storing the caller's IP address directly
-- (`x-forwarded-for`, see src/lib/security/ipRateLimit.ts) rather than a
-- keyed hash: an IP is not a credential or a secret, and an unsalted
-- hash of a value from such a small address space would be trivially
-- reversible anyway, so hashing it would add complexity without adding
-- real privacy. These rows are short-lived rate-limit counters, not an
-- audit log -- pruning old rows (e.g. a daily cron deleting anything
-- past its window) is a reasonable operational follow-up, not done here.
create table ip_rate_limits (
  ip_address text not null,
  action text not null,
  attempt_count int not null default 0,
  window_start timestamptz not null default now(),
  primary key (ip_address, action)
);

alter table ip_rate_limits enable row level security;
