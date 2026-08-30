"use client";

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Loader2, LogOut, Plus } from "lucide-react";
import { getAllTrips, getTripsForAccount, type Trip } from "@/lib/trip";
import {
  authenticateCreatorAccount,
  clearStoredAccountId,
  getStoredAccountId,
  getStoredIsAdmin,
} from "@/lib/creatorAccount";

// This page has no dynamic route segment, so Next would otherwise try to
// statically prerender it at build time -- which eagerly loads the
// Supabase client (a top-level createClient() call in
// src/lib/supabase/client.ts) with no env vars available in that
// context, failing the build. Every other page reading trip data either
// has a [slug] segment (never prerendered without generateStaticParams)
// or, like "/", never imports the Supabase client at module scope.
export const dynamic = "force-dynamic";

type Step = "loading" | "auth" | "list";

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
  const searchParams = useSearchParams();
  const linkSlug = searchParams.get("link");

  const [step, setStep] = useState<Step>("loading");
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
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
      const accountId = await authenticateCreatorAccount({
        phoneNumber,
        pin,
        linkTripSlug: linkSlug ?? undefined,
      });
      await loadTrips(accountId);
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
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-5 py-14">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">ROAM</p>
          <h1 className="text-[28px] font-bold leading-[1.1] tracking-tight text-foreground">
            {linkSlug ? "Salvează-ți călătoria" : "Călătoriile mele"}
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
            {linkSlug
              ? "Adaugă un număr de telefon și un PIN ca să-ți găsești călătoria mai târziu, de pe orice telefon."
              : "Introdu numărul de telefon și PIN-ul cu care ai creat călătoriile, ca să le vezi aici."}
          </p>
        </div>

        <form onSubmit={handleAuthSubmit} className="flex flex-col gap-4">
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
              href={`/trip/${linkSlug}`}
              className="text-center text-[13px] font-medium text-muted-foreground underline"
            >
              Sari peste
            </Link>
          )}
        </form>
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
          {trips.map((trip) => (
            <Link
              key={trip.id}
              href={`/trip/${trip.slug}`}
              className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-4 transition-all active:scale-[0.99]"
            >
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
            </Link>
          ))}
        </div>
      )}

      <Link
        href="/"
        className="mt-2 flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-[14px] text-[15px] font-semibold text-foreground transition-all active:scale-[0.98]"
      >
        <Plus size={16} />
        Creează o călătorie nouă
      </Link>
    </main>
  );
}
