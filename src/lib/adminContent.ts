import type { Database } from "./supabase/types";

// R7: thin client wrappers around app/api/admin/trips/[slug]/{validate,
// publish} -- authorization is entirely server-side (the httpOnly
// account session cookie + creator_accounts.is_admin, see
// src/lib/security/adminAuth.ts); this module sends no accountId,
// deviceId, or isAdmin flag of its own, same pattern as
// src/lib/creatorAccount.ts's own account/trip calls.
export type ContentValidationIssue = Database["public"]["Functions"]["validate_trip_content"]["Returns"][number];

export interface ValidateTripContentResult {
  contentStatus: string;
  issues: ContentValidationIssue[];
}

export async function validateTripContent(slug: string): Promise<ValidateTripContentResult> {
  const response = await fetch(`/api/admin/trips/${encodeURIComponent(slug)}/validate`);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut valida conținutul. Încearcă din nou.");
  }
  return { contentStatus: body.contentStatus, issues: (body.issues ?? []) as ContentValidationIssue[] };
}

export type PublishTripStatus = "published" | "already_published" | "rejected";

export interface PublishTripResult {
  status: PublishTripStatus;
  errorCount: number;
  warningCount: number;
  issues: ContentValidationIssue[];
}

export async function publishTrip(slug: string): Promise<PublishTripResult> {
  const response = await fetch(`/api/admin/trips/${encodeURIComponent(slug)}/publish`, { method: "POST" });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut publica. Încearcă din nou.");
  }
  return {
    status: body.status,
    errorCount: body.errorCount ?? 0,
    warningCount: body.warningCount ?? 0,
    issues: (body.issues ?? []) as ContentValidationIssue[],
  };
}
