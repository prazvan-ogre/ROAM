import { createHmac, timingSafeEqual } from "node:crypto";

// R1: creator accounts (app/api/account/route.ts) need a real,
// server-verifiable session -- not the bare client-supplied accountId
// trusted today (docs/DATABASE.md "Security model"). This isn't Supabase
// Auth: unlike device participants (src/lib/device.ts's anonymous
// sign-in), a creator account has to support logging back in on a new
// phone via phone+PIN, which is a password-recovery shape anonymous auth
// doesn't fit. So instead: on successful PIN verification, the server
// issues a small HMAC-signed, httpOnly cookie naming the account id and
// an issue time; every later account read/write must present and verify
// it, server-side, instead of trusting whatever accountId the client
// sends. Server-only (node:crypto) -- never import from a "use client"
// component.

export const SESSION_COOKIE_NAME = "roam_account_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Reads the cookie straight off the request's own Cookie header instead
// of next/headers's cookies() -- that helper only works inside Next's
// own request-scoped AsyncLocalStorage, which route handler unit tests
// (tests/unit/api-account-ownership.test.ts) that call GET/PATCH/DELETE
// directly, with no real Next server behind them, don't have. Reading
// off the Request object itself needs nothing but the object already in
// hand, in a route handler or a test alike.
export function readSessionCookie(request: Request): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (name === SESSION_COOKIE_NAME) {
      return decodeURIComponent(part.slice(separatorIndex + 1).trim());
    }
  }
  return undefined;
}

export interface SessionPayload {
  accountId: string;
  issuedAt: number;
}

function getSecret(): string {
  const secret = process.env.ACCOUNT_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "Missing ACCOUNT_SESSION_SECRET -- required to sign/verify creator account sessions (app/api/account).",
    );
  }
  return secret;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", getSecret()).update(encodedPayload).digest("base64url");
}

export function createSessionToken(accountId: string): string {
  const payload: SessionPayload = { accountId, issuedAt: Date.now() };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

// Verifies the HMAC and expiry. Never trusts the payload before checking
// the signature -- a forged accountId/issuedAt pair fails the
// timing-safe comparison below regardless of what it claims.
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const separatorIndex = token.lastIndexOf(".");
  if (separatorIndex <= 0) return null;

  const encoded = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = sign(encoded);

  const provided = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).accountId !== "string" ||
    typeof (payload as Record<string, unknown>).issuedAt !== "number"
  ) {
    return null;
  }

  const { accountId, issuedAt } = payload as SessionPayload;
  if (Date.now() - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return null;

  return { accountId, issuedAt };
}
