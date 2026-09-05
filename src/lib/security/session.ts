import { createClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Batch 2 (2026-09-05 review, R1 continued): replaces the custom
// HMAC-signed cookie this file used to issue (see git history --
// R1's own first pass at "Călătoriile mele" sessions) with a real
// Supabase Auth session for the creator account itself -- the provider's
// own token/session mechanism, not a hand-rolled one, closing the exact
// gap the review calls out. Each creator account now has its own
// Supabase Auth user (phone + password, "password" = the same 4-6 digit
// PIN the product already uses), created/looked up via the service-role
// admin API (never a live SMS OTP -- see app/api/account/route.ts's
// header for the full flow and the required Auth-settings rollout step).
//
// This is a SEPARATE Supabase Auth session from a device's own anonymous
// participant session (src/lib/device.ts) -- the two coexist in the same
// browser without conflict because this one is never handed to the
// browser's own supabase-js client instance at all. It exists only as
// two httpOnly cookies (access + refresh token), read and verified here,
// server-side, on every request that needs it. The browser's anon client
// keeps managing the device's own anonymous session entirely
// independently, exactly as before.
//
// Server-only (imports the service-role admin client) -- never import
// from a "use client" component.

export const ACCESS_COOKIE_NAME = "roam_account_access";
export const REFRESH_COOKIE_NAME = "roam_account_refresh";
// Supabase's own default access-token lifetime is 1h; refresh tokens are
// long-lived by design (rotate on use). 30 days matches this file's old
// flat session lifetime -- a creator who doesn't come back for 30 days
// simply has to log in again, same as before.
export const REFRESH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

// A plain anon-key client, never persisting a session server-side (there
// is no browser localStorage here, and one server process handles many
// different accounts' requests) -- used only for the two auth operations
// an end user's own credentials drive: signInWithPassword and
// refreshSession. Account creation/lookup/password changes go through
// the service-role admin API instead (createAdminClient()), which can
// act on any user without holding their password.
function createAuthOnlyClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export function signInWithPhonePassword(phone: string, password: string) {
  return createAuthOnlyClient().auth.signInWithPassword({ phone, password });
}

export function refreshWithToken(refreshToken: string) {
  return createAuthOnlyClient().auth.refreshSession({ refresh_token: refreshToken });
}

// Best-effort server-side logout: sets the session on a throwaway client
// so signOut() can revoke the underlying refresh token with Supabase,
// not just remove the cookie locally. A failure here (already-expired
// tokens, network hiccup) is never fatal -- the caller clears the
// cookies regardless (see clearAccountSessionCookies), which is the part
// that actually matters to the browser.
export async function signOutTokens(accessToken: string, refreshToken: string): Promise<void> {
  const client = createAuthOnlyClient();
  await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  await client.auth.signOut();
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) continue;
    if (part.slice(0, separatorIndex).trim() === name) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }
  return undefined;
}

export function setAccountSessionCookies(response: NextResponse, tokens: AuthTokens): void {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(ACCESS_COOKIE_NAME, tokens.access_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    // A few seconds of slack so a request landing right at expiry still
    // has the cookie present to attempt (and fall through to the
    // refresh-token path below) rather than the browser having already
    // dropped it.
    maxAge: tokens.expires_in + 30,
  });
  response.cookies.set(REFRESH_COOKIE_NAME, tokens.refresh_token, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: REFRESH_COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearAccountSessionCookies(response: NextResponse): void {
  response.cookies.delete(ACCESS_COOKIE_NAME);
  response.cookies.delete(REFRESH_COOKIE_NAME);
}

export interface ResolvedAccountSession {
  accountId: string;
  authUserId: string;
  // Set only when the access-token cookie was missing/expired and a
  // refresh-token cookie successfully minted a new session. Route
  // handlers that get this back MUST call setAccountSessionCookies()
  // with it on their own outgoing response -- otherwise the request
  // itself succeeds but the browser is left holding cookies that no
  // longer verify, forcing a full re-login next time for no reason.
  refreshed?: AuthTokens;
}

// The real authorization boundary for every account GET/PATCH/DELETE and
// for app/api/account/trips + app/api/account/link-trip: verifies the
// access-token cookie against Supabase's own auth server
// (admin.auth.getUser(token), which works for any valid JWT regardless
// of which client issued it) -- not a bare cookie-parses-and-signs-OK
// check, but the provider itself confirming the token is live and
// unexpired. A request with no session, an expired one with no valid
// refresh token, or a forged/tampered cookie value all resolve to null.
export async function resolveAccountSession(request: Request): Promise<ResolvedAccountSession | null> {
  const admin = createAdminClient();
  const accessToken = readCookie(request, ACCESS_COOKIE_NAME);

  let authUserId: string | null = null;
  let refreshed: AuthTokens | undefined;

  if (accessToken) {
    const { data, error } = await admin.auth.getUser(accessToken);
    if (!error && data.user) authUserId = data.user.id;
  }

  if (!authUserId) {
    const refreshToken = readCookie(request, REFRESH_COOKIE_NAME);
    if (!refreshToken) return null;
    const { data, error } = await refreshWithToken(refreshToken);
    if (error || !data.session) return null;
    authUserId = data.session.user.id;
    refreshed = {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in ?? 3600,
    };
  }

  const { data: account, error: accountError } = await admin
    .from("creator_accounts")
    .select("id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (accountError || !account) return null;

  return { accountId: account.id, authUserId, refreshed };
}

// Verifies a device's own anonymous participant session (the bearer
// access token from supabase.auth.getSession(), sent as an
// Authorization header -- see src/lib/creatorAccount.ts's
// linkParticipantToAccount()) -- used only by
// app/api/account/link-participant, the one place a creator-account
// route needs to independently confirm "this specific browser really is
// the device that owns this participant row" before letting a
// service-role write touch it. Deliberately separate from
// resolveAccountSession above: this verifies the DEVICE's anonymous
// identity, not the creator account's.
export async function resolveBearerAuthUserId(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const admin = createAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}
