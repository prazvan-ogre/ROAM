"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { currentTripDay } from "@/lib/trip";
import { getFinalBattle, getTripBattleWinTally, type BattleContent } from "@/lib/battle";
import type { Participant } from "@/lib/participant";
import { BattleFlow } from "@/components/BattleFlow";
import { FeedbackForm } from "@/components/FeedbackForm";
import type { BattleTeam } from "@/lib/supabase/types";
import { Centered } from "@/components/ui";
import { useTrip, useProfiles } from "@/lib/hooks";

type ContentStep = "loading" | "error" | "unavailable" | "battle" | "feedback" | "thanks";

function feedbackStorageKey(tripId: string) {
  return `roam_feedback_submitted_${tripId}`;
}

export default function FinalBattlePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: trip, error: tripError } = useTrip(slug);
  const { data: profiles, error: profilesError } = useProfiles(trip?.id);

  const [contentStep, setContentStep] = useState<ContentStep>("loading");
  const [content, setContent] = useState<BattleContent | null>(null);
  const [tripScore, setTripScore] = useState<Record<BattleTeam, number>>({ adults: 0, kids: 0 });

  const adult: Participant | undefined = profiles?.find((p) => p.role === "adult") ?? profiles?.[0];

  useEffect(() => {
    if (!trip || !profiles || profiles.length === 0) return;

    // The Final Battle recaps every previous day's content, so it's only
    // playable on the trip's actual last day -- everyone plays it live
    // then, whether or not this device already went.
    if (currentTripDay(trip) < trip.duration_days) {
      setContentStep("unavailable");
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const battle = await getFinalBattle(trip!.id);
        if (cancelled) return;
        if (!battle || battle.questions.length === 0) {
          setContentStep("unavailable");
          return;
        }
        setContent(battle);
        setContentStep("battle");
      } catch {
        if (!cancelled) setContentStep("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [trip, profiles]);

  async function handleBattleFinished() {
    if (!trip) return;
    const alreadyGaveFeedback =
      window.localStorage.getItem(feedbackStorageKey(trip.id)) === "true";
    if (alreadyGaveFeedback) {
      const tally = await getTripBattleWinTally(trip.id);
      setTripScore(tally);
      setContentStep("thanks");
    } else {
      setContentStep("feedback");
    }
  }

  function handleFeedbackSubmitted() {
    if (!trip) return;
    window.localStorage.setItem(feedbackStorageKey(trip.id), "true");
    getTripBattleWinTally(trip.id).then(setTripScore);
    setContentStep("thanks");
  }

  if (tripError || profilesError || contentStep === "error") {
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

  if (contentStep === "unavailable") {
    return (
      <Centered>
        <p>Final Battle nu e încă disponibil.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  if (contentStep === "battle" && content) {
    return (
      <BattleFlow
        content={content}
        tripId={trip.id}
        slug={slug}
        isFinal
        profiles={profiles}
        onFinished={handleBattleFinished}
      />
    );
  }

  if (contentStep === "feedback") {
    return (
      <FeedbackForm
        tripId={trip.id}
        participantId={adult?.id ?? null}
        onSubmitted={handleFeedbackSubmitted}
      />
    );
  }

  if (contentStep === "thanks") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <h1 className="text-[26px] font-semibold text-foreground">Mulțumim! 🙌</h1>
        <p className="text-[17px] text-secondary-foreground">
          {trip.name} — scorul final:
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
