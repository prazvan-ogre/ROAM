import { getDeviceId, ensureAuthSession } from "./device";
import { supabase } from "./supabase/client";
import type { Trip } from "./trip";

// Batch 2 (2026-09-05 review, R1 continued): the account-linking routes
// below (POST /api/account, POST /api/account/link-trip) now verify the
// calling device's own anonymous participant session before stamping
// participants.account_id -- this is what proves "this browser really is
// the device joining as a participant", instead of trusting a
// client-supplied accountId (src/lib/security/participantLink.ts). The
// device's own Supabase Auth access token (never the creator account's
// separate session -- see src/lib/security/session.ts) is what's sent.
async function deviceAuthHeader(): Promise<Record<string, string>> {
  await ensureAuthSession();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { authorization: `Bearer ${token}` } : {};
}

// R1: the actual authorization boundary for reading/updating this
// account, and for deciding which trips it can see, is now the httpOnly
// session cookie app/api/account/route.ts sets on login and verifies on
// every request (src/lib/security/session.ts) -- the browser sends it
// automatically, this module never reads or forwards it. What's left in
// localStorage is display-only: "does this device look logged in" for
// the UI to decide which screen to show, nothing a server route trusts
// for authorization anymore. In particular there is no client-side
// "is admin" flag at all now -- that's derived from creator_accounts on
// the server (app/api/account/trips/route.ts), never from something the
// client can set in devtools.
const STORAGE_KEY = "roam_creator_account_id";

export function getStoredAccountId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredAccountId(accountId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, accountId);
}

// Best-effort: also asks the server to revoke the Supabase Auth session
// and drop its cookies. A failed request still clears the local "looks
// logged in" flag -- worst case, the (still-valid) session quietly
// expires on its own after REFRESH_COOKIE_MAX_AGE_SECONDS
// (src/lib/security/session.ts).
export function clearStoredAccountId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  fetch("/api/account", { method: "DELETE" }).catch(() => undefined);
}

export interface AuthenticateInput {
  phoneNumber: string;
  pin: string;
  linkTripSlug?: string;
  // Only meaningful alongside linkTripSlug (app/trips/page.tsx "Ai deja
  // cont?" step, right after creating a trip): displayName is required
  // when creating a brand-new account there (so it can auto-join the
  // trip as its first adult participant); expectExisting=true turns a
  // not-found phone/PIN into a real login error instead of silently
  // creating a blank account, since that branch's UI has no name field.
  displayName?: string;
  expectExisting?: boolean;
}

export interface AuthenticateResult {
  accountId: string;
  isAdmin: boolean;
  displayName: string | null;
}

export async function authenticateCreatorAccount(input: AuthenticateInput): Promise<AuthenticateResult> {
  const response = await fetch("/api/account", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await deviceAuthHeader()) },
    body: JSON.stringify({ ...input, deviceId: getDeviceId() }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut verifica contul. Încearcă din nou.");
  }
  const accountId = body.accountId as string;
  // Display-only from here -- the server also just set the real,
  // httpOnly session cookie this account's identity now rests on
  // (Set-Cookie on the same response, handled by the browser directly).
  setStoredAccountId(accountId);
  return { accountId, isAdmin: Boolean(body.isAdmin), displayName: body.displayName ?? null };
}

export interface LinkTripResult {
  displayName: string | null;
}

// app/trips/page.tsx: an already logged-in device (session cookie
// already valid, no phone/PIN re-entry needed) landing on ?link=<slug>
// right after creating a second trip -- the same best-effort "link this
// device's trip to my account" write authenticateCreatorAccount's own
// POST does as a side effect of a *fresh* login, but reachable without
// asking an already-authenticated creator to log in again (hypothesis
// E, 2026-09-05 review).
export async function linkTripToCurrentAccount(tripSlug: string): Promise<LinkTripResult> {
  const response = await fetch("/api/account/link-trip", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await deviceAuthHeader()) },
    body: JSON.stringify({ tripSlug, deviceId: getDeviceId() }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut lega călătoria de cont.");
  }
  return { displayName: body?.displayName ?? null };
}

export interface AccountDetails {
  phoneNumber: string;
  displayName: string | null;
  isAdmin: boolean;
}

// Setări > Utilizatori (app/trip/[slug]/settings/page.tsx) reads this
// back to show the account's current phone number when editing the
// adult profile linked to it. No accountId argument any more -- the
// server derives the caller's own account from the session cookie
// (app/api/account/route.ts), so there's nothing left for the client to
// assert here. Never returns the PIN -- it's stored as a one-way hash
// (src/lib/security/pin.ts), so it can only ever be *set*, never
// displayed back.
export async function getAccountDetails(): Promise<AccountDetails> {
  const response = await fetch("/api/account");
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut încărca contul.");
  }
  return { phoneNumber: body.phoneNumber, displayName: body.displayName ?? null, isAdmin: Boolean(body.isAdmin) };
}

export interface UpdateAccountInput {
  phoneNumber?: string;
  pin?: string;
}

export async function updateAccountDetails(input: UpdateAccountInput): Promise<AccountDetails> {
  const response = await fetch("/api/account", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut salva modificările.");
  }
  return { phoneNumber: body.phoneNumber, displayName: body.displayName ?? null, isAdmin: Boolean(body.isAdmin) };
}

export interface AccountTrips {
  isAdmin: boolean;
  trips: Trip[];
}

// "Călătoriile mele" / Setări > Toate călătoriile (app/trips/page.tsx,
// app/trip/[slug]/settings/page.tsx) -- both which trips are "mine" and
// whether to show every trip on the platform are determined server-side
// from the session cookie (app/api/account/trips/route.ts), never from
// a client-supplied accountId or a client-set "is admin" flag.
export async function getTripsForCurrentAccount(): Promise<AccountTrips> {
  const response = await fetch("/api/account/trips");
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut încărca călătoriile.");
  }
  return { isAdmin: Boolean(body.isAdmin), trips: (body.trips ?? []) as Trip[] };
}
