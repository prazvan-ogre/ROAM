import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashPin, verifyPin } from "@/lib/security/pin";
import {
  createSessionToken,
  verifySessionToken,
  readSessionCookie,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/security/session";
import { checkLoginLock, recordFailedLogin, resetLoginAttempts } from "@/lib/security/loginRateLimit";

export const runtime = "nodejs";

const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;
const PIN_PATTERN = /^\d{4,6}$/;

function withSessionCookie(response: NextResponse, accountId: string): NextResponse {
  response.cookies.set(SESSION_COOKIE_NAME, createSessionToken(accountId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

// R1: accountId is no longer trusted from client input on GET/PATCH/
// DELETE -- it's derived from this httpOnly, HMAC-signed cookie, set
// only by a successful POST (phone+PIN) below. A request with no
// session, an expired one, or a forged cookie value all fail this the
// same way (null), which is exactly the point: there is no client-
// suppliable identifier that can stand in for it anymore.
function requireSessionAccountId(request: Request): string | null {
  return verifySessionToken(readSessionCookie(request))?.accountId ?? null;
}

export async function POST(request: Request) {
  try {
    return await handleAccount(request);
  } catch (err) {
    console.error("Account authentication failed", err);
    return NextResponse.json({ error: "Nu am putut verifica contul. Încearcă din nou." }, { status: 500 });
  }
}

// Reads back the *caller's own, session-verified* account for display in
// Setări > Utilizatori (app/trip/[slug]/settings/page.tsx) -- no more
// accountId query param, no PIN re-entry: the httpOnly session cookie
// set on login (POST below) is what's checked. Never returns pin_hash --
// it's a one-way scrypt hash (src/lib/security/pin.ts) that can't be
// turned back into the original PIN to show it, which is why editing a
// PIN below is "set a new one", never "reveal the current one".
export async function GET(request: Request) {
  try {
    const accountId = requireSessionAccountId(request);
    if (!accountId) {
      return NextResponse.json({ error: "Sesiune expirată sau lipsă. Autentifică-te din nou." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("creator_accounts")
      .select("phone_number, display_name, is_admin")
      .eq("id", accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Contul nu a fost găsit." }, { status: 404 });

    return NextResponse.json({
      phoneNumber: data.phone_number,
      displayName: data.display_name,
      isAdmin: data.is_admin,
    });
  } catch (err) {
    console.error("Account lookup failed", err);
    return NextResponse.json({ error: "Nu am putut încărca contul. Încearcă din nou." }, { status: 500 });
  }
}

// Updates phone number and/or PIN for the caller's own, session-verified
// account -- no current-PIN confirmation required (consistent with the
// rest of this app's accepted-risk posture, not a place to introduce a
// stricter one-off rule). Either field is optional so the caller can
// send just one.
export async function PATCH(request: Request) {
  try {
    return await handleUpdateAccount(request);
  } catch (err) {
    console.error("Account update failed", err);
    return NextResponse.json({ error: "Nu am putut salva modificările. Încearcă din nou." }, { status: 500 });
  }
}

// Logs out: clears the session cookie. There is nothing server-side to
// invalidate (the token verifies itself, stateless) -- this only removes
// the client's copy, same as any other cookie-based logout.
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}

async function handleUpdateAccount(request: Request): Promise<Response> {
  const accountId = requireSessionAccountId(request);
  if (!accountId) {
    return NextResponse.json({ error: "Sesiune expirată sau lipsă. Autentifică-te din nou." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  }

  const { phoneNumber, pin } = (body ?? {}) as Record<string, unknown>;

  const update: { phone_number?: string; pin_hash?: string } = {};

  if (phoneNumber !== undefined) {
    if (typeof phoneNumber !== "string" || !PHONE_PATTERN.test(phoneNumber.trim())) {
      return NextResponse.json({ error: "Introdu un număr de telefon valid." }, { status: 400 });
    }
    update.phone_number = phoneNumber.trim();
  }
  if (pin !== undefined) {
    if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
      return NextResponse.json({ error: "PIN-ul trebuie să aibă 4-6 cifre." }, { status: 400 });
    }
    update.pin_hash = hashPin(pin);
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Nimic de salvat." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("creator_accounts")
    .update(update)
    .eq("id", accountId)
    .select("phone_number, display_name, is_admin")
    .maybeSingle();

  if (error) {
    // Unique violation on phone_number.
    if (error.code === "23505") {
      return NextResponse.json({ error: "Acest număr de telefon este deja folosit de alt cont." }, { status: 409 });
    }
    throw error;
  }
  if (!data) return NextResponse.json({ error: "Contul nu a fost găsit." }, { status: 404 });

  return NextResponse.json({
    phoneNumber: data.phone_number,
    displayName: data.display_name,
    isAdmin: data.is_admin,
  });
}

async function handleAccount(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  }

  const { phoneNumber, pin, deviceId, linkTripSlug, displayName, expectExisting } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof phoneNumber !== "string" || !PHONE_PATTERN.test(phoneNumber.trim())) {
    return NextResponse.json({ error: "Introdu un număr de telefon valid." }, { status: 400 });
  }
  if (typeof pin !== "string" || !PIN_PATTERN.test(pin)) {
    return NextResponse.json({ error: "PIN-ul trebuie să aibă 4-6 cifre." }, { status: 400 });
  }

  const admin = createAdminClient();
  const normalizedPhone = phoneNumber.trim();
  const normalizedName = typeof displayName === "string" ? displayName.trim() : "";
  const isLinkingNewTrip =
    typeof linkTripSlug === "string" && linkTripSlug.trim() && typeof deviceId === "string" && deviceId.trim();

  const lockStatus = await checkLoginLock(admin, normalizedPhone);
  if (lockStatus.locked) {
    return NextResponse.json(
      { error: "Prea multe încercări greșite. Încearcă din nou peste câteva minute." },
      { status: 429, headers: { "Retry-After": String(lockStatus.retryAfterSeconds ?? 900) } },
    );
  }

  const { data: existing, error: lookupError } = await admin
    .from("creator_accounts")
    .select("id, pin_hash, is_admin, display_name")
    .eq("phone_number", normalizedPhone)
    .maybeSingle();
  if (lookupError) throw lookupError;

  let accountId: string;
  let isAdmin: boolean;
  let resultDisplayName: string | null;
  if (existing) {
    if (!verifyPin(pin, existing.pin_hash)) {
      await recordFailedLogin(admin, normalizedPhone);
      return NextResponse.json({ error: "Număr de telefon sau PIN incorect." }, { status: 401 });
    }
    accountId = existing.id;
    isAdmin = existing.is_admin;
    resultDisplayName = existing.display_name;
  } else {
    // Right after creating a trip (app/trips/page.tsx asks "Ai deja
    // cont?" first): claiming to already have one but no matching row
    // exists is a wrong phone/PIN, not a signal to silently create a
    // blank account -- the UI shown for that branch has no name field to
    // fall back on. The plain /trips login (no linkTripSlug) keeps its
    // original behavior: an unrecognized phone/PIN just creates a new,
    // nameless account.
    if (isLinkingNewTrip && expectExisting === true) {
      await recordFailedLogin(admin, normalizedPhone);
      return NextResponse.json(
        { error: "Nu am găsit un cont cu acest număr. Alege \"Nu am cont\" ca să creezi unul." },
        { status: 401 },
      );
    }
    if (isLinkingNewTrip && !normalizedName) {
      return NextResponse.json({ error: "Introdu un nume." }, { status: 400 });
    }

    const { data: created, error: insertError } = await admin
      .from("creator_accounts")
      .insert({
        phone_number: normalizedPhone,
        pin_hash: hashPin(pin),
        display_name: normalizedName || null,
      })
      .select("id, is_admin, display_name")
      .single();
    if (insertError) throw insertError;
    accountId = created.id;
    isAdmin = created.is_admin;
    resultDisplayName = created.display_name;
  }

  await resetLoginAttempts(admin, normalizedPhone);

  // Linking is best-effort: only if this exact device created that exact
  // trip, and it isn't already tied to some other account. A failed or
  // skipped link never fails the whole login -- the account still works,
  // this trip just doesn't show up in its history.
  if (isLinkingNewTrip) {
    await admin
      .from("trips")
      .update({ created_by_account_id: accountId })
      .eq("slug", (linkTripSlug as string).trim())
      .eq("created_by_device_id", (deviceId as string).trim())
      .is("created_by_account_id", null);
  }

  return withSessionCookie(
    NextResponse.json({ accountId, isAdmin, displayName: resultDisplayName }),
    accountId,
  );
}
