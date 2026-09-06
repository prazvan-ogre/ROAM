"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, LogOut } from "lucide-react";
import {
  authenticateCreatorAccount,
  clearStoredAccountId,
  getStoredAccountId,
  getTripsForCurrentAccount,
  linkTripToCurrentAccount,
} from "@/lib/creatorAccount";
import { TripsList } from "@/components/TripsList";
import type { Trip } from "@/lib/trip";

// This page has no dynamic route segment, so Next would otherwise try to
// statically prerender it at build time -- which eagerly loads the
// Supabase client (a top-level createClient() call in
// src/lib/supabase/client.ts) with no env vars available in that
// context, failing the build. Every other page reading trip data either
// has a [slug] segment (never prerendered without generateStaticParams)
// or, like "/", never imports the Supabase client at module scope.
export const dynamic = "force-dynamic";

type Step = "loading" | "auth" | "list";
type AccountChoice = "unknown" | "existing" | "new";

// useSearchParams() requires a Suspense boundary in the app router --
// without it, this page can't be prerendered even with force-dynamic.
export default function TripsPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </main>
      }
    >
      <TripsPageInner />
    </Suspense>
  );
}

function TripsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkSlug = searchParams.get("link");
  // Set by ProfileMenu's "Creează cont" (src/components/ProfileMenu.tsx)
  // -- we already know who's asking, so skip the "Ai deja cont?" chooser
  // straight to the name+phone+PIN form, name pre-filled (still
  // editable) instead of asked twice.
  const prefilledName = searchParams.get("name");

  const [step, setStep] = useState<Step>("loading");
  const [isAdmin, setIsAdmin] = useState(false);
  // R5: null = loading, "error" = failed to load, an array (possibly
  // empty) = loaded. This page used to redirect straight into a trip's
  // own Setări whenever the account had at least one, so it never
  // actually rendered a populated list -- it now shows the real list,
  // reusing the same cards/statuses as Setări > Toate călătoriile
  // (src/components/TripsList.tsx). A load failure is no longer
  // indistinguishable from "not logged in" either (see the mount effect
  // below, which used to send any getTripsForCurrentAccount() error
  // straight back to the auth screen).
  const [trips, setTrips] = useState<Trip[] | "error" | null>(null);
  const [accountChoice, setAccountChoice] = useState<AccountChoice>(prefilledName ? "new" : "unknown");
  const [displayName, setDisplayName] = useState(prefilledName ?? "");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);

  const loadTrips = useCallback(() => {
    setTrips(null);
    getTripsForCurrentAccount()
      .then(({ isAdmin: admin, trips: list }) => {
        setIsAdmin(admin);
        setTrips(list);
      })
      .catch((err) => {
        console.error("getTripsForCurrentAccount failed", err);
        setTrips("error");
      });
  }, []);

  // The already-logged-in counterpart to handleAuthSubmit's own linking
  // below (hypothesis E, 2026-09-05 review): a device that already has a
  // valid session (no phone/PIN re-entry needed) landing here via
  // ?link=<slug> right after creating a second trip used to skip
  // straight to loadTrips(), never looking at linkSlug at all -- only a
  // *fresh* login's handleAuthSubmit ever ran the "link this trip to my
  // account" + auto-join steps. Best-effort, same as handleAuthSubmit's:
  // a failed link or join here still lands the user in the trip's
  // Setări, matching "right after creating a trip, land inside it"
  // either way. The join itself now happens entirely server-side
  // (POST /api/account/link-trip, batch 2) -- this client no longer
  // creates the participant row or passes an accountId to it at all (see
  // src/lib/security/participantLink.ts for why).
  const linkNewTripThenRedirect = useCallback(
    async (slug: string) => {
      try {
        const { tripLink } = await linkTripToCurrentAccount(slug);
        // R5 round 2: "linked" and "already_linked" are the expected
        // outcomes here; anything else is worth a log line even though the
        // redirect below still happens either way (this device's own
        // participant session still has access to the trip regardless of
        // whether it shows up under this account) -- not a UI change, just
        // enough to diagnose a real "another account already owns this"
        // report without guessing.
        if (tripLink !== "linked" && tripLink !== "already_linked") {
          console.warn(`Trip linking for ${slug} resolved as "${tripLink}", not a successful claim`);
        }
      } catch (err) {
        console.error("Linking a new trip to an already logged-in account failed", err);
      }
      router.push(`/trip/${slug}/settings`);
    },
    [router],
  );

  useEffect(() => {
    const accountId = getStoredAccountId();
    if (!accountId) {
      setStep("auth");
      return;
    }
    if (linkSlug) {
      linkNewTripThenRedirect(linkSlug);
    } else {
      // R5: loadTrips() handles its own failure (sets trips to "error"),
      // never throws -- a transient load failure must not be
      // indistinguishable from "not logged in" by falling back to the
      // auth screen, as this used to.
      setStep("list");
      loadTrips();
    }
  }, [linkSlug, loadTrips, linkNewTripThenRedirect]);

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    if (authenticating) return;
    setAuthError(null);
    setAuthenticating(true);
    try {
      await authenticateCreatorAccount({
        phoneNumber,
        pin,
        linkTripSlug: linkSlug ?? undefined,
        displayName: accountChoice === "new" ? displayName : undefined,
        // R5-fix4: no longer gated on linkSlug -- the chooser above now
        // always runs first, so accountChoice is always "existing" or
        // "new" by the time this form can submit.
        expectExisting: accountChoice === "existing",
      });

      // Product owner request: whoever creates a trip should become its
      // first participant automatically instead of separately joining
      // later through the onboarding wizard with the same name. Handled
      // entirely server-side now, inside POST /api/account itself
      // (app/api/account/route.ts, batch 2) -- requires a name (either
      // just given, or already on file for a returning account) and the
      // calling device's own verified anonymous session, so this is a
      // no-op for an older account that never set one. Best-effort there
      // too: a failure shouldn't block getting into "Călătoriile mele".

      // Right after creating a trip, land inside it -- a clear
      // destination for the trip just made/linked. The plain
      // "Călătoriile mele" login (no linkSlug) shows the list on this
      // page instead (below), never a redirect.
      if (linkSlug) {
        router.push(`/trip/${linkSlug}/settings`);
        return;
      }

      setStep("list");
      loadTrips();
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Nu am putut verifica contul. Încearcă din nou.");
    } finally {
      setAuthenticating(false);
    }
  }

  function handleLogOut() {
    clearStoredAccountId();
    setIsAdmin(false);
    // R5: without this, a next login (same account or a different one)
    // could briefly render the PREVIOUS account's already-fetched list
    // before loadTrips() resolves again.
    setTrips(null);
    setAccountChoice("unknown");
    setDisplayName("");
    setPhoneNumber("");
    setPin("");
    setStep("auth");
  }

  if (step === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (step === "auth") {
    // R5-fix4: used to only show this chooser when linking a just-created
    // trip (Boolean(linkSlug) &&...) -- the plain "Călătoriile mele" login
    // (reached from Home, no ?link=) skipped straight to the phone/PIN
    // form with no "Ai deja cont?" step, so an unrecognized number typed
    // there silently created a brand-new account (see app/api/account/
    // route.ts's own R5-fix4 comment). Shown for both paths now.
    const showChooser = accountChoice === "unknown";

    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-5 py-14">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">ROAM</p>
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-foreground">
            {linkSlug ? "Salvează-ți călătoria" : "Călătoriile mele"}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            {linkSlug
              ? "Cu un cont, devii automat participant în călătorie și o găsești mai târziu de pe orice telefon."
              : "Introdu numărul de telefon și PIN-ul cu care ai creat călătoriile, ca să le vezi aici."}
          </p>
        </div>

        {showChooser ? (
          <div className="flex flex-col gap-3">
            <p className="text-[15px] font-medium text-foreground">Ai deja un cont?</p>
            <button
              onClick={() => setAccountChoice("existing")}
              className="rounded-2xl bg-primary py-[16px] text-[16px] font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
            >
              Da, am cont
            </button>
            <button
              onClick={() => setAccountChoice("new")}
              className="rounded-2xl border border-border bg-card py-[16px] text-[16px] font-semibold text-foreground transition-all active:scale-[0.98]"
            >
              Nu, e prima dată
            </button>
            {linkSlug && (
              <>
                <Link
                  href={`/trip/${linkSlug}/settings`}
                  className="text-center text-[13px] font-medium text-muted-foreground underline"
                >
                  Sari peste
                </Link>
                <p className="text-center text-[12px] leading-relaxed text-muted-foreground">
                  Dacă amâni acum, călătoria rămâne doar pe acest dispozitiv -- o poți asocia unui cont mai târziu,
                  revenind aici din meniul de profil.
                </p>
              </>
            )}
          </div>
        ) : (
          <form onSubmit={handleAuthSubmit} className="flex flex-col gap-4">
            {linkSlug && (
              <button
                type="button"
                onClick={() => setAccountChoice("unknown")}
                className="self-start text-[13px] font-medium text-muted-foreground underline"
              >
                ‹ Înapoi
              </button>
            )}

            {accountChoice === "new" && (
              <div>
                <label htmlFor="displayName" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                  Numele tău
                </label>
                <input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="ex. Andrei"
                  required
                  maxLength={60}
                  className="w-full rounded-2xl border border-border bg-card px-5 py-4 text-[16px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
                />
              </div>
            )}

            <div>
              <label htmlFor="phoneNumber" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                Număr de telefon
              </label>
              <input
                id="phoneNumber"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="07xx xxx xxx"
                required
                className="w-full rounded-2xl border border-border bg-card px-5 py-4 text-[16px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
              />
            </div>
            <div>
              <label htmlFor="pin" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
                PIN (4-6 cifre)
              </label>
              <input
                id="pin"
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4,6}"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••"
                required
                className="w-full rounded-2xl border border-border bg-card px-5 py-4 text-[16px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
              />
            </div>

            {authError && <p className="text-[13px] text-destructive">{authError}</p>}

            <button
              type="submit"
              disabled={authenticating}
              className="mt-2 flex items-center justify-center gap-2 rounded-2xl bg-primary py-[16px] text-[16px] font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
            >
              {authenticating ? <Loader2 size={18} className="animate-spin" /> : linkSlug ? "Salvează" : "Intră"}
            </button>

            {linkSlug && (
              <>
                <Link
                  href={`/trip/${linkSlug}/settings`}
                  className="text-center text-[13px] font-medium text-muted-foreground underline"
                >
                  Sari peste
                </Link>
                <p className="text-center text-[12px] leading-relaxed text-muted-foreground">
                  Dacă amâni acum, călătoria rămâne doar pe acest dispozitiv -- o poți asocia unui cont mai târziu,
                  revenind aici din meniul de profil.
                </p>
              </>
            )}
          </form>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-5 pb-20 pt-14">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-foreground">
            {isAdmin ? "Toate călătoriile" : "Călătoriile mele"}
          </h1>
          {isAdmin && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              Cont admin -- toate solicitările și călătoriile de pe platformă.
            </p>
          )}
        </div>
        <button
          onClick={handleLogOut}
          className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground"
        >
          <LogOut size={14} />
          Ieși din cont
        </button>
      </div>

      {trips === null ? (
        <div className="flex justify-center py-10">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <TripsList trips={trips} isAdmin={isAdmin} onRetry={loadTrips} />
      )}
    </main>
  );
}
