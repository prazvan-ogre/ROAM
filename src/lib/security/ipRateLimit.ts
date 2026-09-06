import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

// Batch 2 (2026-09-05 review, R1 continued): a second, IP-keyed rate
// limit for identity-creation endpoints (new creator accounts, new
// public trips) -- never a replacement for the existing per-phone
// (loginRateLimit.ts) or per-device checks, an additional signal that
// doesn't reset just because a client clears localStorage or sends a
// fresh device_id. Backed by ip_rate_limits
// (20260907094000_batch2_ip_rate_limits.sql, service-role only).

// R1 (2026-09-05 review, closure batch): the first value of a plain
// x-forwarded-for is NOT automatically trustworthy just because of its
// name -- any client can send their own x-forwarded-for header prefixed
// with a fake IP, and a naive reverse proxy that *appends* rather than
// *overwrites* would leave that fake value sitting first in the chain,
// with the real client IP pushed further down (or last). Whether this
// app's own deployment is safe from that depends entirely on the proxy
// actually in front of it, which is an operational fact, not something
// this function can verify at runtime.
//
// On Vercel specifically (this app's deployment target, per package.json/
// vercel.json): a standard deployment with nothing else in front of it
// overwrites x-forwarded-for outright with the real connecting IP, so the
// old plain read was correct there. But x-vercel-forwarded-for is
// Vercel's own dedicated header for this, documented as harder for an
// upstream layer to clobber than the generic x-forwarded-for -- prefer it
// whenever present, and treat plain x-forwarded-for/x-real-ip as a
// fallback for non-Vercel environments (local dev, a different host)
// rather than the primary source. This narrows, but does not eliminate,
// the trust gap: if this deployment ever sits behind an ADDITIONAL
// untrusted reverse proxy or CDN in front of Vercel, the real client IP
// guarantee depends on that layer being configured correctly (or on
// Vercel's own Enterprise "trust your X-Forwarded-For" feature) --
// REQUIRED OPERATIONAL CONFIRMATION, not something fixable in this file:
// verify no untrusted proxy sits in front of this deployment, or that it
// is configured to forward the real client IP correctly, before relying
// on this for anything more than a soft rate limit.
//
// request.ip isn't available on the standard Request object Next's route
// handlers receive, so headers are the only source here. Returns null
// (never throws) when nothing is present -- callers should treat that as
// "IP unknown" and fall through to whatever other checks they already
// have, not as a free pass with no limit at all.
export function getClientIp(request: Request): string | null {
  const vercelForwardedFor = request.headers.get("x-vercel-forwarded-for");
  if (vercelForwardedFor?.trim()) {
    const first = vercelForwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
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
