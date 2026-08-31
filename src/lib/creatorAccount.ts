import { getDeviceId } from "./device";

const STORAGE_KEY = "roam_creator_account_id";
const ADMIN_STORAGE_KEY = "roam_creator_account_is_admin";

// Deliberately the same trust model as device_id (docs/DATABASE.md
// "Security model"): the server verifies the phone+PIN once
// (app/api/account/route.ts), then this id is trusted client-side for
// every later "which trips are mine" read -- no session token, no
// cookie. Good enough for a low-stakes creator history, not a place to
// put anything sensitive.
export function getStoredAccountId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setStoredAccountId(accountId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, accountId);
}

export function clearStoredAccountId(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(ADMIN_STORAGE_KEY);
}

export function getStoredIsAdmin(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ADMIN_STORAGE_KEY) === "1";
}

function setStoredIsAdmin(isAdmin: boolean): void {
  if (typeof window === "undefined") return;
  if (isAdmin) {
    window.localStorage.setItem(ADMIN_STORAGE_KEY, "1");
  } else {
    window.localStorage.removeItem(ADMIN_STORAGE_KEY);
  }
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, deviceId: getDeviceId() }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut verifica contul. Încearcă din nou.");
  }
  const accountId = body.accountId as string;
  setStoredAccountId(accountId);
  setStoredIsAdmin(Boolean(body.isAdmin));
  return { accountId, isAdmin: Boolean(body.isAdmin), displayName: body.displayName ?? null };
}

export interface AccountDetails {
  phoneNumber: string;
  displayName: string | null;
  isAdmin: boolean;
}

// Setări > Utilizatori (app/trip/[slug]/settings/page.tsx) reads this
// back to show the account's current phone number when editing the
// adult profile linked to it. Never returns the PIN -- it's stored as a
// one-way hash (src/lib/security/pin.ts), so it can only ever be *set*,
// never displayed back.
export async function getAccountDetails(accountId: string): Promise<AccountDetails> {
  const response = await fetch(`/api/account?accountId=${encodeURIComponent(accountId)}`);
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

export async function updateAccountDetails(accountId: string, input: UpdateAccountInput): Promise<AccountDetails> {
  const response = await fetch("/api/account", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId, ...input }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut salva modificările.");
  }
  return { phoneNumber: body.phoneNumber, displayName: body.displayName ?? null, isAdmin: Boolean(body.isAdmin) };
}
