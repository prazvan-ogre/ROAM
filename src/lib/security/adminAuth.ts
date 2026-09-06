import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAccountSession, type ResolvedAccountSession } from "./session";

export type AdminAuthResult =
  | { ok: true; session: ResolvedAccountSession }
  | { ok: false; status: 401 | 403; error: string };

// R7: the one place "is this caller actually an admin" is decided for
// the content-publishing endpoints (app/api/admin/trips/[slug]/validate,
// .../publish) -- the same verified-session + creator_accounts.is_admin
// lookup app/api/account/trips/route.ts already uses for "Toate
// călătoriile", reused rather than re-implemented. Never trusts a
// client-supplied isAdmin flag, accountId, or deviceId:
// resolveAccountSession (src/lib/security/session.ts) verifies the
// httpOnly session cookie against Supabase Auth itself, and is_admin is
// looked up server-side from that verified account id, via the
// service-role client (RLS on creator_accounts blocks anon/authenticated
// from reading it directly -- see docs/DATABASE.md).
export async function requireAdminSession(request: Request): Promise<AdminAuthResult> {
  const session = await resolveAccountSession(request);
  if (!session) {
    return { ok: false, status: 401, error: "Sesiune expirată sau lipsă. Autentifică-te din nou." };
  }

  const admin = createAdminClient();
  const { data: account, error } = await admin
    .from("creator_accounts")
    .select("is_admin")
    .eq("id", session.accountId)
    .maybeSingle();
  if (error) throw error;

  if (!account?.is_admin) {
    return { ok: false, status: 403, error: "Nu ai drepturi de administrator pentru această acțiune." };
  }

  return { ok: true, session };
}
