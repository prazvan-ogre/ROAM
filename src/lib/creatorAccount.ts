import { getDeviceId } from "./device";

const STORAGE_KEY = "roam_creator_account_id";

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
}

export interface AuthenticateInput {
  phoneNumber: string;
  pin: string;
  linkTripSlug?: string;
}

export async function authenticateCreatorAccount(input: AuthenticateInput): Promise<string> {
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
  return accountId;
}
