"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Sparkles } from "lucide-react";
import { createPublicTrip } from "@/lib/publicTripCreation";

const MIN_DURATION_DAYS = 3;
const MAX_DURATION_DAYS = 10;
const DURATION_OPTIONS = Array.from(
  { length: MAX_DURATION_DAYS - MIN_DURATION_DAYS + 1 },
  (_, i) => MIN_DURATION_DAYS + i,
);

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

export default function HomePage() {
  const router = useRouter();

  const [destination, setDestination] = useState("");
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [durationDays, setDurationDays] = useState(5);
  const [website, setWebsite] = useState(""); // honeypot -- see route.ts
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // R5: requestId is a real idempotency key for trip creation
  // (src/lib/publicTripCreation.ts) -- generated once per distinct
  // attempt, kept stable across a retry of THAT attempt (a failed
  // submit's own "try again" click), and reset whenever the person
  // actually changes what they're submitting, so a genuine correction
  // is never mistaken for a retry of the old input.
  const requestIdRef = useRef<string | null>(null);

  function handleDestinationChange(v: string) {
    requestIdRef.current = null;
    setDestination(v);
  }
  function handleStartDateChange(v: string) {
    requestIdRef.current = null;
    setStartDate(v);
  }
  function handleDurationDaysChange(v: number) {
    requestIdRef.current = null;
    setDurationDays(v);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    if (!requestIdRef.current) requestIdRef.current = crypto.randomUUID();
    setError(null);
    setSubmitting(true);
    try {
      const result = await createPublicTrip({
        destination,
        startDate,
        durationDays,
        website,
        requestId: requestIdRef.current,
      });
      router.push(`/trips?link=${result.slug}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Nu am putut crea călătoria. Încearcă din nou.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-5 py-14">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">ROAM</p>
        <h1 className="text-[34px] font-bold leading-[1.05] tracking-tight text-foreground">
          Pornește o vacanță plină de descoperiri
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          Spune-ne destinația, data și durata — pregătim întrebările, provocările de seară și un vot pentru premiul
          familiei, ca la Kassandra 2026.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="destination" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
            Destinație
          </label>
          <input
            id="destination"
            value={destination}
            onChange={(e) => handleDestinationChange(e.target.value)}
            placeholder="ex. Corfu, Grecia"
            required
            maxLength={80}
            className="w-full rounded-2xl border border-border bg-card px-5 py-4 text-[16px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label htmlFor="startDate" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
              Data de start
            </label>
            <input
              id="startDate"
              type="date"
              value={startDate}
              onChange={(e) => handleStartDateChange(e.target.value)}
              required
              className="w-full rounded-2xl border border-border bg-card px-4 py-4 text-[15px] text-foreground outline-none transition-colors focus:border-primary"
            />
          </div>
          <div className="w-28">
            <label htmlFor="durationDays" className="mb-1.5 block text-[13px] font-medium text-muted-foreground">
              Zile
            </label>
            <select
              id="durationDays"
              value={durationDays}
              onChange={(e) => handleDurationDaysChange(Number(e.target.value))}
              className="w-full rounded-2xl border border-border bg-card px-4 py-4 text-center text-[15px] text-foreground outline-none transition-colors focus:border-primary"
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Honeypot: invisible to a real visitor (off-screen, never
            focusable), but a naive bot filling every field will trip it.
            See app/api/trips/create/route.ts. */}
        <div className="absolute left-[-9999px]" aria-hidden="true">
          <label htmlFor="website">Website</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>

        {error && <p className="text-[13px] text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="mt-2 flex items-center justify-center gap-2 rounded-2xl bg-primary py-[16px] text-[16px] font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary-hover active:scale-[0.98] disabled:opacity-60"
        >
          {submitting ? (
            <>
              <Loader2 size={18} className="animate-spin" />
              Se creează călătoria...
            </>
          ) : (
            <>
              <Sparkles size={18} />
              Creează călătoria
            </>
          )}
        </button>
      </form>

      <Link href="/trips" className="text-center text-[13px] font-medium text-muted-foreground underline">
        Ai creat deja o călătorie? Vezi-le aici
      </Link>
    </main>
  );
}
