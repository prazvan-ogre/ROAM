import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPin, verifyPin } from "@/lib/security/pin";

export const runtime = "nodejs";

const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;
const PIN_PATTERN = /^\d{4,6}$/;

export async function POST(request: Request) {
  try {
    return await handleAccount(request);
  } catch (err) {
    console.error("Account authentication failed", err);
    return NextResponse.json({ error: "Nu am putut verifica contul. Încearcă din nou." }, { status: 500 });
  }
}

async function handleAccount(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  }

  const { phoneNumber, pin, deviceId, linkTripSlug } = (body ?? {}) as Record<string, unknown>;

  if (typeof phoneNumber !== "string" || !PHONE_PATTERN.test(phoneNumber.trim())) {
    return NextResponse.json({ error: "Introdu un număr de telefon valid." }, { status: 400 });
  }
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return NextResponse.json({ error: "PIN-ul trebuie să aibă 4-6 cifre." }, { status: 400 });
  }

  const admin = createAdminClient();
  const normalizedPhone = phoneNumber.trim();

  const { data: existing, error: lookupError } = await admin
    .from("creator_accounts")
    .select("id, pin_hash")
    .eq("phone_number", normalizedPhone)
    .maybeSingle();
  if (lookupError) throw lookupError;

  let accountId: string;
  if (existing) {
    if (!verifyPin(pin, existing.pin_hash)) {
      return NextResponse.json({ error: "Număr de telefon sau PIN incorect." }, { status: 401 });
    }
    accountId = existing.id;
  } else {
    const { data: created, error: insertError } = await admin
      .from("creator_accounts")
      .insert({ phone_number: normalizedPhone, pin_hash: hashPin(pin) })
      .select("id")
      .single();
    if (insertError) throw insertError;
    accountId = created.id;
  }

  // Linking is best-effort: only if this exact device created that exact
  // trip, and it isn't already tied to some other account. A failed or
  // skipped link never fails the whole login -- the account still works,
  // this trip just doesn't show up in its history.
  if (typeof linkTripSlug === "string" && linkTripSlug.trim() && typeof deviceId === "string" && deviceId.trim()) {
    await admin
      .from("trips")
      .update({ created_by_account_id: accountId })
      .eq("slug", linkTripSlug.trim())
      .eq("created_by_device_id", deviceId.trim())
      .is("created_by_account_id", null);
  }

  return NextResponse.json({ accountId });
}
