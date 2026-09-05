import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// R1: app/api/account/route.ts's phone+PIN login had no limit on failed
// attempts -- a PIN is only 4-6 digits, so an unthrottled endpoint is
// brute-forceable in a very small number of requests. Backed by
// account_login_attempts (20260906091000_account_hardening.sql,
// service-role only), keyed on phone_number since that's the only
// identifier known before the PIN is checked.
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

export interface LoginLockStatus {
  locked: boolean;
  retryAfterSeconds?: number;
}

export async function checkLoginLock(
  admin: SupabaseClient<Database>,
  phoneNumber: string,
): Promise<LoginLockStatus> {
  const { data, error } = await admin
    .from("account_login_attempts")
    .select("locked_until")
    .eq("phone_number", phoneNumber)
    .maybeSingle();
  if (error) throw error;
  if (!data?.locked_until) return { locked: false };

  const lockedUntilMs = new Date(data.locked_until).getTime();
  if (lockedUntilMs <= Date.now()) return { locked: false };

  return { locked: true, retryAfterSeconds: Math.ceil((lockedUntilMs - Date.now()) / 1000) };
}

// Widening (not resetting) the failure window means a slow trickle of
// attempts across many separate windows still eventually locks, instead
// of a patient attacker resetting the counter by pacing requests.
export async function recordFailedLogin(admin: SupabaseClient<Database>, phoneNumber: string): Promise<void> {
  const { data, error } = await admin
    .from("account_login_attempts")
    .select("failed_count, first_failed_at")
    .eq("phone_number", phoneNumber)
    .maybeSingle();
  if (error) throw error;

  const now = new Date();
  const windowExpired = Boolean(data) && now.getTime() - new Date(data!.first_failed_at).getTime() > ATTEMPT_WINDOW_MS;
  const nextCount = !data || windowExpired ? 1 : data.failed_count + 1;
  const firstFailedAt = !data || windowExpired ? now.toISOString() : data.first_failed_at;
  const lockedUntil = nextCount >= MAX_ATTEMPTS ? new Date(now.getTime() + LOCK_DURATION_MS).toISOString() : null;

  const { error: upsertError } = await admin.from("account_login_attempts").upsert({
    phone_number: phoneNumber,
    failed_count: nextCount,
    first_failed_at: firstFailedAt,
    locked_until: lockedUntil,
  });
  if (upsertError) throw upsertError;
}

export async function resetLoginAttempts(admin: SupabaseClient<Database>, phoneNumber: string): Promise<void> {
  const { error } = await admin.from("account_login_attempts").delete().eq("phone_number", phoneNumber);
  if (error) throw error;
}
