"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Sun, Utensils, Check, X, ExternalLink } from "lucide-react";
import { currentTripDay } from "@/lib/trip";
import {
  getDiscoverQuestion,
  getMyResponse,
  submitAnswer,
  getOrAssignExtra,
  type DiscoverQuestion,
  type AnswerOption,
  type Extra,
  type Response,
} from "@/lib/discover";
import { trackEvent } from "@/lib/analytics";
import type { QuestionSlot } from "@/lib/supabase/types";
import { getSlotAvailability, type SlotAvailability } from "@/lib/schedule";
import { Btn, FlowHeader, OptionButton, Centered } from "@/components/ui";
import { SLOT_LABEL, EXTRA_TYPE_LABEL } from "@/lib/constants";
import { useTrip, useProfiles, useActiveProfile } from "@/lib/hooks";

type Step = "loading" | "question" | "reveal" | "unavailable" | "closed" | "error";

const SLOT_ICON: Record<QuestionSlot, typeof Sun> = { morning: Sun, lunch: Utensils };

export default function DiscoverPage() {
  const { slug, slot } = useParams<{ slug: string; slot: string }>();
  const router = useRouter();
  const discoverSlot = slot as QuestionSlot;
  const { data: trip, error: tripError } = useTrip(slug);
  const { data: profiles, error: profilesError } = useProfiles(trip?.id);
  // Reactive to ProfileMenu's "Schimbă profilul" (hypothesis D's sibling
  // issue, 2026-09-05 review) -- previously resolved once, inside the
  // effect below, from a plain getStoredActiveProfileId() snapshot at
  // the moment this page's question first loaded. Switching profile
  // while the question was already open never updated that snapshot, so
  // the submission below still went out under whoever was active at
  // load time, even though ProfileMenu's own avatar had already moved
  // on to someone else.
  const activeProfile = useActiveProfile(trip?.id, profiles);

  const [step, setStep] = useState<Step>("loading");
  const [content, setContent] = useState<DiscoverQuestion | null>(null);
  const [selectedOption, setSelectedOption] = useState<AnswerOption | null>(null);
  const [myResponse, setMyResponse] = useState<Response | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [closedInfo, setClosedInfo] = useState<SlotAvailability | null>(null);

  useEffect(() => {
    if (!trip || !profiles || profiles.length === 0 || !activeProfile) return;

    let cancelled = false;

    async function load() {
      try {
        const c = await getDiscoverQuestion(trip!.id, currentTripDay(trip!), discoverSlot);
        if (cancelled) return;
        if (!c) {
          setStep("unavailable");
          return;
        }
        setContent(c);
        await trackEvent(trip!.id, "question_opened", undefined, { question_id: c.question.id, slot: discoverSlot });
        await selectProfile(c);
      } catch {
        if (!cancelled) setStep("error");
      }
    }

    // Re-runs (via the activeProfile dependency below) every time the
    // active profile changes, even mid-session -- not just this page's
    // own reveal-vs-question state, but the identity handleSubmitAnswer
    // below will submit as, since activeProfile itself is read fresh
    // from the hook on every render, not captured into local state here.
    async function selectProfile(c: DiscoverQuestion) {
      const existing = await getMyResponse(activeProfile!.id, c.question.id);
      if (cancelled) return;
      if (existing) {
        setMyResponse(existing);
        const assignedExtra = await getOrAssignExtra(activeProfile!.id, activeProfile!.role, c.question.id);
        if (cancelled) return;
        setExtra(assignedExtra);
        setStep("reveal");
        return;
      }

      // Already-answered participants can always review (above); a fresh
      // attempt is only allowed inside this slot's time window.
      const availability = getSlotAvailability(discoverSlot);
      if (availability.status !== "open") {
        setClosedInfo(availability);
        setStep("closed");
      } else {
        setStep("question");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [trip, profiles, discoverSlot, activeProfile]);

  // R3 (20260906140000_record_answer_authoritative.sql): submitAnswer is
  // idempotent on (participantId, questionId) -- a retry after a lost
  // confirmation (network drop after the server already committed) is
  // just calling this again with the same selectedOption, which is
  // exactly what the "Încearcă din nou" button below does, since
  // selectedOption is never cleared on failure. It safely returns the
  // already-saved response instead of erroring or double-submitting.
  //
  // Extra assignment and analytics are fire-and-forget once the answer
  // itself is accepted: a failure in either must never hide or
  // invalidate an answer the server already recorded, so they're never
  // awaited as part of the submission's own success/failure path.
  async function handleSubmitAnswer() {
    if (!trip || !content || !activeProfile || !selectedOption) return;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const result = await submitAnswer(activeProfile.id, content.question.id, selectedOption.id);
      setMyResponse(result.response);
      setStep("reveal");

      getOrAssignExtra(activeProfile.id, activeProfile.role, content.question.id)
        .then((assignedExtra) => {
          setExtra(assignedExtra);
          if (assignedExtra) {
            void trackEvent(trip.id, "extra_viewed", activeProfile.id, { extra_id: assignedExtra.id });
          }
        })
        .catch((err) => console.error("getOrAssignExtra failed", err));

      void trackEvent(trip.id, "answer_submitted", activeProfile.id, {
        question_id: content.question.id,
        response_time_ms: Date.now() - openedAt,
      });
      if (result.response.is_correct) {
        void trackEvent(trip.id, "answer_correct", activeProfile.id, { question_id: content.question.id });
      }
    } catch (err) {
      console.error("submitAnswer failed", err);
      setSubmitError(true);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExploreClick(linkId: string) {
    if (!trip) return;
    await trackEvent(trip.id, "explore_clicked", activeProfile?.id, { explore_link_id: linkId });
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
  if (step === "unavailable") {
    return (
      <Centered>
        <p>{SLOT_LABEL[discoverSlot] ?? "Acest moment"} nu e încă disponibil.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }
  if (step === "closed") {
    return (
      <Centered>
        {closedInfo?.status === "before" ? (
          <p>{SLOT_LABEL[discoverSlot]} devine disponibil la {closedInfo.opensAt}.</p>
        ) : (
          <p>{SLOT_LABEL[discoverSlot]} s-a încheiat pentru azi.</p>
        )}
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  const SlotIcon = SLOT_ICON[discoverSlot] ?? Sun;

  if (!content) return <Centered>Se încarcă...</Centered>;

  if (step === "question") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label={SLOT_LABEL[discoverSlot]} icon={<SlotIcon size={15} />} onClose={goHome} />
        <div className="flex flex-1 flex-col gap-5">
          <h1 className="text-[22px] font-semibold leading-snug tracking-tight text-foreground">
            {content.question.prompt}
          </h1>
          <div className="flex flex-col gap-2">
            {content.options.map((opt) => (
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
            <Btn onClick={handleSubmitAnswer} disabled={!selectedOption || submitting}>
              {submitting ? "..." : submitError ? "ÎNCEARCĂ DIN NOU" : "RĂSPUNDE"}
            </Btn>
          </div>
        </div>
      </main>
    );
  }

  if (step === "reveal") {
    const isCorrect = !!myResponse?.is_correct;
    const message = isCorrect
      ? content.question.correct_reveal_message
      : content.question.alternative_reveal_message;
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label={SLOT_LABEL[discoverSlot]} icon={<SlotIcon size={15} />} onClose={goHome} />
        <div className="flex flex-1 flex-col gap-6">
          <div>
            <div className={`mb-5 flex h-10 w-10 items-center justify-center rounded-full ${isCorrect ? "bg-accent" : "bg-secondary"}`}>
              {isCorrect ? <Check size={18} className="text-primary" /> : <X size={18} className="text-muted-foreground" />}
            </div>
            <p className="text-[24px] font-semibold leading-snug tracking-tight text-foreground">
              {message ?? (isCorrect ? "Corect" : "Nu chiar 🙂")}
            </p>
          </div>

          {content.question.common_core && (
            <p className="text-[15px] leading-relaxed text-secondary-foreground">{content.question.common_core}</p>
          )}

          {content.question.one_thing && (
            <div className="border-l-2 border-primary py-1 pl-4">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">The One Thing</p>
              <p className="text-[15px] font-medium leading-snug text-foreground">{content.question.one_thing}</p>
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

          {content.exploreLinks.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-[12px] font-medium text-disabled">🐇 Vrei să afli mai mult?</p>
              {content.exploreLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => handleExploreClick(link.id)}
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
            <Btn onClick={goHome}>ÎNAPOI ACASĂ</Btn>
          </div>
        </div>
      </main>
    );
  }

  return null;
}
