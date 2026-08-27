"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Btn, Centered } from "@/components/ui";

// Next.js's own fallback for an uncaught client-side exception just says
// "Eroare de aplicație: a apărut o excepție la nivelul clientului" with no
// detail -- useless for a report that only ever arrives as a phone
// screenshot, no browser console attached. This shows the actual error
// message on screen instead, scoped to everything under /trip/[slug]
// (the wizard, Discover, Battle, catch-up, recap, etc.) so a screenshot
// of *this* screen is enough to diagnose the real cause.
export default function TripError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { slug } = useParams<{ slug: string }>();

  return (
    <Centered>
      <p className="mb-2 text-[15px] font-semibold text-foreground">A apărut o eroare neașteptată.</p>
      <p className="mb-1 max-w-sm break-words text-[13px] text-muted-foreground">{error.message || "(fără mesaj)"}</p>
      {error.digest && <p className="mb-4 text-[11px] text-disabled">Cod: {error.digest}</p>}
      <div className="mt-4 flex flex-col items-center gap-3">
        <Btn onClick={reset}>Încearcă din nou</Btn>
        <Link href={`/trip/${slug}`} className="text-[13px] underline">
          Înapoi acasă
        </Link>
      </div>
    </Centered>
  );
}
