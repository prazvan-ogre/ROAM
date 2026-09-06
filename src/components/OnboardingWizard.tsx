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
//
// Catching up on previous days' Discover/Battle questions is NOT part of
// this wizard (product owner follow-up: it was interposed here before the
// prize step, but catch-up is a homepage thing) -- it's always reachable
// from the Dashboard's "Ai întrebări de recuperat" banner instead, via
// /trip/[slug]/catchup, for any already-joined participant, not just a
// brand-new one.
export function OnboardingWizard({ trip, onComplete }: { trip: Trip; onComplete: () => Promise<void> }) {
  const [step, setStep] = useState<Step>("intro");
  const [name, setName] = useState("");
  const [role, setRole] = useState<ParticipantRole | null>(null);
  const [age, setAge] = useState("");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  const [prizeStatus, setPrizeStatus] = useState<PrizeStatus | null>(null);
  const [selectedPrizeId, setSelectedPrizeId] = useState<string | null>(null);

  useEffect(() => {
    getPrizeStatus(trip.id)
      .then(setPrizeStatus)
      .catch((err) => {
        // Falls back to "no options" rather than blocking the wizard --
        // but log it, since this hides real causes (e.g. the
        // prize_options/prize_votes migration not applied yet) behind an
        // empty-looking prize step.
        console.error("getPrizeStatus failed", err);
        setPrizeStatus({ options: [], votingOpen: false, winner: null, closesAt: null });
      });
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
    setSubmitting(true);
    setError(null);
    try {
      const participant =
        role === "adult"
          ? await getOrCreateAdultParticipant(trip.id, name.trim())
          : await addChildProfile(trip.id, name.trim(), age ? Number(age) : null);
      await trackEvent(trip.id, "trip_joined", participant.id);
      setParticipantId(participant.id);
      goNext();
    } catch (err) {
      console.error("OnboardingWizard join failed", err);
      setError("Nu s-a putut salva. Încearcă din nou.");
    } finally {
      setSubmitting(false);
    }
  }

  // R4 (2026-09-06 batch): a failed vote or a failed onComplete() (e.g.
  // the follow-up profile refresh) used to leave finishing=false with no
  // explanation at all -- the button looked clickable again, but nothing
  // told the user their tap hadn't actually gotten them in. Retrying is
  // now safe either way: castPrizeVote is idempotent on this
  // participant's own vote (src/lib/prize.ts), so a vote that already
  // landed on a previous attempt is never duplicated or errors out again
  // on retry -- only onComplete() (which never mutates anything itself)
  // needs to actually rerun.
  async function handleFinish() {
    setFinishing(true);
    setFinishError(null);
    try {
      if (canVote && selectedPrizeId && participantId) {
        await castPrizeVote(trip.id, participantId, selectedPrizeId);
      }
      await onComplete();
    } catch (err) {
      console.error("OnboardingWizard finish failed", err);
      setFinishError("Nu am putut finaliza. Încearcă din nou.");
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
              Halkidiki are trei peninsule întinse în mare ca degetele unei mâini — noi suntem pe
              prima, Kassandra. Se spune că formele lor vin din legenda tridentului lui Poseidon.
              Ne așteaptă plaje turcoaz, sate din piatră și câte puțină mitologie la fiecare pas.
            </p>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              Restul le descoperim pe parcurs, o zi pe rând. 🌊
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
              În ce echipă faci parte?
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
                  {r === "adult" ? "Adulți" : "Copii"}
                </button>
              ))}
            </div>
            {role === "child" && (
              <input
                className="rounded-xl border border-border bg-card px-4 py-3 text-center text-[15px] text-foreground outline-none transition-colors placeholder:text-disabled focus:border-primary"
                placeholder="Vârsta (opțional)"
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
                <p className="text-[13px] font-semibold uppercase tracking-wide text-primary">
                  Premiul câștigătorilor
                </p>
                <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-foreground">
                  🏆 Copii vs. Părinți
                </h1>
                <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
                  La final, o singură echipă câștigă. Premiul ei va fi anunțat în curând.
                </p>
              </div>
            ) : !prizeStatus.votingOpen && prizeStatus.winner ? (
              <div className="text-center">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-primary">
                  Premiul câștigătorilor
                </p>
                <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-foreground">
                  🏆 {prizeStatus.winner.title}
                </h1>
                <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                  Asta primește echipa care câștigă — Copii sau Părinți.
                </p>
                {prizeStatus.winner.description && (
                  <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
                    {prizeStatus.winner.description}
                  </p>
                )}
              </div>
            ) : (
              <>
                <p className="text-center text-[13px] font-semibold uppercase tracking-wide text-primary">
                  Premiul câștigătorilor
                </p>
                <h1 className="text-center text-[22px] font-semibold tracking-tight text-foreground">
                  Copii vs. Părinți
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
          <>
            {finishError && <p className="mb-3 text-center text-[13px] text-destructive">{finishError}</p>}
            <Btn onClick={handleFinish} disabled={finishing || !prizeStatus || (canVote && !selectedPrizeId)}>
              {finishing ? "..." : <>{canVote ? "Votează și " : ""}Hai să începem <ArrowRight size={16} /></>}
            </Btn>
          </>
        ) : (
          <Btn onClick={goNext} disabled={step === "name" && !name.trim()}>
            Continuă <ArrowRight size={16} />
          </Btn>
        )}
      </div>
    </main>
  );
}
