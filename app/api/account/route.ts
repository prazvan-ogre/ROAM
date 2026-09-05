import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPin } from "@/lib/security/pin";
import {
  resolveAccountSession,
  resolveBearerAuthUserId,
  setAccountSessionCookies,
  clearAccountSessionCookies,
  signInWithPhonePassword,
  signOutTokens,
  readCookie,
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
} from "@/lib/security/session";
import { checkLoginLock, recordFailedLogin, resetLoginAttempts } from "@/lib/security/loginRateLimit";
import { checkAndRecordIpAttempt, getClientIp } from "@/lib/security/ipRateLimit";
import { linkCreatorParticipant } from "@/lib/security/participantLink";

export const runtime = "nodejs";

const PHONE_PATTERN = /^\+?[0-9 ()-]{7,20}$/;
const PIN_PATTERN = /^\d{4,6}$/;
// Batch 2 (2026-09-05 review, R1 continued): account_login_attempts only
// ever rate-limits *failed logins against an existing phone number* --
// creating a brand-new creator_accounts row (and, now, its backing
// Supabase Auth user) had no limit at all. IP-keyed, not device-keyed
// (src/lib/security/ipRateLimit.ts) -- same reasoning as
// app/api/trips/create/route.ts's own IP limit.
const MAX_NEW_ACCOUNTS_PER_IP_PER_HOUR = 5;
const IP_WINDOW_MS = 60 * 60 * 1000;

// Batch 2 (2026-09-05 review, R1 continued): "Călătoriile mele" no longer
// runs its own credential store at all. Login/signup verifies a real
// Supabase Auth user (phone + password, password = the same 4-6 digit
// PIN) via signInWithPassword/the admin API, and the resulting session
// (access + refresh token, both minted and signed by Supabase itself) is
// what every later GET/PATCH/DELETE verifies -- see
// src/lib/security/session.ts's header for the full design and why this
// coexists safely with a device's own separate anonymous participant
// session in the same browser.
//
// A pre-batch-2 account (pin_hash set, auth_user_id still null) is
// lazily migrated the moment its correct PIN is next presented here: that
// one check against the *old* scrypt hash is the last thing pin_hash is
// ever used for on that row -- once migrated, pin_hash is cleared and
// every future login goes through Supabase Auth exclusively. This is not
// a fallback that stays around: a row with auth_user_id set never
// consults pin_hash again, by construction (see handleAccount below).
//
// ROLLOUT REQUIREMENT (cannot be applied from this environment -- see PR
// description): the hosted Supabase project's Auth settings need the
// phone provider enabled and `minimum_password_length` lowered to 4 (to
// match the existing PIN policy) before this ships -- otherwise every
// signInWithPassword/createUser call below fails. Both are dashboard/
// Management API settings, not something a migration can apply.
function withRefreshedCookies(response: NextResponse, refreshed?: { access_token: string; refresh_token: string; expires_in: number }) {
  if (refreshed) setAccountSessionCookies(response, refreshed);
  return response;
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
// Setări > Utilizatori (app/trip/[slug]/settings/page.tsx). Never returns
// a PIN or password -- Supabase Auth owns that hash entirely now; this
// app never sees or stores it.
export async function GET(request: Request) {
  try {
    const session = await resolveAccountSession(request);
    if (!session) {
      return NextResponse.json({ error: "Sesiune expirată sau lipsă. Autentifică-te din nou." }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("creator_accounts")
      .select("phone_number, display_name, is_admin")
      .eq("id", session.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Contul nu a fost găsit." }, { status: 404 });

    return withRefreshedCookies(
      NextResponse.json({
        phoneNumber: data.phone_number,
        displayName: data.display_name,
        isAdmin: data.is_admin,
      }),
      session.refreshed,
    );
  } catch (err) {
    console.error("Account lookup failed", err);
    return NextResponse.json({ error: "Nu am putut încărca contul. Încearcă din nou." }, { status: 500 });
  }
}

// Updates phone number and/or PIN for the caller's own, session-verified
// account. Both now go through Supabase Auth's own admin API
// (updateUserById) -- it owns password verification/hashing and phone
// uniqueness, not this app.
export async function PATCH(request: Request) {
  try {
    return await handleUpdateAccount(request);
  } catch (err) {
    console.error("Account update failed", err);
    return NextResponse.json({ error: "Nu am putut salva modificările. Încearcă din nou." }, { status: 500 });
  }
}

// Logs out: best-effort revokes the Supabase Auth session server-side
// (so the refresh token can't be replayed), then always clears both
// cookies regardless of whether that revoke succeeded.
export async function DELETE(request: Request) {
  const accessToken = readCookie(request, ACCESS_COOKIE_NAME);
  const refreshToken = readCookie(request, REFRESH_COOKIE_NAME);
  if (accessToken && refreshToken) {
    try {
      await signOutTokens(accessToken, refreshToken);
    } catch (err) {
      console.error("Best-effort Supabase Auth sign-out failed", err);
    }
  }

  const response = NextResponse.json({ ok: true });
  clearAccountSessionCookies(response);
  return response;
}

async function handleUpdateAccount(request: Request): Promise<Response> {
  const session = await resolveAccountSession(request);
  if (!session) {
    return NextResponse.json({ error: "Sesiune expirată sau lipsă. Autentifică-te din nou." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  }

  const { phoneNumber, pin } = (body ?? {}) as Record<string, unknown>;

  let normalizedPhone: string | undefined;
  if (phoneNumber !== undefined) {
    if (typeof phoneNumber !== "string" || !PHONE_PATTERN.test(phoneNumber.trim())) {
      return NextResponse.json({ error: "Introdu un număr de telefon valid." }, { status: 400 });
    }
    normalizedPhone = phoneNumber.trim();
  }
  if (pin !== undefined && (typeof pin !== "string" || !PIN_PATTERN.test(pin))) {
    return NextResponse.json({ error: "PIN-ul trebuie să aibă 4-6 cifre." }, { status: 400 });
  }
  if (normalizedPhone === undefined && pin === undefined) {
    return NextResponse.json({ error: "Nimic de salvat." }, { status: 400 });
  }

  const admin = createAdminClient();

  const authUpdate: { phone?: string; phone_confirm?: boolean; password?: string } = {};
  if (normalizedPhone !== undefined) {
    authUpdate.phone = normalizedPhone;
    authUpdate.phone_confirm = true;
  }
  if (typeof pin === "string") authUpdate.password = pin;

  const { error: authError } = await admin.auth.admin.updateUserById(session.authUserId, authUpdate);
  if (authError) {
    // Supabase reports a duplicate phone as a 422/"already been registered"
    // style error -- there is no single stable error code across
    // versions, so match on the phone field actually being the one that
    // changed and treat any failure there as the conflict case (the
    // alternative, silently succeeding on the account row while auth
    // rejected the phone, would leave the two out of sync).
    if (normalizedPhone !== undefined) {
      return NextResponse.json({ error: "Acest număr de telefon este deja folosit de alt cont." }, { status: 409 });
    }
    throw authError;
  }

  const dbUpdate: { phone_number?: string; pin_hash: null } = { pin_hash: null };
  if (normalizedPhone !== undefined) dbUpdate.phone_number = normalizedPhone;

  const { data, error } = await admin
    .from("creator_accounts")
    .update(dbUpdate)
    .eq("id", session.accountId)
    .select("phone_number, display_name, is_admin")
    .maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Contul nu a fost găsit." }, { status: 404 });

  return withRefreshedCookies(
    NextResponse.json({
      phoneNumber: data.phone_number,
      displayName: data.display_name,
      isAdmin: data.is_admin,
    }),
    session.refreshed,
  );
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
    .select("id, pin_hash, auth_user_id, is_admin, display_name")
    .eq("phone_number", normalizedPhone)
    .maybeSingle();
  if (lookupError) throw lookupError;

  let accountId: string;
  let isAdmin: boolean;
  let resultDisplayName: string | null;

  if (existing?.auth_user_id) {
    // Already on real Supabase Auth: nothing left to insert/migrate.
    accountId = existing.id;
    isAdmin = existing.is_admin;
    resultDisplayName = existing.display_name;
  } else if (existing) {
    // Legacy account (pre-batch-2): one last check against the old
    // scrypt hash, then lazily provision its real Supabase Auth identity
    // -- never backfilled in bulk, only on a session that just proved it
    // holds the correct PIN.
    if (!existing.pin_hash || !verifyPin(pin, existing.pin_hash)) {
      await recordFailedLogin(admin, normalizedPhone);
      return NextResponse.json({ error: "Număr de telefon sau PIN incorect." }, { status: 401 });
    }
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      phone: normalizedPhone,
      password: pin,
      phone_confirm: true,
    });
    if (createError || !created.user) throw createError ?? new Error("Lazy account migration returned no user.");

    const { error: migrateError } = await admin
      .from("creator_accounts")
      .update({ auth_user_id: created.user.id, pin_hash: null })
      .eq("id", existing.id);
    if (migrateError) throw migrateError;

    accountId = existing.id;
    isAdmin = existing.is_admin;
    resultDisplayName = existing.display_name;
  } else {
    // Brand new phone number -- this is the identity-creation path the IP
    // limit above guards; an existing account logging in (even one just
    // lazily migrated) never hits it.
    const clientIp = getClientIp(request);
    if (clientIp) {
      const ipStatus = await checkAndRecordIpAttempt(admin, clientIp, "account_create", {
        maxAttempts: MAX_NEW_ACCOUNTS_PER_IP_PER_HOUR,
        windowMs: IP_WINDOW_MS,
      });
      if (!ipStatus.allowed) {
        return NextResponse.json(
          { error: "Prea multe conturi noi create recent. Încearcă din nou peste câteva minute." },
          { status: 429, headers: { "Retry-After": String(ipStatus.retryAfterSeconds ?? 3600) } },
        );
      }
    }
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

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      phone: normalizedPhone,
      password: pin,
      phone_confirm: true,
    });
    if (createError || !created.user) {
      if (createError?.message?.toLowerCase().includes("phone")) {
        return NextResponse.json({ error: "Acest număr de telefon este deja folosit de alt cont." }, { status: 409 });
      }
      throw createError ?? new Error("Account creation returned no user.");
    }

    const { data: insertedAccount, error: insertError } = await admin
      .from("creator_accounts")
      .insert({
        phone_number: normalizedPhone,
        auth_user_id: created.user.id,
        display_name: normalizedName || null,
      })
      .select("id, is_admin, display_name")
      .single();
    if (insertError) throw insertError;

    accountId = insertedAccount.id;
    isAdmin = insertedAccount.is_admin;
    resultDisplayName = insertedAccount.display_name;
  }

  // The one and only password check for this request -- every branch
  // above either already verified the PIN itself (legacy bridge) or has
  // no need to (brand new account, just created with this exact PIN as
  // its password). This is also what mints the real session tokens the
  // response's cookies carry.
  const { error: signInError, data: signInData } = await signInWithPhonePassword(normalizedPhone, pin);
  if (existing?.auth_user_id && signInError) {
    await recordFailedLogin(admin, normalizedPhone);
    return NextResponse.json({ error: "Număr de telefon sau PIN incorect." }, { status: 401 });
  }
  if (signInError || !signInData.session) throw signInError ?? new Error("Login returned no session.");

  await resetLoginAttempts(admin, normalizedPhone);

  // Linking is best-effort: only if this exact device created that exact
  // trip, and it isn't already tied to some other account. A failed or
  // skipped link never fails the whole login -- the account still works,
  // this trip just doesn't show up in its history.
  if (isLinkingNewTrip) {
    const tripSlug = (linkTripSlug as string).trim();
    const trimmedDeviceId = (deviceId as string).trim();

    const { data: tripRow } = await admin
      .from("trips")
      .select("id, created_by_account_id, created_by_device_id")
      .eq("slug", tripSlug)
      .maybeSingle();

    if (tripRow && !tripRow.created_by_account_id && tripRow.created_by_device_id === trimmedDeviceId) {
      await admin.from("trips").update({ created_by_account_id: accountId }).eq("id", tripRow.id);
    }

    // Auto-join the account holder as this trip's first adult participant
    // and stamp participants.account_id -- both now done server-side,
    // with the device's own anonymous identity verified via its bearer
    // token (never a client-supplied auth_user_id/accountId). Attempted
    // regardless of whether the trip-ownership link above changed
    // anything just now (e.g. a return login from a second device, or a
    // trip this account already linked on an earlier login) -- same as
    // the original client-side flow this replaces, which only ever
    // required a display name, not a fresh link.
    const joinDisplayName = resultDisplayName || normalizedName;
    const deviceAuthUserId = await resolveBearerAuthUserId(request);
    if (tripRow && joinDisplayName && deviceAuthUserId) {
      try {
        await linkCreatorParticipant(admin, {
          tripId: tripRow.id,
          deviceId: trimmedDeviceId,
          authUserId: deviceAuthUserId,
          accountId,
          displayName: joinDisplayName,
        });
      } catch (joinErr) {
        console.error("Auto-join after account login failed", joinErr);
      }
    }
  }

  return withRefreshedCookies(
    setAccountSessionCookiesOnJson({ accountId, isAdmin, displayName: resultDisplayName }, signInData.session),
    undefined,
  );
}

function setAccountSessionCookiesOnJson(
  body: Record<string, unknown>,
  session: { access_token: string; refresh_token: string; expires_in: number },
): NextResponse {
  const response = NextResponse.json(body);
  setAccountSessionCookies(response, session);
  return response;
}
