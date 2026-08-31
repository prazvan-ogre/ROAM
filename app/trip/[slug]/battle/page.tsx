"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { currentTripDay } from "@/lib/trip";
import { getDailyBattle, type BattleContent } from "@/lib/battle";
import { BattleFlow } from "@/components/BattleFlow";
import { Centered } from "@/components/ui";
import { useTrip, useProfiles } from "@/lib/hooks";

type ContentStep = "loading" | "error" | "unavailable" | "ready";

export default function DailyBattlePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: trip, error: tripError } = useTrip(slug);
  const { data: profiles, error: profilesError } = useProfiles(trip?.id);

  const [contentStep, setContentStep] = useState<ContentStep>("loading");
  const [content, setContent] = useState<BattleContent | null>(null);

  useEffect(() => {
    if (!trip || !profiles || profiles.length === 0) return;

    let cancelled = false;

    async function load() {
      try {
        const battle = await getDailyBattle(trip!.id, currentTripDay(trip!));
        if (cancelled) return;
        if (!battle || battle.questions.length === 0) {
          setContentStep("unavailable");
          return;
        }
        setContent(battle);
        setContentStep("ready");
      } catch {
        if (!cancelled) setContentStep("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [trip, profiles]);

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
        <p>Battle-ul de azi nu e încă disponibil.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  if (!content) return <Centered>Se încarcă...</Centered>;

  return <BattleFlow content={content} tripId={trip.id} slug={slug} isFinal={false} profiles={profiles} />;
}
