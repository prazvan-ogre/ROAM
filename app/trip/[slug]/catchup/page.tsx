"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X, History, ExternalLink } from "lucide-react";
import { getTripTemporalState, getTripTimezone, type Trip } from "@/lib/trip";
import {
  getCatchUpQuestions,
  submitAnswer,
  getOrAssignExtra,
  type CatchUpQuestion,
  type AnswerOption,
  type Extra,
  type Response,
} from "@/lib/discover";
import { Btn, FlowHeader, Centered } from "@/components/ui";
import { SLOT_LABEL, EXTRA_TYPE_LABEL } from "@/lib/constants";
import { useTrip, useProfiles, useActiveProfile } from "@/lib/hooks";

type Step = "loading" | "error" | "not-active" | "empty" | "question" | "reveal" | "done";

// Reachable any time from the Dashboard, unlike the wizard's own catch-up
// step which only ever runs once, right when a participant is first
// created (product owner follow-up: catch-up is a homepage thing, not a
// wizard step -- removed from OnboardingWizard entirely). Someone who
// joined on an earlier day (or just didn't get to answer everything back
// then) still needs a way back to those questions after the day rolls
// over -- this page is that way back, for any profile on the device, not
// only a brand-new one. Same rules as before: plain submitResponse
// (personal score only), never touches battle_scores, so it can't change
// an already-played Battle's result.
//
// Reveal and the assigned Extra/Explore links show together, automatically,
// the moment an answer is submitted -- no extra tap, no extra step
// (product owner: correctness alone isn't enough, and it shouldn't take an
// extra click to see the rest). Applies to both Discover and Battle
// questions now that Battle questions carry their own Extras too.
export default function CatchUpPage() {
  const { slug } = useParams<{ slug: string }>();
  const router = useRouter();

  const { data: trip, error: tripError } = useTrip(slug);
  const { data: profiles, error: profilesError } = useProfiles(trip?.id);
  // Reactive to ProfileMenu's "Schimbă profilul" (same fix as Discover,
  // hypothesis D's sibling issue, 2026-09-05 review) -- previously
  // resolved once, inside the effect below, from a plain
  // getStoredActiveProfileId() snapshot at the moment this page's
  // questions first loaded.
  const activeProfile = useActiveProfile(trip?.id, profiles);

  const [step, setStep] = useState<Step>("loading");
  const [questions, setQuestions] = useState<CatchUpQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<AnswerOption | null>(null);
  const [response, setResponse] = useState<Response | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  // R3 (2026-09-05 review, closure batch): same "conflict" distinction as
  // Discover -- see that page's wasConflict for the full rationale.
  const [wasConflict, setWasConflict] = useState(false);
  // R4 (2026-09-06 batch): same distinction as Discover's extraFailed --
  // an Extra failure must never hide the already-accepted answer reveal,
  // and gets its own small retry instead of silently vanishing.
  const [extraFailed, setExtraFailed] = useState(false);

  // R2 (2026-09-05 review, closure batch): same guard as Discover's
  // activeProfileIdRef -- kept in sync every render so handleSubmit's async
  // continuation below can detect a profile switch that happened while its
  // own request was still in flight.
  const activeProfileIdRef = useRef<string | null>(activeProfile?.id ?? null);
  activeProfileIdRef.current = activeProfile?.id ?? null;

  useEffect(() => {
    if (!trip || !profiles || profiles.length === 0 || !activeProfile) return;

    let cancelled = false;

    // Re-runs (via the activeProfile dependency below) every time the
    // active profile changes, even mid-session -- both the pending-
    // question list shown and the identity handleSubmit below will
    // submit as, since activeProfile is read fresh from the hook on
    // every render, not captured into local state here.
    async function load(t: Trip) {
      try {
        // R6: catch-up is never actionable while the trip itself isn't
        // active (scheduled -- nothing to recover yet; ended --
        // record_answer() would reject any new answer regardless).
        const temporal = getTripTemporalState(t, new Date());
        if (temporal.status !== "active") {
          if (!cancelled) setStep("not-active");
          return;
        }
        const pending = await getCatchUpQuestions(t.id, temporal.day, activeProfile!.id, getTripTimezone(t));
        if (cancelled) return;
        setQuestions(pending);
        setIndex(0);
        setSelected(null);
        setResponse(null);
        setExtra(null);
        setSubmitError(false);
        setWasConflict(false);
        setExtraFailed(false);
        setStep(pending.length === 0 ? "empty" : "question");
      } catch {
        if (!cancelled) setStep("error");
      }
    }

    load(trip);
    return () => {
      cancelled = true;
    };
  }, [trip, profiles, activeProfile]);

  // Same idempotent/retry-safe/fire-and-forget-side-effects contract as
  // Discover's handleSubmitAnswer (R3, 20260906140000_
  // record_answer_authoritative.sql) -- submitAnswer never contributes to
  // battle_scores here regardless of the underlying question's kind
  // (Discover or Battle), matching the product-owner rule that a
  // recovered/catch-up answer only ever scores personally.
  async function handleSubmit() {
    if (!activeProfile || !selected || submitting) return;
    const current = questions[index];
    const submittedProfileId = activeProfile.id;
    const submittedProfileRole = activeProfile.role;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const result = await submitAnswer(submittedProfileId, current.question.id, selected.id);
      if (activeProfileIdRef.current !== submittedProfileId) {
        // Switched to a different profile while this request was in
        // flight -- submittedProfileId's answer is already safely
        // recorded (record_answer is idempotent), but must never be
        // painted onto whichever OTHER profile's screen is showing now.
        return;
      }
      setResponse(result.response);
      setWasConflict(result.status === "conflict");
      setStep("reveal");

      getOrAssignExtra(submittedProfileId, submittedProfileRole, current.question.id)
        .then((assignedExtra) => {
          if (activeProfileIdRef.current !== submittedProfileId) return;
          setExtra(assignedExtra);
        })
        .catch((err) => {
          console.error("getOrAssignExtra failed", err);
          if (activeProfileIdRef.current === submittedProfileId) setExtraFailed(true);
        });
    } catch (err) {
      console.error("submitAnswer failed", err);
      if (activeProfileIdRef.current === submittedProfileId) {
        setSubmitError(true);
      }
    } finally {
      if (activeProfileIdRef.current === submittedProfileId) {
        setSubmitting(false);
      }
    }
  }

  function retryExtra() {
    if (!activeProfile) return;
    const current = questions[index];
    if (!current) return;
    const profileId = activeProfile.id;
    setExtraFailed(false);
    getOrAssignExtra(profileId, activeProfile.role, current.question.id)
      .then((assignedExtra) => {
        if (activeProfileIdRef.current !== profileId) return;
        setExtra(assignedExtra);
      })
      .catch((err) => {
        console.error("getOrAssignExtra retry failed", err);
        if (activeProfileIdRef.current === profileId) setExtraFailed(true);
      });
  }

  function handleAdvance() {
    const nextIndex = index + 1;
    setSelected(null);
    setResponse(null);
    setExtra(null);
    setExtraFailed(false);
    setSubmitError(false);
    setWasConflict(false);
    if (nextIndex >= questions.length) {
      setStep("done");
      return;
    }
    setIndex(nextIndex);
    setStep("question");
  }

  function goHome() {
    router.push(`/trip/${slug}`);
  }

  if (tripError || profilesError || step === "error") {
    return (
      <Centered>
        <p>Nu am putut încărca datele. Verifică-ți conexiunea.</p>
        <button onClick={() => window.location.reload()} className="mt-4 underline">
          Încearcă din nou
        </button>
      </Centered>
    );
  }

  // !trip covers both "still fetching" and "slug doesn't resolve to a
  // trip" the same way the pre-SWR version did (it never distinguished
  // the two, silently staying on the loading screen for a bad slug).
  if (!trip || !profiles) return <Centered>Se încarcă...</Centered>;

  if (profiles.length === 0) {
    return (
      <Centered>
        <p>Trebuie să te alături călătoriei mai întâi.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  if (step === "loading") return <Centered>Se încarcă...</Centered>;

  if (step === "not-active") {
    const temporal = getTripTemporalState(trip, new Date());
    return (
      <Centered>
        <p>{temporal.status === "scheduled" ? "Călătoria nu a început încă." : "Călătoria s-a încheiat."}</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  if (step === "empty") {
    return (
      <Centered>
        <p>Nimic de recuperat — {activeProfile?.display_name} a răspuns deja la tot.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  if (step === "done") {
    return (
      <Centered>
        <p>Ai recuperat tot! 🎉</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  const current = questions[index];
  if (!current) return <Centered>Se încarcă...</Centered>;
  const progressLabel = `Ziua ${current.question.day_number} · ${
    SLOT_LABEL[current.question.slot ?? "battle"]
  } · ${index + 1}/${questions.length}`;

  if (step === "question") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label="De recuperat" icon={<History size={15} />} onClose={goHome} />
        <div className="flex flex-1 flex-col gap-5">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-primary">{progressLabel}</p>
          <h1 className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">
            {current.question.prompt}
          </h1>
          <div className="flex flex-col gap-2">
            {current.options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => setSelected(opt)}
                className={`w-full rounded-2xl border px-4 py-4 text-left text-[15px] transition-all duration-150 active:scale-[0.99] ${
                  selected?.id === opt.id
                    ? "border-primary bg-accent text-foreground"
                    : "border-border bg-card text-foreground hover:border-disabled"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="mt-auto pt-4">
            {submitError && (
              <p className="mb-3 text-center text-[13px] text-destructive">
                Nu am putut trimite răspunsul. Verifică-ți conexiunea și încearcă din nou.
              </p>
            )}
            <Btn onClick={handleSubmit} disabled={!selected || submitting}>
              {submitting ? "..." : submitError ? "ÎNCEARCĂ DIN NOU" : "RĂSPUNDE"}
            </Btn>
          </div>
        </div>
      </main>
    );
  }

  // step === "reveal" -- reveal, Extra, Explore links and the "ask
  // others" line all show together, immediately, no extra tap.
  const isCorrect = !!response?.is_correct;
  const message = isCorrect ? current.question.correct_reveal_message : current.question.alternative_reveal_message;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
      <FlowHeader label="De recuperat" icon={<History size={15} />} onClose={goHome} />
      <div className="flex flex-1 flex-col gap-5">
        {wasConflict && (
          <p className="rounded-xl bg-secondary px-4 py-3 text-[13px] leading-relaxed text-secondary-foreground">
            Răspunsul tău fusese deja înregistrat cu o altă opțiune înainte să încerci din nou -- rămâne cel
            înregistrat prima dată, cel de mai jos.
          </p>
        )}
        <div>
          <p className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-primary">{progressLabel}</p>
          <div
            className={`mb-5 flex h-10 w-10 items-center justify-center rounded-full ${isCorrect ? "bg-accent" : "bg-secondary"}`}
          >
            {isCorrect ? <Check size={18} className="text-primary" /> : <X size={18} className="text-muted-foreground" />}
          </div>
          <p className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">
            {message ?? (isCorrect ? "Corect" : "Nu chiar 🙂")}
          </p>
        </div>

        {current.question.common_core && (
          <p className="text-[15px] leading-relaxed text-secondary-foreground">{current.question.common_core}</p>
        )}

        {current.question.one_thing && (
          <div className="border-l-2 border-primary py-1 pl-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">The One Thing</p>
            <p className="text-[15px] font-medium leading-snug text-foreground">{current.question.one_thing}</p>
          </div>
        )}

        {extra && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
              {extra.extra_type ? EXTRA_TYPE_LABEL[extra.extra_type] : "EXTRA"}
            </span>
            <p className="text-[15px] leading-relaxed text-foreground">{extra.description ?? extra.title}</p>
          </div>
        )}

        {extraFailed && (
          <p className="text-[13px] text-muted-foreground">
            Nu am putut încărca Extra.{" "}
            <button onClick={retryExtra} className="font-semibold text-primary underline">
              Încearcă din nou
            </button>
          </p>
        )}

        {current.exploreLinks.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] font-medium text-disabled">🐇 Vrei să afli mai mult?</p>
            {current.exploreLinks.map((link) => (
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

        {extra && (
          <p className="text-[13px] leading-relaxed text-disabled">
            Ceilalți au descoperit ceva puțin diferit.
            <br />
            Întreabă-i ce au primit. 👋
          </p>
        )}

        <div className="mt-auto pt-4">
          <Btn onClick={handleAdvance}>
            {index + 1 >= questions.length ? "GATA" : "URMĂTOAREA ÎNTREBARE"}
          </Btn>
        </div>
      </div>
    </main>
  );
}
