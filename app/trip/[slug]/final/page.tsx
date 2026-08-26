"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripBySlug, type Trip } from "@/lib/trip";
import { listProfilesForDevice, type Participant } from "@/lib/participant";
import {
  getFinalBattle,
  isBattleCompleted,
  getTripLeaderboard,
  type BattleContent,
} from "@/lib/battle";
import { BattleFlow } from "@/components/BattleFlow";
import { FeedbackForm } from "@/components/FeedbackForm";
import { trackEvent } from "@/lib/analytics";
import type { BattleTeam } from "@/lib/supabase/types";
import { Centered } from "@/components/ui";

type Step = "loading" | "error" | "not-joined" | "unavailable" | "battle" | "feedback" | "thanks";

function feedbackStorageKey(tripId: string) {
  return `roam_feedback_submitted_${tripId}`;
}

export default function FinalBattlePage() {
  const { slug } = useParams<{ slug: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [content, setContent] = useState<BattleContent | null>(null);
  const [adult, setAdult] = useState<Participant | null>(null);
  const [tripScore, setTripScore] = useState<Record<BattleTeam, number>>({ adults: 0, kids: 0 });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const t = await getTripBySlug(slug);
        if (cancelled || !t) return;
        setTrip(t);

        const profiles = await listProfilesForDevice(t.id);
        if (cancelled) return;
        if (profiles.length === 0) {
          setStep("not-joined");
          return;
        }
        setAdult(profiles.find((p) => p.role === "adult") ?? profiles[0]);

        const battle = await getFinalBattle(t.id);
        if (cancelled) return;
        if (!battle || battle.questions.length === 0) {
          setStep("unavailable");
          return;
        }
        setContent(battle);

        const played = await isBattleCompleted(battle.battle.id);
        if (cancelled) return;

        if (!played) {
          await trackEvent(t.id, "final_battle_started", undefined, { battle_id: battle.battle.id });
          setStep("battle");
          return;
        }

        const alreadyGaveFeedback =
          typeof window !== "undefined" &&
          window.localStorage.getItem(feedbackStorageKey(t.id)) === "true";

        if (alreadyGaveFeedback) {
          const leaderboard = await getTripLeaderboard(t.id);
          if (cancelled) return;
          setTripScore(leaderboard);
          setStep("thanks");
        } else {
          setStep("feedback");
        }
      } catch {
        if (!cancelled) setStep("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function handleBattleFinished() {
    if (!trip) return;
    const alreadyGaveFeedback =
      window.localStorage.getItem(feedbackStorageKey(trip.id)) === "true";
    if (alreadyGaveFeedback) {
      const leaderboard = await getTripLeaderboard(trip.id);
      setTripScore(leaderboard);
      setStep("thanks");
    } else {
      setStep("feedback");
    }
  }

  function handleFeedbackSubmitted() {
    if (!trip) return;
    window.localStorage.setItem(feedbackStorageKey(trip.id), "true");
    getTripLeaderboard(trip.id).then(setTripScore);
    setStep("thanks");
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
        <p>Final Battle nu e încă disponibil.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  if (step === "battle" && trip && content) {
    return (
      <BattleFlow
        content={content}
        tripId={trip.id}
        slug={slug}
        isFinal
        onFinished={handleBattleFinished}
      />
    );
  }

  if (step === "feedback" && trip) {
    return (
      <FeedbackForm
        tripId={trip.id}
        participantId={adult?.id ?? null}
        onSubmitted={handleFeedbackSubmitted}
      />
    );
  }

  if (step === "thanks") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <h1 className="text-[26px] font-semibold text-foreground">Mulțumim! 🙌</h1>
        <p className="text-[17px] text-secondary-foreground">
          {trip?.name} — scorul final:
          <br />
          PĂRINȚI {tripScore.adults} — COPII {tripScore.kids}
        </p>
        <Link
          href={`/trip/${slug}`}
          className="mt-4 w-full max-w-xs rounded-2xl bg-primary py-[14px] text-[15px] font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
        >
          ÎNAPOI ACASĂ
        </Link>
      </main>
    );
  }

  return <Centered>Se încarcă...</Centered>;
}
