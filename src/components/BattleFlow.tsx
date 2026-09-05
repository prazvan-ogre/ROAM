"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Moon, Check, X, ExternalLink } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import type { BattleContent, BattleWindowStatus } from "@/lib/battle";
import { getBattleWindowStatus, getBattleResult } from "@/lib/battle";
import { submitAnswer, getOrAssignExtra, type AnswerOption, type Extra, type Response } from "@/lib/discover";
import { trackEvent } from "@/lib/analytics";
import { getStoredActiveProfileId, type Participant } from "@/lib/participant";
import type { BattleTeam } from "@/lib/supabase/types";
import { getSlotAvailability, type SlotAvailability } from "@/lib/schedule";
import { Btn, FlowHeader, OptionButton } from "@/components/ui";
import { EXTRA_TYPE_LABEL } from "@/lib/constants";

type Step = "intro" | "select-profile" | "closed" | "question" | "reveal" | "done";

// Product owner spec: every participant answers individually now
// (select their own profile, then work through this evening's Battle
// questions one after another -- same pass-the-phone pattern as
// Discover), instead of one shared submission per team via a
// "controller" device. The team result stays hidden for 15 minutes from
// the first individual answer (getBattleWindowStatus) so nobody sees a
// partial score while others are still deciding.
export function BattleFlow({
  content,
  tripId,
  slug,
  isFinal,
  profiles,
  onFinished,
}: {
  content: BattleContent;
  tripId: string;
  slug: string;
  isFinal: boolean;
  profiles: Participant[];
  onFinished?: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("intro");
  const [activeProfile, setActiveProfile] = useState<Participant | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<AnswerOption | null>(null);
  const [myResponse, setMyResponse] = useState<Response | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [correctOptionId, setCorrectOptionId] = useState<string | null>(null);
  const [passCorrect, setPassCorrect] = useState(0);
  const [passAnswered, setPassAnswered] = useState(0);
  const [windowStatus, setWindowStatus] = useState<BattleWindowStatus | null>(null);
  const [result, setResult] = useState<Record<BattleTeam, number>>({ adults: 0, kids: 0 });
  const [closedInfo, setClosedInfo] = useState<SlotAvailability | null>(null);

  const current = content.questions[questionIndex];

  function goHome() {
    router.push(`/trip/${slug}`);
  }

  async function handleStart() {
    await trackEvent(tripId, "battle_opened", undefined, { battle_id: content.battle.id });
    // Product owner request: use the profile picked top-right (the
    // global ProfileMenu, src/components/ProfileMenu.tsx) instead of
    // asking "Cine răspunde?" here -- same resolution it uses (stored
    // active profile, falling back to this device's first one). The
    // picker itself stays for "Alt profil răspunde" below, since Battle
    // deliberately passes the phone between everyone on the device.
    const stored = getStoredActiveProfileId(tripId);
    const resolved = profiles.find((p) => p.id === stored) ?? profiles[0];
    await handleSelectProfile(resolved);
  }

  async function handleSelectProfile(profile: Participant) {
    setActiveProfile(profile);
    setPassCorrect(0);
    setPassAnswered(0);

    const questionIds = content.questions.map((q) => q.question.id);
    const { data, error } = await supabase
      .from("responses")
      .select("*")
      .eq("participant_id", profile.id)
      .in("question_id", questionIds);
    if (error) throw error;
    const answered = new Map((data ?? []).map((r) => [r.question_id, r]));

    const firstUnansweredIndex = content.questions.findIndex((q) => !answered.has(q.question.id));
    if (firstUnansweredIndex === -1) {
      await goToDone();
      return;
    }

    // Already-answered participants can always review (above); a fresh
    // attempt on the daily Battle is only allowed inside its time
    // window -- the Final Battle has no such window (it's gated to the
    // trip's last day instead, by the /final page).
    if (!isFinal) {
      const availability = getSlotAvailability("battle");
      if (availability.status !== "open") {
        setClosedInfo(availability);
        setStep("closed");
        return;
      }
    }

    setQuestionIndex(firstUnansweredIndex);
    setSelectedOption(null);
    setMyResponse(null);
    setExtra(null);
    setCorrectOptionId(null);
    setSubmitError(false);
    setStep("question");
  }

  // R3 (20260906140000_record_answer_authoritative.sql): submitAnswer
  // derives correctness/score/team/team-window-eligibility server-side --
  // there is no team/isFinal/score to pass anymore. Idempotent on
  // (participantId, questionId), so the "ÎNCEARCĂ DIN NOU" retry below
  // (selectedOption is never cleared on failure) safely recovers an
  // already-accepted answer instead of erroring or double-submitting.
  // Extra assignment and analytics are fire-and-forget: they must never
  // hide or invalidate an answer the server already recorded.
  async function handleSubmit() {
    if (!activeProfile || !current || !selectedOption) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const result = await submitAnswer(activeProfile.id, current.question.id, selectedOption.id);
      setMyResponse(result.response);
      setCorrectOptionId(result.correctOptionId);
      setPassAnswered((n) => n + 1);
      if (result.response.is_correct) setPassCorrect((n) => n + 1);
      setStep("reveal");

      getOrAssignExtra(activeProfile.id, activeProfile.role, current.question.id)
        .then(setExtra)
        .catch((err) => console.error("getOrAssignExtra failed", err));
      void trackEvent(tripId, "battle_answered", activeProfile.id, {
        battle_id: content.battle.id,
        question_id: current.question.id,
      });
    } catch (err) {
      console.error("submitAnswer failed", err);
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    const nextIndex = questionIndex + 1;
    if (nextIndex >= content.questions.length) {
      // Daily Battle: "GATA" goes straight home (product owner request) --
      // the score stays visible on the Scor page, and this also sidesteps
      // goToDone()'s network calls (getBattleWindowStatus/getBattleResult)
      // failing silently and leaving the button looking unresponsive. The
      // Final Battle keeps going through goToDone() -> "done" -> onFinished
      // (the feedback flow), which "GATA" was never reported broken for.
      if (isFinal) {
        await goToDone();
      } else {
        goHome();
      }
    } else {
      setQuestionIndex(nextIndex);
      setSelectedOption(null);
      setMyResponse(null);
      setExtra(null);
      setCorrectOptionId(null);
      setSubmitError(false);
      setStep("question");
    }
  }

  async function goToDone() {
    // Never let a failed score lookup leave the button looking
    // unresponsive (still reachable here from the review path, and from
    // the Final Battle's own "GATA") -- fall through to the "done" screen
    // regardless, with its safe "not visible yet" default, rather than
    // getting stuck on "reveal".
    try {
      const [w, r] = await Promise.all([
        getBattleWindowStatus(content.battle.id),
        getBattleResult(content.battle.id),
      ]);
      setWindowStatus(w);
      setResult(r);
    } catch (err) {
      console.error("goToDone score lookup failed", err);
    }
    if (isFinal) {
      await trackEvent(tripId, "final_battle_completed", activeProfile?.id, {
        battle_id: content.battle.id,
      });
    }
    setStep("done");
  }

  function handleAnotherProfile() {
    setStep("select-profile");
  }

  if (step === "intro") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label="Battle" icon={<Moon size={15} />} onClose={goHome} />
        <div className="flex flex-1 flex-col gap-6">
          <div>
            <h1 className="mb-3 text-[28px] font-semibold tracking-tight text-foreground">{content.battle.title}</h1>
            <p className="text-[16px] leading-relaxed text-muted-foreground">
              Fiecare răspunde pe rând, de pe același telefon. Rezultatul apare abia după ce răspund toți. 😈
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
            <div className="flex items-center justify-between">
              <div className="flex-1 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                  <span className="text-[20px]">👨‍👩‍👧</span>
                </div>
                <p className="text-[13px] font-semibold text-foreground">Adulți</p>
              </div>
              <div className="text-[20px] font-light text-disabled">vs</div>
              <div className="flex-1 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                  <span className="text-[20px]">🧒</span>
                </div>
                <p className="text-[13px] font-semibold text-foreground">Copii</p>
              </div>
            </div>
          </div>
          <div className="mt-auto pt-4">
            <Btn onClick={handleStart}>HAI LA BATTLE</Btn>
          </div>
        </div>
      </main>
    );
  }

  if (step === "select-profile") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label="Battle" icon={<Moon size={15} />} onClose={goHome} />
        <h1 className="mb-2 text-[26px] font-semibold tracking-tight text-foreground">Cine răspunde?</h1>
        <p className="mb-8 text-[15px] text-muted-foreground">Alege profilul tău.</p>
        <div className="flex flex-col gap-2">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectProfile(p)}
              className="flex items-center gap-4 rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-[0_1px_4px_rgba(0,0,0,0.04)] transition-all active:scale-[0.99] hover:border-primary/40"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent">
                <span className="text-[15px] font-semibold text-primary">{p.display_name[0]}</span>
              </div>
              <div>
                <p className="text-[15px] font-medium text-foreground">{p.display_name}</p>
                <p className="text-[13px] text-muted-foreground">
                  {p.role === "adult" ? "Adult" : p.age ? `Copil · ${p.age} ani` : "Copil"}
                </p>
              </div>
            </button>
          ))}
        </div>
      </main>
    );
  }

  if (step === "closed") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
        {closedInfo?.status === "before" ? (
          <p className="text-muted-foreground">Battle-ul devine disponibil la {closedInfo.opensAt}.</p>
        ) : (
          <p className="text-muted-foreground">Battle-ul s-a încheiat pentru azi.</p>
        )}
        <button onClick={goHome} className="mt-4 underline">
          Înapoi acasă
        </button>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 text-center text-muted-foreground">
        Battle-ul nu are întrebări încă.
      </main>
    );
  }

  if (step === "question") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label="Battle" icon={<Moon size={15} />} onClose={goHome} />
        <div className="flex flex-1 flex-col gap-5">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {activeProfile?.display_name}
              </span>
              <span className="text-[12px] font-medium text-disabled">
                {questionIndex + 1} / {content.questions.length}
              </span>
            </div>
          </div>
          <h2 className="text-[20px] font-semibold leading-snug tracking-tight text-foreground">
            {current.question.prompt}
          </h2>
          <div className="flex flex-col gap-2">
            {current.options.map((opt) => (
              <OptionButton
                key={opt.id}
                label={opt.label}
                selected={selectedOption?.id === opt.id}
                onSelect={() => setSelectedOption(opt)}
              />
            ))}
          </div>
          <div className="mt-auto pt-4">
            {submitError && (
              <p className="mb-3 text-center text-[13px] text-destructive">
                Nu am putut trimite răspunsul. Verifică-ți conexiunea și încearcă din nou.
              </p>
            )}
            <Btn onClick={handleSubmit} disabled={!selectedOption || submitting}>
              {submitting ? "..." : submitError ? "ÎNCEARCĂ DIN NOU" : "RĂSPUNDE"}
            </Btn>
          </div>
        </div>
      </main>
    );
  }

  if (step === "reveal") {
    const isCorrect = !!myResponse?.is_correct;
    const correctOption = current.options.find((o) => o.id === correctOptionId);
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label="Battle" icon={<Moon size={15} />} onClose={goHome} />
        <div className="flex flex-1 flex-col gap-5">
          <div className={`flex h-10 w-10 items-center justify-center rounded-full ${isCorrect ? "bg-accent" : "bg-secondary"}`}>
            {isCorrect ? <Check size={18} className="text-primary" /> : <X size={18} className="text-muted-foreground" />}
          </div>
          <h3 className="text-[18px] font-semibold leading-snug tracking-tight text-foreground">{current.question.prompt}</h3>
          <div className="rounded-xl bg-accent px-4 py-3">
            <p className="text-[13px] font-semibold text-primary">
              Răspuns: {correctOption?.label}
            </p>
          </div>

          {extra && (
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
                {extra.extra_type ? EXTRA_TYPE_LABEL[extra.extra_type] : "EXTRA"}
              </span>
              <p className="text-[15px] leading-relaxed text-foreground">{extra.description ?? extra.title}</p>
            </div>
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
              Ceilalți au primit poate un alt Extra. Întreabă-i ce au aflat ei. 👋
            </p>
          )}

          <div className="mt-auto pt-4">
            <Btn onClick={handleNext}>
              {questionIndex + 1 >= content.questions.length ? "GATA" : "URMĂTOAREA ÎNTREBARE"}
            </Btn>
          </div>
        </div>
      </main>
    );
  }

  // step === "done"
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
      <FlowHeader label="Battle" icon={<Moon size={15} />} onClose={goHome} />
      <div className="flex flex-1 flex-col gap-6 pt-4 text-center">
        <p className="text-[15px] text-muted-foreground">
          {activeProfile?.display_name} · {passCorrect}/{passAnswered} corecte
        </p>

        {windowStatus?.visible ? (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {isFinal ? "Scor final" : "Scorul serii"}
            </p>
            <div className="text-[56px] font-semibold leading-none tracking-tight text-foreground">
              {result.adults} — {result.kids}
            </div>
            <div className="flex justify-center gap-8">
              <span className="text-[13px] text-muted-foreground">Adulți</span>
              <span className="text-[13px] text-muted-foreground">Copii</span>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-[15px] leading-relaxed text-secondary-foreground">
              Rezultatul apare la 15 minute după primul răspuns — cât mai răspund toți.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2 pt-2">
          {profiles.length > 1 && (
            <button onClick={handleAnotherProfile} className="text-[14px] font-semibold text-primary">
              Alt profil răspunde
            </button>
          )}
          <Btn onClick={isFinal ? onFinished : goHome}>{isFinal ? "CONTINUĂ" : "ÎNAPOI ACASĂ"}</Btn>
        </div>
      </div>
    </main>
  );
}
