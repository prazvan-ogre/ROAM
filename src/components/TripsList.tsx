"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Plus } from "lucide-react";
import type { Trip } from "@/lib/trip";
import { PendingTripModal } from "@/components/PendingTripModal";

// R5: extracted from app/trip/[slug]/settings/page.tsx's own TripsSection
// (R4) so app/trips/page.tsx can show the same cards/statuses instead of
// re-deriving its own -- one place owns "what a trip card/status looks
// like", reused by both the global list and Setări > Toate călătoriile.
export const TRIP_STATUS_LABEL: Record<Trip["content_status"], string> = {
  ready: "Gata",
  pending: "În pregătire",
  generating: "În pregătire",
  failed: "Eșuat",
};

export function TripsList({
  trips,
  isAdmin,
  currentSlug,
  onRetry,
}: {
  trips: Trip[] | "error";
  isAdmin: boolean;
  currentSlug?: string;
  onRetry: () => void;
}) {
  const [pendingTrip, setPendingTrip] = useState<Trip | null>(null);

  if (trips === "error") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card px-5 py-8 text-center">
        <p className="text-[15px] text-muted-foreground">Nu am putut încărca lista de călătorii.</p>
        <button onClick={onRetry} className="text-[14px] font-semibold text-primary underline">
          Încearcă din nou
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {isAdmin && (
        <p className="text-[13px] text-muted-foreground">
          Cont admin -- toate solicitările și călătoriile de pe platformă.
        </p>
      )}

      {trips.length === 0 ? (
        <p className="text-center text-[15px] text-muted-foreground">Nicio călătorie încă.</p>
      ) : (
        trips.map((t) => {
          const isCurrent = t.slug === currentSlug;
          const cardClass = `flex w-full items-center justify-between rounded-2xl border px-5 py-4 text-left transition-all active:scale-[0.99] ${
            isCurrent ? "border-primary bg-primary/5" : "border-border bg-card"
          }`;
          const cardContent = (
            <>
              <div className="flex min-w-0 items-center gap-2.5">
                {isCurrent && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-[16px] font-semibold text-foreground">{t.name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {t.start_date} · {t.duration_days} zile
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-[12px] font-medium ${
                  t.content_status === "ready"
                    ? "bg-accent text-primary"
                    : t.content_status === "failed"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-secondary text-muted-foreground"
                }`}
              >
                {TRIP_STATUS_LABEL[t.content_status]}
              </span>
            </>
          );

          return t.content_status === "ready" ? (
            <Link key={t.id} href={`/trip/${t.slug}`} className={cardClass}>
              {cardContent}
            </Link>
          ) : (
            <button key={t.id} onClick={() => setPendingTrip(t)} className={cardClass}>
              {cardContent}
            </button>
          );
        })
      )}

      <Link
        href="/"
        className="mt-2 flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-[14px] text-[15px] font-semibold text-foreground transition-all active:scale-[0.98]"
      >
        <Plus size={16} />
        Creează o călătorie nouă
      </Link>

      {pendingTrip && <PendingTripModal tripName={pendingTrip.name} onClose={() => setPendingTrip(null)} />}
    </div>
  );
}
