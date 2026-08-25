"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripBySlug, currentTripDay, type Trip } from "@/lib/trip";
import { listProfilesForDevice, type Participant } from "@/lib/participant";
import {
  getDiscoverQuestion,
  getMyResponse,
  submitResponse,
  getOrAssignExtra,
  type DiscoverQuestion,
  type AnswerOption,
  type Extra,
  type Response,
} from "@/lib/discover";
import { trackEvent } from "@/lib/analytics";
import type { QuestionSlot } from "@/lib/supabase/types";
import { getSlotAvailability, type SlotAvailability } from "@/lib/schedule";

type Step =
  | "loading"
  | "select-profile"
  | "question"
  | "reveal"
  | "extra"
  | "unavailable"
  | "closed"
  | "not-joined"
  | "error";

const SLOT_LABEL: Record<QuestionSlot, string> = { morning: "Dimineață", lunch: "Prânz" };
const EXTRA_TYPE_LABEL: Record<string, string> = {
  know: "ȘTIAI CĂ",
  think: "GÂNDEȘTE-TE",
  connect: "CONEXIUNE",
  ask: "ÎNTREABĂ",
  explore: "EXPLOREAZĂ",
};

export default function DiscoverPage() {
  const { slug, slot } = useParams<{ slug: string; slot: string }>();
  const discoverSlot = slot as QuestionSlot;

  const [step, setStep] = useState<Step>("loading");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [profiles, setProfiles] = useState<Participant[]>([]);
  const [activeProfile, setActiveProfile] = useState<Participant | null>(null);
  const [content, setContent] = useState<DiscoverQuestion | null>(null);
  const [selectedOption, setSelectedOption] = useState<AnswerOption | null>(null);
  const [myResponse, setMyResponse] = useState<Response | null>(null);
  const [extra, setExtra] = useState<Extra | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const [closedInfo, setClosedInfo] = useState<SlotAvailability | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const t = await getTripBySlug(slug);
        if (cancelled || !t) return;
        setTrip(t);

        const list = await listProfilesForDevice(t.id);
        if (cancelled) return;
        if (list.length === 0) {
          setStep("not-joined");
          return;
        }
        setProfiles(list);

        const c = await getDiscoverQuestion(t.id, currentTripDay(t), discoverSlot);
        if (cancelled) return;
        if (!c) {
          setStep("unavailable");
          return;
        }
        setContent(c);
        await trackEvent(t.id, "question_opened", undefined, { question_id: c.question.id, slot: discoverSlot });
        setStep("select-profile");
      } catch {
        if (!cancelled) setStep("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, discoverSlot]);

  const handleSelectProfile = useCallback(
    async (profile: Participant) => {
      if (!trip || !content) return;
      setActiveProfile(profile);
      const existing = await getMyResponse(profile.id, content.question.id);
      if (existing) {
        setMyResponse(existing);
        const assignedExtra = await getOrAssignExtra(profile.id, profile.role, content.question.id);
        setExtra(assignedExtra);
        setStep("extra");
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
    },
    [trip, content, discoverSlot],
  );

  // Skip the "Cine răspunde?" screen when there's only one profile on
  // this device (spec section 8, Screen 1).
  useEffect(() => {
    if (step === "select-profile" && profiles.length === 1) {
      handleSelectProfile(profiles[0]);
    }
  }, [step, profiles, handleSelectProfile]);

  async function handleSubmitAnswer() {
    if (!trip || !content || !activeProfile || !selectedOption) return;
    setSubmitting(true);
    try {
      const response = await submitResponse(activeProfile.id, content.question.id, selectedOption);
      setMyResponse(response);
      await trackEvent(trip.id, "answer_submitted", activeProfile.id, {
        question_id: content.question.id,
        response_time_ms: Date.now() - openedAt,
      });
      if (response.is_correct) {
        await trackEvent(trip.id, "answer_correct", activeProfile.id, { question_id: content.question.id });
      }
      setStep("reveal");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleContinueToExtra() {
    if (!trip || !content || !activeProfile) return;
    const assignedExtra = await getOrAssignExtra(activeProfile.id, activeProfile.role, content.question.id);
    setExtra(assignedExtra);
    if (assignedExtra) {
      await trackEvent(trip.id, "extra_viewed", activeProfile.id, { extra_id: assignedExtra.id });
    }
    setStep("extra");
  }

  async function handleExploreClick(linkId: string) {
    if (!trip) return;
    await trackEvent(trip.id, "explore_clicked", activeProfile?.id, { explore_link_id: linkId });
  }

  if (step === "loading") return <Centered>Se încarcă...</Centered>;
  if (step === "error") {
    return (
      <Centered>
        <p>Nu am putut încărca datele. Verifică-ți conexiunea.</p>
        <button onClick={() => window.location.reload()} className="mt-4 underline">
          Încearcă din nou
        </button>
      </Centered>
    );
  }
  if (step === "not-joined") {
    return (
      <Centered>
        <p>Trebuie să te alături călătoriei mai întâi.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }
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

  if (step === "select-profile" && profiles.length === 1) {
    // The effect above auto-advances past this in a single-profile trip;
    // avoid flashing the picker for a screen no one will see.
    return <Centered>Se încarcă...</Centered>;
  }

  if (step === "select-profile") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
        <h1 className="text-center text-2xl font-semibold">Cine răspunde?</h1>
        <div className="flex flex-col gap-3">
          {profiles.map((p) => (
            <button
              key={p.id}
              onClick={() => handleSelectProfile(p)}
              className="rounded-xl border border-slate-300 px-4 py-4 text-lg font-medium hover:bg-slate-50"
            >
              {p.display_name}
            </button>
          ))}
        </div>
      </main>
    );
  }

  if (!content) return <Centered>Se încarcă...</Centered>;

  if (step === "question") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
        <p className="text-center text-sm font-medium uppercase tracking-wide text-slate-500">
          {SLOT_LABEL[discoverSlot]}
        </p>
        <h1 className="text-xl font-semibold leading-snug">{content.question.prompt}</h1>
        <div className="flex flex-col gap-3">
          {content.options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSelectedOption(opt)}
              className={`rounded-xl border px-4 py-3 text-left text-lg ${
                selectedOption?.id === opt.id
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleSubmitAnswer}
          disabled={!selectedOption || submitting}
          className="mt-auto rounded-xl bg-slate-900 px-4 py-3 text-lg font-semibold text-white disabled:opacity-40"
        >
          {submitting ? "..." : "RĂSPUNDE"}
        </button>
      </main>
    );
  }

  if (step === "reveal") {
    const isCorrect = !!myResponse?.is_correct;
    const message = isCorrect
      ? content.question.correct_reveal_message
      : content.question.alternative_reveal_message;
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
        <p className="text-center text-2xl">{message ?? (isCorrect ? "✓ Corect" : "Nu chiar 🙂")}</p>

        {content.question.common_core && (
          <p className="text-lg leading-relaxed text-slate-700">{content.question.common_core}</p>
        )}

        {content.question.one_thing && (
          <div className="rounded-2xl bg-slate-100 px-5 py-4 text-lg font-medium">
            {content.question.one_thing}
          </div>
        )}

        <button
          onClick={handleContinueToExtra}
          className="mt-auto rounded-xl bg-slate-900 px-4 py-3 text-lg font-semibold text-white"
        >
          MERGI MAI DEPARTE
        </button>
      </main>
    );
  }

  // step === "extra"
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      {extra ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {extra.extra_type ? EXTRA_TYPE_LABEL[extra.extra_type] : "EXTRA"}
          </span>
          <p className="text-lg leading-relaxed">{extra.description ?? extra.title}</p>
        </div>
      ) : (
        <p className="text-slate-500">Nu mai sunt Extra-uri disponibile azi.</p>
      )}

      {content.exploreLinks.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="font-medium">🐇 Vrei să afli mai mult?</p>
          {content.exploreLinks.map((link) => (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => handleExploreClick(link.id)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-slate-700 underline"
            >
              {link.title}
            </a>
          ))}
        </div>
      )}

      <p className="text-center text-slate-600">
        Ceilalți au descoperit ceva puțin diferit.
        <br />
        Întreabă-i ce au primit. 👋
      </p>

      <Link
        href={`/trip/${slug}`}
        className="mt-auto rounded-xl bg-slate-900 px-4 py-3 text-center text-lg font-semibold text-white"
      >
        ÎNAPOI ACASĂ
      </Link>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-slate-600">
      {children}
    </main>
  );
}
