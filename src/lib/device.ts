import { supabase } from "./supabase/client";

const STORAGE_KEY = "roam_device_id";

// Still used to group "every profile on this device" (participants.
// device_id) and for display -- but no longer a credential RLS trusts by
// itself (see ensureAuthSession below): a client can set this to
// anything, so it was never fit to be one.
export function getDeviceId(): string {
  if (typeof window === "undefined") {
    throw new Error("getDeviceId() must be called client-side.");
  }

  const existing = window.localStorage.getItem(STORAGE_KEY);
  if (existing) return existing;

  const id = crypto.randomUUID();
  window.localStorage.setItem(STORAGE_KEY, id);
  return id;
}

// R1: every device also gets a real Supabase Auth session -- anonymous
// sign-in, so still no form, no email, no password, exactly what keeps
// child participation registration-free -- giving Postgres a genuine
// auth.uid() that participants/responses/battle_scores RLS can check
// (20260906090000_auth_ownership.sql), instead of trusting the plain
// device_id string above. A child's profile is created under this same
// call as the managing adult's: one sign-in per device, never one per
// profile. supabase-js persists the resulting session in localStorage
// itself and reuses/refreshes it automatically, so this only ever
// signs in once per device, not once per call.
let signInPromise: Promise<string> | null = null;

export async function ensureAuthSession(): Promise<string> {
  if (typeof window === "undefined") {
    throw new Error("ensureAuthSession() must be called client-side.");
  }

  const { data: existing } = await supabase.auth.getSession();
  if (existing.session?.user.id) return existing.session.user.id;

  if (!signInPromise) {
    signInPromise = supabase.auth.signInAnonymously().then(({ data, error }) => {
      if (error || !data.session) {
        signInPromise = null;
        throw error ?? new Error("Anonymous sign-in returned no session.");
      }
      return data.session.user.id;
    });
  }
  return signInPromise;
}
