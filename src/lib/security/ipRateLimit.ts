import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Batch 2 (2026-09-05 review, R1 continued): a second, IP-keyed rate
// limit for identity-creation endpoints (new creator accounts, new
// public trips) -- never a replacement for the existing per-phone
// (loginRateLimit.ts) or per-device checks, an additional signal that
// doesn't reset just because a client clears localStorage or sends a
// fresh device_id. Backed by ip_rate_limits
// (20260907094000_batch2_ip_rate_limits.sql, service-role only).

// Vercel (and most proxies) set x-forwarded-for as a comma-separated list,
// client IP first. request.ip isn't available on the standard Request
// object Next's route handlers receive, so headers are the only source
// here -- same as every other IP-based check on this kind of platform.
// Returns null (never throws) when nothing is present, e.g. a local dev
// server with no proxy in front of it -- callers should treat that as
// "IP unknown" and fall through to whatever other checks they already
// have, not as a free pass with no limit at all.
export function getClientIp(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();
  return null;
}

export interface IpRateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

// Sliding-ish window: a fixed window per (ip, action) that resets once
// windowMs has elapsed since it started, same shape as
// loginRateLimit.ts's own attempt-window logic.
export async function checkAndRecordIpAttempt(
  admin: SupabaseClient<Database>,
  ip: string,
  action: string,
  options: { maxAttempts: number; windowMs: number },
): Promise<IpRateLimitResult> {
  const { data, error } = await admin
    .from("ip_rate_limits")
    .select("attempt_count, window_start")
    .eq("ip_address", ip)
    .eq("action", action)
    .maybeSingle();
  if (error) throw error;

  const now = new Date();
  const windowExpired = Boolean(data) && now.getTime() - new Date(data!.window_start).getTime() > options.windowMs;
  const nextCount = !data || windowExpired ? 1 : data.attempt_count + 1;
  const windowStart = !data || windowExpired ? now.toISOString() : data.window_start;

  if (nextCount > options.maxAttempts) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((new Date(windowStart).getTime() + options.windowMs - now.getTime()) / 1000),
    );
    return { allowed: false, retryAfterSeconds };
  }

  const { error: upsertError } = await admin
    .from("ip_rate_limits")
    .upsert({ ip_address: ip, action, attempt_count: nextCount, window_start: windowStart });
  if (upsertError) throw upsertError;

  return { allowed: true };
}
