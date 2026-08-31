"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, LogOut, Plus } from "lucide-react";
import { getAllTrips, getTripBySlug, getTripsForAccount, type Trip } from "@/lib/trip";
import { getOrCreateAdultParticipant } from "@/lib/participant";
import {
  authenticateCreatorAccount,
  clearStoredAccountId,
  getStoredAccountId,
  getStoredIsAdmin,
} from "@/lib/creatorAccount";
import { PendingTripModal } from "@/components/PendingTripModal";

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

const STATUS_LABEL: Record<Trip["content_status"], string> = {
  ready: "Gata",
  pending: "În pregătire",
  generating: "În pregătire",
  failed: "Eșuat",
};

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

  const [step, setStep] = useState<Step>("loading");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingTrip, setPendingTrip] = useState<Trip | null>(null);
  const [accountChoice, setAccountChoice] = useState<AccountChoice>("unknown");
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [pin, setPin] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authenticating, setAuthenticating] = useState(false);

  const loadTrips = useCallback(async (accountId: string) => {
    const admin = getStoredIsAdmin();
    const list = admin ? await getAllTrips() : await getTripsForAccount(accountId);
    setIsAdmin(admin);
    setTrips(list);
    setStep("list");
  }, []);

  useEffect(() => {
    const accountId = getStoredAccountId();
    if (accountId) {
      loadTrips(accountId).catch(() => setStep("auth"));
    } else {
      setStep("auth");
    }
  }, [loadTrips]);

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    if (authenticating) return;
    setAuthError(null);
    setAuthenticating(true);
    try {
      const result = await authenticateCreatorAccount({
        phoneNumber,
        pin,
        linkTripSlug: linkSlug ?? undefined,
        displayName: accountChoice === "new" ? displayName : undefined,
        expectExisting: linkSlug ? accountChoice === "existing" : undefined,
      });

      // Product owner request: whoever creates a trip should become its
      // first participant automatically instead of separately joining
      // later through the onboarding wizard with the same name. Requires
      // a name -- either just given (new account) or already on file
      // (returning account, src/lib/creatorAccount.ts) -- so this is a
      // no-op for an older account that never set one. Best-effort: a
      // failure here shouldn't block getting into "Călătoriile mele".
      if (linkSlug && result.displayName) {
        try {
          const trip = await getTripBySlug(linkSlug);
          if (trip) await getOrCreateAdultParticipant(trip.id, result.displayName);
        } catch (joinErr) {
          console.error("Auto-join after account creation failed", joinErr);
        }
      }

      // Right after creating a trip, land inside it (Setări > Toate
      // călătoriile) instead of on this standalone page -- product owner
      // request. The plain "Călătoriile mele" login (no linkSlug) still
      // lands here, showing the list on this page as before.
      if (linkSlug) {
        router.push(`/trip/${linkSlug}/settings`);
        return;
      }

      await loadTrips(result.accountId);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Nu am putut verifica contul. Încearcă din nou.");
    } finally {
      setAuthenticating(false);
    }
  }

  function handleLogOut() {
    clearStoredAccountId();
    setTrips([]);
    setIsAdmin(false);
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
    const showChooser = Boolean(linkSlug) && accountChoice === "unknown";

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
            <Link
              href={`/trip/${linkSlug}/settings`}
              className="text-center text-[13px] font-medium text-muted-foreground underline"
            >
              Sari peste
            </Link>
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
              <Link
                href={`/trip/${linkSlug}/settings`}
                className="text-center text-[13px] font-medium text-muted-foreground underline"
              >
                Sari peste
              </Link>
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

      {trips.length === 0 ? (
        <p className="text-center text-[15px] text-muted-foreground">Nicio călătorie încă.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {trips.map((trip) => {
            const cardClass =
              "flex w-full items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 text-left transition-all active:scale-[0.99]";
            const cardContent = (
              <>
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-semibold text-foreground">{trip.name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {trip.start_date} · {trip.duration_days} zile
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium ${
                    trip.content_status === "ready"
                      ? "bg-accent text-primary"
                      : trip.content_status === "failed"
                        ? "bg-destructive/10 text-destructive"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {STATUS_LABEL[trip.content_status]}
                </span>
              </>
            );

            return trip.content_status === "ready" ? (
              <Link key={trip.id} href={`/trip/${trip.slug}`} className={cardClass}>
                {cardContent}
              </Link>
            ) : (
              <button key={trip.id} onClick={() => setPendingTrip(trip)} className={cardClass}>
                {cardContent}
              </button>
            );
          })}
        </div>
      )}

      <Link
        href="/"
        className="mt-2 flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-[14px] text-[15px] font-semibold text-foreground transition-all active:scale-[0.98]"
      >
        <Plus size={16} />
        Creează o călătorie nouă
      </Link>

      {pendingTrip && <PendingTripModal tripName={pendingTrip.name} onClose={() => setPendingTrip(null)} />}
    </main>
  );
}
