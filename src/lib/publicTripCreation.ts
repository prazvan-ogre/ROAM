import { getDeviceId } from "./device";

export interface CreateTripInput {
  destination: string;
  startDate: string;
  durationDays: number;
  website: string;
}

export interface CreateTripResult {
  slug: string;
}

export async function createPublicTrip(input: CreateTripInput): Promise<CreateTripResult> {
  const response = await fetch("/api/trips/create", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, deviceId: getDeviceId() }),
  });

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error ?? "Nu am putut crea călătoria. Încearcă din nou.");
  }
  return { slug: body.slug };
}
