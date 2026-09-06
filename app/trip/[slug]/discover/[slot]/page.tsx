"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Sun, Utensils, Check, X, ExternalLink } from "lucide-react";
import { getTripTemporalState, getTripTimezone } from "@/lib/trip";
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
  // R3 (2026-09-05 review, closure batch): record_answer()'s 3-way status
  // ("accepted" | "already_recorded" | "conflict") used to collapse into
  // the same reveal screen regardless of which one came back -- a retry
  // that landed on a DIFFERENT option than the one already on record
  // (status "conflict") looked identical to a normal fresh accept, even
  // though myResponse below is actually the ORIGINAL answer, not the one
  // just clicked. True for "accepted"/"already_recorded" (same answer
  // either way) but misleading for "conflict".
  const [wasConflict, setWasConflict] = useState(false);
  // R4 (2026-09-06 batch): getOrAssignExtra can fail independently of the
  // answer it's attached to -- a response the server already accepted
  // must still show (setStep("reveal") below no longer waits on this),
  // and a failure here gets its own small retry instead of either
  // silently vanishing or (the previous bug) taking the whole page down
  // through the outer load() effect's catch, which used to turn a pure
  // Extra failure into "could not load the question" for an
  // already-answered participant reopening it.
  const [extraFailed, setExtraFailed] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [closedInfo, setClosedInfo] = useState<SlotAvailability | null>(null);
  // R6: set instead of closedInfo when the trip ITSELF isn't active
  // (scheduled or ended) -- a direct navigation here outside the trip's
  // own run, not just outside today's slot window. Takes priority over
  // closedInfo's "before/after" messaging, which only makes sense once
  // the trip is actually under way.
  const [tripNotActive, setTripNotActive] = useState<"scheduled" | "ended" | null>(null);

  // R2 (2026-09-05 review, closure batch): read from a submission's async
  // continuation to detect whether the active profile has since changed --
  // a plain closure over `activeProfile` only ever sees the value frozen
  // at the moment that continuation's outer function was created, not a
  // live one. Kept in sync on every render (not just via an effect) so a
  // switch that happens while a request is already in flight is visible
  // the instant the request resolves, not one render late.
  const activeProfileIdRef = useRef<string | null>(activeProfile?.id ?? null);
  activeProfileIdRef.current = activeProfile?.id ?? null;

  useEffect(() => {
    if (!trip || !profiles || profiles.length === 0 || !activeProfile) return;

    let cancelled = false;

    // A profile switch re-runs this effect (activeProfile dependency
    // below) -- reset every piece of UI state tied to the PREVIOUS
    // profile's in-progress answer before loading the new profile's own
    // state, so an unsubmitted selection (or a stale error banner) never
    // survives into the newly active profile's screen.
    setSelectedOption(null);
    setSubmitError(false);
    setMyResponse(null);
    setExtra(null);
    setExtraFailed(false);
    setWasConflict(false);
    setTripNotActive(null);

    async function load() {
      try {
        // R6: the trip's own lifecycle state, in its own timezone --
        // computed once per load, same source record_answer() itself
        // uses server-side (getTripTemporalState).
        const temporal = getTripTemporalState(trip!, new Date());
        const c = await getDiscoverQuestion(trip!.id, temporal.day, discoverSlot);
        if (cancelled) return;
        if (!c) {
          setStep("unavailable");
          return;
        }
        setContent(c);
        // Fire-and-forget: trackEvent never rejects (src/lib/analytics.ts),
        // and a slow/unavailable analytics endpoint must never delay
        // showing the question.
        void trackEvent(trip!.id, "question_opened", undefined, { question_id: c.question.id, slot: discoverSlot });
        await selectProfile(c, temporal.status);
      } catch {
        if (!cancelled) setStep("error");
      }
    }

    // Re-runs (via the activeProfile dependency below) every time the
    // active profile changes, even mid-session -- not just this page's
    // own reveal-vs-question state, but the identity handleSubmitAnswer
    // below will submit as, since activeProfile itself is read fresh
    // from the hook on every render, not captured into local state here.
    async function selectProfile(c: DiscoverQuestion, tripStatus: "scheduled" | "active" | "ended") {
      const existing = await getMyResponse(activeProfile!.id, c.question.id);
      if (cancelled) return;
      if (existing) {
        setMyResponse(existing);
        setStep("reveal");
        // Own try/catch, deliberately outside load()'s: an Extra failure
        // must not be treated as "the question failed to load" for a
        // response the server has already accepted (see extraFailed
        // above).
        try {
          const assignedExtra = await getOrAssignExtra(activeProfile!.id, activeProfile!.role, c.question.id);
          if (cancelled) return;
          setExtra(assignedExtra);
        } catch (err) {
          console.error("getOrAssignExtra failed", err);
          if (!cancelled) setExtraFailed(true);
        }
        return;
      }

      // R6: a direct navigation here while the trip itself isn't active
      // (scheduled or ended) never gets as far as a slot-window check --
      // record_answer() would reject a fresh answer either way, so this
      // is the same "not right now" outcome the server enforces, just
      // surfaced before a pointless round trip.
      if (tripStatus !== "active") {
        setTripNotActive(tripStatus);
        setStep("closed");
        return;
      }

      // Already-answered participants can always review (above); a fresh
      // attempt is only allowed inside this slot's time window.
      const availability = getSlotAvailability(discoverSlot, getTripTimezone(trip!));
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
    // Captured once, at click time -- this is WHO the request is actually
    // submitted as (unaffected by any later switch) and the identity every
    // later state update below must still match before it's allowed to
    // touch the screen.
    const submittedProfileId = activeProfile.id;
    const submittedProfileRole = activeProfile.role;
    const tripId = trip.id;
    const questionId = content.question.id;
    setSubmitting(true);
    setSubmitError(false);
    try {
      const result = await submitAnswer(submittedProfileId, questionId, selectedOption.id);
      if (activeProfileIdRef.current !== submittedProfileId) {
        // The active profile changed while this request was in flight --
        // submittedProfileId's answer is already safely recorded
        // server-side (record_answer is idempotent), but it must never be
        // painted onto whichever OTHER profile's screen is showing now.
        // That profile's own effect run (activeProfile dependency above)
        // will fetch its own state fresh.
        return;
      }
      setMyResponse(result.response);
      setWasConflict(result.status === "conflict");
      setStep("reveal");

      getOrAssignExtra(submittedProfileId, submittedProfileRole, questionId)
        .then((assignedExtra) => {
          if (activeProfileIdRef.current !== submittedProfileId) return;
          setExtra(assignedExtra);
          if (assignedExtra) {
            void trackEvent(tripId, "extra_viewed", submittedProfileId, { extra_id: assignedExtra.id });
          }
        })
        .catch((err) => {
          console.error("getOrAssignExtra failed", err);
          if (activeProfileIdRef.current === submittedProfileId) setExtraFailed(true);
        });

      void trackEvent(tripId, "answer_submitted", submittedProfileId, {
        question_id: questionId,
        response_time_ms: Date.now() - openedAt,
      });
      if (result.response.is_correct) {
        void trackEvent(tripId, "answer_correct", submittedProfileId, { question_id: questionId });
      }
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

  function handleExploreClick(linkId: string) {
    if (!trip) return;
    // Fire-and-forget: the <a target="_blank"> below navigates natively,
    // unaffected by how long this takes -- but nothing here should ever
    // await analytics regardless.
    void trackEvent(trip.id, "explore_clicked", activeProfile?.id, { explore_link_id: linkId });
  }

  function retryExtra() {
    if (!content || !activeProfile) return;
    const profileId = activeProfile.id;
    setExtraFailed(false);
    getOrAssignExtra(profileId, activeProfile.role, content.question.id)
      .then((assignedExtra) => {
        if (activeProfileIdRef.current !== profileId) return;
        setExtra(assignedExtra);
      })
      .catch((err) => {
        console.error("getOrAssignExtra retry failed", err);
        if (activeProfileIdRef.current === profileId) setExtraFailed(true);
      });
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
        {tripNotActive === "scheduled" ? (
          <p>Călătoria nu a început încă.</p>
        ) : tripNotActive === "ended" ? (
          <p>Călătoria s-a încheiat.</p>
        ) : closedInfo?.status === "before" ? (
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
          {wasConflict && (
            <p className="rounded-xl bg-secondary px-4 py-3 text-[13px] leading-relaxed text-secondary-foreground">
              Răspunsul tău fusese deja înregistrat cu o altă opțiune înainte să încerci din nou -- rămâne cel
              înregistrat prima dată, cel de mai jos.
            </p>
          )}
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

          {extraFailed && (
            <p className="text-[13px] text-muted-foreground">
              Nu am putut încărca Extra.{" "}
              <button onClick={retryExtra} className="font-semibold text-primary underline">
                Încearcă din nou
              </button>
            </p>
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
