import { getDeviceId, ensureAuthSession } from "./device";
import { supabase } from "./supabase/client";
import type { EditorialBriefValidated } from "./editorialBrief";

export interface CreateTripInput {
  destination: string;
  startDate: string;
  durationDays: number;
  // R6 follow-up: the destination's own IANA timezone (app/page.tsx's
  // picker) -- never derived from this device's browser/Intl timezone.
  timezone: string;
  website: string;
  requestId: string;
  // The initial editorial brief (difficulty/theme distribution/style),
  // already validated client-side by validateEditorialBrief -- spread
  // straight into the request body; app/api/trips/create/route.ts
  // re-validates it server-side regardless, same as every other field.
  brief: EditorialBriefValidated;
}

export interface CreateTripResult {
  slug: string;
}

// R5: created_by_auth_user_id (app/api/trips/create/route.ts) is stamped
// from a bearer token verified against Supabase Auth, never from the
// deviceId string below -- ensureAuthSession() is the same "no form, no
// password" anonymous sign-in every participant already gets, just
// established here before the very first write instead of at
// onboarding. requestId is a real idempotency key: the caller
// (app/page.tsx) generates one per creation attempt and keeps it stable
// across a retry of that same attempt.
export async function createPublicTrip(input: CreateTripInput): Promise<CreateTripResult> {
  const authUserId = await ensureAuthSession();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token || !authUserId) {
    throw new Error("Nu am putut verifica sesiunea. Încearcă din nou.");
  }

  // Flattened: the route expects difficulty/style/theme* as top-level
  // request-body keys (matching EditorialBriefRawInput), not nested
  // under a "brief" object.
  const { brief, ...rest } = input;
  const response = await fetch("/api/trips/create", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...rest, ...brief, deviceId: getDeviceId() }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut crea călătoria. Încearcă din nou.");
  }
  return { slug: body.slug };
}
