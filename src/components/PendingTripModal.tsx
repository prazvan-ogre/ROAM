"use client";

// Shown instead of navigating into a not-yet-ready trip (content_status
// pending/generating/failed) from a trip list -- app/trips/page.tsx and
// the "Toate călătoriile" tab in app/trip/[slug]/settings/page.tsx.
// Staying on the list (closing the modal, not navigating anywhere) is
// simpler than a dedicated screen: there's nothing to show yet, so
// there's nothing to navigate to.
export function PendingTripModal({ tripName, onClose }: { tripName: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-card p-6 text-center shadow-[0_8px_40px_rgba(0,0,0,0.2)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <p className="text-[17px] font-semibold text-foreground">Pregătim {tripName}...</p>
        <p className="mt-2 text-[14px] text-muted-foreground">
          Întrebările și provocările pentru această călătorie sunt în lucru. Revino mai târziu.
        </p>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-2xl bg-primary py-3 text-[15px] font-semibold text-primary-foreground transition-all duration-150 active:scale-[0.98]"
        >
          OK
        </button>
      </div>
    </div>
  );
}
