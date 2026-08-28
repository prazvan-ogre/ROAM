import { getDeviceId } from "./device";

export interface CreateTripInput {
  destination: string;
  startDate: string;
  durationDays: number;
  website: string;
}

export interface CreateTripResult {
  slug: string;
  // Set when the trip row was created but content generation itself
  // failed (app/api/trips/create/route.ts) -- the trip exists and can be
  // opened, it just has no Discover/Battle content yet.
  contentFailed?: boolean;
  warning?: string;
}

export async function createPublicTrip(input: CreateTripInput): Promise<CreateTripResult> {
  const response = await fetch("/api/trips/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, deviceId: getDeviceId() }),
  });

  const body = await response.json().catch(() => null);

  if (response.status === 502 && body?.slug) {
    return { slug: body.slug, contentFailed: true, warning: body.error };
  }
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut crea călătoria. Încearcă din nou.");
  }
  return { slug: body.slug };
}
