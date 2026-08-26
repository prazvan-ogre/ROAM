"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Check, X, ExternalLink } from "lucide-react";
import { getOrCreateAdultParticipant, addChildProfile } from "@/lib/participant";
import { getPrizeStatus, castPrizeVote, type PrizeStatus } from "@/lib/prize";
import {
  getCatchUpQuestions,
  submitResponse,
  getOrAssignExtra,
  type CatchUpQuestion,
  type AnswerOption,
  type Extra,
  type Response,
} from "@/lib/discover";
import { trackEvent } from "@/lib/analytics";
import { Btn } from "@/components/ui";
import { currentTripDay, type Trip } from "@/lib/trip";
import type { ParticipantRole } from "@/lib/supabase/types";

type Step = "intro" | "name" | "role" | "how" | "catchup" | "prize";

const STEP_ORDER: Step[] = ["intro", "name", "role", "how", "catchup", "prize"];

const CATCHUP_SLOT_LABEL: Record<string, string> = { morning: "Dimineață", lunch: "Prânz" };
const CATCHUP_EXTRA_TYPE_LABEL: Record<string, string> = {
  know: "ȘTIAI CĂ",
  think: "GÂNDEȘTE-TE",
  connect: "CONEXIUNE",
  ask: "ÎNTREABĂ",
  explore: "EXPLOREAZĂ",
};

// First-visit onboarding, product owner spec: theme intro -> collect name
// -> "adult sau copil" (participant is created right here) -> how the game
// works -> catch up on any previous days' questions missed by joining
// partway through the trip -> vote for the prize -> hands off to the
// Dashboard. Forward-only by design -- no back nav -- so there's no path
// that could re-submit the join once it succeeds.
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

  // Populated once the participant exists (right after the "role" step) --
  // every Discover/Battle question they can no longer reach through the
  // normal flow (a past day's, or today's own once its time window has
  // closed), shown one after another below. Answered individually via
  // submitResponse, same as Discover -- this only ever builds up this
  // participant's own score (getParticipantLeaderboard), it never writes
  // to battle_scores, so it can't change any already-played Battle's
  // result.
  const [catchUpQuestions, setCatchUpQuestions] = useState<CatchUpQuestion[] | null>(null);
  const [catchUpIndex, setCatchUpIndex] = useState(0);
  const [catchUpSelected, setCatchUpSelected] = useState<AnswerOption | null>(null);
  const [catchUpResponse, setCatchUpResponse] = useState<Response | null>(null);
  // "extra" mirrors the live Discover flow's own post-reveal step (product
  // owner: a missed question still owes the same Extra/rabbit-hole content
  // the live flow gives, not just a correct/incorrect mark) -- only reached
  // for a Discover-kind catch-up question, since Extras are only ever
  // assigned against those (docs/DATABASE.md).
  const [catchUpPhase, setCatchUpPhase] = useState<"answer" | "extra">("answer");
  const [catchUpExtra, setCatchUpExtra] = useState<Extra | null>(null);

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

  useEffect(() => {
    if (!participantId) return;
    getCatchUpQuestions(trip.id, currentTripDay(trip), participantId)
      .then(setCatchUpQuestions)
      .catch((err) => {
        console.error("getCatchUpQuestions failed", err);
        setCatchUpQuestions([]);
      });
  }, [participantId, trip]);

  // Nothing to catch up on -- skip straight past the step instead of
  // showing an empty screen.
  useEffect(() => {
    if (step === "catchup" && catchUpQuestions !== null && catchUpQuestions.length === 0) {
      setStep("prize");
    }
  }, [step, catchUpQuestions]);

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
    } catch {
      setError("Nu s-a putut salva. Încearcă din nou.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCatchUpSubmit() {
    if (!catchUpQuestions || !catchUpSelected || !participantId) return;
    const current = catchUpQuestions[catchUpIndex];
    const response = await submitResponse(participantId, current.question.id, catchUpSelected);
    setCatchUpResponse(response);
  }

  async function handleCatchUpContinueToExtra() {
    if (!catchUpQuestions || !participantId) return;
    const current = catchUpQuestions[catchUpIndex];
    const assignedExtra = await getOrAssignExtra(participantId, role ?? "adult", current.question.id);
    setCatchUpExtra(assignedExtra);
    setCatchUpPhase("extra");
  }

  function handleCatchUpNext() {
    if (!catchUpQuestions) return;
    const nextIndex = catchUpIndex + 1;
    setCatchUpSelected(null);
    setCatchUpResponse(null);
    setCatchUpExtra(null);
    setCatchUpPhase("answer");
    if (nextIndex >= catchUpQuestions.length) {
      setStep("prize");
      return;
    }
    setCatchUpIndex(nextIndex);
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
  const currentCatchUp = catchUpQuestions?.[catchUpIndex] ?? null;

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

        {step === "catchup" && (
          <div className="flex flex-1 flex-col justify-center gap-4">
            {!currentCatchUp ? (
              <p className="text-center text-[15px] text-muted-foreground">Se încarcă...</p>
            ) : catchUpPhase === "extra" ? (
              <>
                <p className="text-center text-[13px] font-semibold uppercase tracking-wide text-primary">
                  De recuperat · Ziua {currentCatchUp.question.day_number} ·{" "}
                  {CATCHUP_SLOT_LABEL[currentCatchUp.question.slot ?? ""] ?? "Battle"} · {catchUpIndex + 1}/
                  {catchUpQuestions?.length ?? 0}
                </p>
                {catchUpExtra ? (
                  <div className="flex flex-col gap-2">
                    <span className="text-center text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
                      {catchUpExtra.extra_type ? CATCHUP_EXTRA_TYPE_LABEL[catchUpExtra.extra_type] : "EXTRA"}
                    </span>
                    <p className="text-center text-[17px] leading-relaxed text-foreground">
                      {catchUpExtra.description ?? catchUpExtra.title}
                    </p>
                  </div>
                ) : (
                  <p className="text-center text-muted-foreground">
                    Nu mai sunt Extra-uri disponibile pentru această întrebare.
                  </p>
                )}
                {currentCatchUp.exploreLinks.length > 0 && (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-[12px] font-medium text-disabled">🐇 Vrei să afli mai mult?</p>
                    {currentCatchUp.exploreLinks.map((link) => (
                      <a
                        key={link.id}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-[14px] text-primary hover:underline"
                      >
                        <ExternalLink size={13} />
                        {link.title}
                      </a>
                    ))}
                  </div>
                )}
                <p className="text-center text-[14px] leading-relaxed text-disabled">
                  Ceilalți au descoperit ceva puțin diferit.
                  <br />
                  Întreabă-i ce au primit. 👋
                </p>
              </>
            ) : (
              <>
                <p className="text-center text-[13px] font-semibold uppercase tracking-wide text-primary">
                  De recuperat · Ziua {currentCatchUp.question.day_number} ·{" "}
                  {CATCHUP_SLOT_LABEL[currentCatchUp.question.slot ?? ""] ?? "Battle"} · {catchUpIndex + 1}/
                  {catchUpQuestions?.length ?? 0}
                </p>
                <h1 className="text-center text-[22px] font-semibold leading-snug tracking-tight text-foreground">
                  {currentCatchUp.question.prompt}
                </h1>
                <div className="flex flex-col gap-2">
                  {currentCatchUp.options.map((opt) => {
                    const isSelected = catchUpSelected?.id === opt.id;
                    const revealed = !!catchUpResponse;
                    const isRight = opt.is_correct;
                    return (
                      <button
                        key={opt.id}
                        disabled={revealed}
                        onClick={() => setCatchUpSelected(opt)}
                        className={`flex items-center justify-between gap-2 rounded-2xl border px-4 py-4 text-left text-[15px] font-medium transition-all ${
                          revealed
                            ? isRight
                              ? "border-primary bg-accent text-foreground"
                              : isSelected
                                ? "border-destructive bg-destructive/10 text-foreground"
                                : "border-border bg-card text-muted-foreground"
                            : isSelected
                              ? "border-primary bg-accent text-foreground"
                              : "border-border bg-card text-foreground"
                        }`}
                      >
                        {opt.label}
                        {revealed && isRight && <Check size={16} className="shrink-0 text-primary" />}
                        {revealed && isSelected && !isRight && <X size={16} className="shrink-0 text-destructive" />}
                      </button>
                    );
                  })}
                </div>
                {catchUpResponse && (
                  <div className="flex flex-col gap-3">
                    {(() => {
                      const message = catchUpResponse.is_correct
                        ? currentCatchUp.question.correct_reveal_message
                        : currentCatchUp.question.alternative_reveal_message;
                      return message ? (
                        <p className="text-center text-[15px] leading-relaxed text-secondary-foreground">{message}</p>
                      ) : null;
                    })()}
                    {currentCatchUp.question.common_core && (
                      <p className="text-center text-[15px] leading-relaxed text-secondary-foreground">
                        {currentCatchUp.question.common_core}
                      </p>
                    )}
                    {currentCatchUp.question.one_thing && (
                      <div className="border-l-2 border-primary py-1 pl-4">
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
                          The One Thing
                        </p>
                        <p className="text-[15px] font-medium leading-snug text-foreground">
                          {currentCatchUp.question.one_thing}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
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
                  Ce ar trebui să primească echipa câștigătoare — Copii sau Părinți?
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
        ) : step === "catchup" ? (
          <Btn
            onClick={
              catchUpPhase === "extra"
                ? handleCatchUpNext
                : catchUpResponse
                  ? currentCatchUp?.question.kind === "discover"
                    ? handleCatchUpContinueToExtra
                    : handleCatchUpNext
                  : handleCatchUpSubmit
            }
            disabled={!currentCatchUp || (catchUpPhase === "answer" && !catchUpResponse && !catchUpSelected)}
          >
            {catchUpPhase === "extra"
              ? "Continuă"
              : catchUpResponse
                ? currentCatchUp?.question.kind === "discover"
                  ? "Mergi mai departe"
                  : "Continuă"
                : "Răspunde"}{" "}
            <ArrowRight size={16} />
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
