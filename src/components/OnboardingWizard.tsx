"use client";

import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { getOrCreateAdultParticipant, addChildProfile } from "@/lib/participant";
import { getPrizeStatus, castPrizeVote, type PrizeStatus } from "@/lib/prize";
import { trackEvent } from "@/lib/analytics";
import { Btn } from "@/components/ui";
import type { Trip } from "@/lib/trip";
import type { ParticipantRole } from "@/lib/supabase/types";

type Step = "intro" | "name" | "role" | "how" | "prize";

const STEP_ORDER: Step[] = ["intro", "name", "role", "how", "prize"];

// First-visit onboarding, product owner spec: theme intro -> collect name
// -> "adult sau copil" (participant is created right here) -> how the game
// works -> vote for the prize -> hands off to the Dashboard. Forward-only
// by design -- no back nav -- so there's no path that could re-submit the
// join once it succeeds.
export function OnboardingWizard({ trip, onComplete }: { trip: Trip; onComplete: () => Promise<void> }) {
  const [step, setStep] = useState<Step>("intro");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ParticipantRole | null>(null);
  const [age, setAge] = useState("");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  const [prizeStatus, setPrizeStatus] = useState<PrizeStatus | null>(null);
  const [selectedPrizeId, setSelectedPrizeId] = useState<string | null>(null);

  useEffect(() => {
    getPrizeStatus(trip.id)
      .then(setPrizeStatus)
      .catch(() => setPrizeStatus({ options: [], votingOpen: false, winner: null, closesAt: null }));
  }, [trip.id]);

  const stepIndex = STEP_ORDER.indexOf(step);

  function goNext() {
    const next = STEP_ORDER[stepIndex + 1];
    if (next) setStep(next);
  }

  async function handleJoin() {
    if (participantId) {
      goNext();
      return;
    }
    if (!role || !name.trim()) return;
    if (role === "child" && !Number(age)) {
      setError("Introdu vârsta.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const participant =
        role === "adult"
          ? await getOrCreateAdultParticipant(trip.id, name.trim())
          : await addChildProfile(trip.id, name.trim(), Number(age));
      await trackEvent(trip.id, "trip_joined", participant.id);
      setParticipantId(participant.id);
      goNext();
    } catch {
      setError("Nu s-a putut salva. Încearcă din nou.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFinish() {
    setFinishing(true);
    try {
      if (canVote && selectedPrizeId && participantId) {
        await castPrizeVote(trip.id, participantId, selectedPrizeId);
      }
      await onComplete();
    } finally {
      setFinishing(false);
    }
  }

  const canVote = !!prizeStatus && prizeStatus.votingOpen && prizeStatus.options.length > 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-6 pb-12 pt-16">
      <div className="mb-10 flex justify-center gap-1.5">
        {STEP_ORDER.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i <= stepIndex ? "w-6 bg-primary" : "w-1.5 bg-disabled"
            }`}
          />
        ))}
      </div>

      <div className="flex flex-1 flex-col">
        {step === "intro" && (
          <div className="flex flex-1 flex-col justify-center gap-4 text-center">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-primary">Bine ai venit</p>
            <h1 className="text-[28px] font-semibold leading-[1.15] tracking-tight text-foreground">
              Vacanța asta explorăm {trip.name}
            </h1>
            <p className="text-[17px] leading-relaxed text-muted-foreground">
              Istorie, curiozități și gastronomie — descoperite împreună, o zi pe rând.
            </p>
          </div>
        )}

        {step === "name" && (
          <div className="flex flex-1 flex-col justify-center gap-4">
            <h1 className="text-center text-[24px] font-semibold tracking-tight text-foreground">
              Cum te numești?
            </h1>
            <input
              className="rounded-2xl border border-border bg-card px-5 py-4 text-center text-[17px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && name.trim() && goNext()}
              placeholder="Numele tău"
              autoFocus
            />
          </div>
        )}

        {step === "role" && (
          <div className="flex flex-1 flex-col justify-center gap-5">
            <h1 className="text-center text-[24px] font-semibold tracking-tight text-foreground">
              Ești adult sau copil?
            </h1>
            <div className="flex flex-col gap-2">
              {(["adult", "child"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRole(r)}
                  className={`rounded-2xl border px-4 py-4 text-center text-[16px] font-medium transition-all ${
                    role === r ? "border-primary bg-accent text-foreground" : "border-border bg-card text-foreground"
                  }`}
                >
                  {r === "adult" ? "Adult" : "Copil"}
                </button>
              ))}
            </div>
            {role === "child" && (
              <input
                className="rounded-xl border border-border bg-card px-4 py-3 text-center text-[15px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
                placeholder="Vârsta"
                type="number"
                min={0}
                max={17}
                value={age}
                onChange={(e) => setAge(e.target.value)}
              />
            )}
            {error && <p className="text-center text-[13px] text-destructive">{error}</p>}
          </div>
        )}

        {step === "how" && (
          <div className="flex flex-1 flex-col justify-center gap-4 text-center">
            <h1 className="text-[24px] font-semibold tracking-tight text-foreground">Cum funcționează</h1>
            <p className="text-[17px] leading-relaxed text-muted-foreground">
              În fiecare zi ai 2 întrebări — una dimineața, una la prânz.
              <br />
              Seara e Battle: Copii vs. Părinți, pe puncte. 🎉
            </p>
          </div>
        )}

        {step === "prize" && (
          <div className="flex flex-1 flex-col justify-center gap-4">
            {!prizeStatus ? (
              <p className="text-center text-[15px] text-muted-foreground">Se încarcă...</p>
            ) : prizeStatus.options.length === 0 ? (
              <div className="text-center">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-primary">Premiul</p>
                <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-foreground">🏆 Cine câștigă</h1>
                <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">Va fi anunțat în curând.</p>
              </div>
            ) : !prizeStatus.votingOpen && prizeStatus.winner ? (
              <div className="text-center">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-primary">Premiul stabilit</p>
                <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-foreground">
                  🏆 {prizeStatus.winner.title}
                </h1>
                {prizeStatus.winner.description && (
                  <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                    {prizeStatus.winner.description}
                  </p>
                )}
              </div>
            ) : (
              <>
                <p className="text-center text-[13px] font-semibold uppercase tracking-wide text-primary">
                  Alege premiul
                </p>
                <h1 className="text-center text-[22px] font-semibold tracking-tight text-foreground">
                  Ce premiu ți-ar plăcea?
                </h1>
                <div className="flex flex-col gap-2">
                  {prizeStatus.options.map((opt) => (
                    <button
                      key={opt.id}
                      onClick={() => setSelectedPrizeId(opt.id)}
                      className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                        selectedPrizeId === opt.id
                          ? "border-primary bg-accent"
                          : "border-border bg-card"
                      }`}
                    >
                      <p className="text-[15px] font-semibold text-foreground">{opt.title}</p>
                      {opt.description && (
                        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{opt.description}</p>
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mt-8">
        {step === "role" ? (
          <Btn onClick={handleJoin} disabled={submitting || !role || !name.trim()}>
            {submitting ? "..." : "Continuă"}
          </Btn>
        ) : step === "prize" ? (
          <Btn onClick={handleFinish} disabled={finishing || !prizeStatus || (canVote && !selectedPrizeId)}>
            {finishing ? "..." : <>{canVote ? "Votează și " : ""}Hai să începem <ArrowRight size={16} /></>}
          </Btn>
        ) : (
          <Btn onClick={goNext} disabled={step === "name" && !name.trim()}>
            Continuă <ArrowRight size={16} />
          </Btn>
        )}
      </div>
    </main>
  );
}
