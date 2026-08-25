"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripBySlug, currentTripDay, type Trip } from "@/lib/trip";
import { listProfilesForDevice } from "@/lib/participant";
import { getDailyBattle, isBattleCompleted, getBattleLeaderboard, type BattleContent } from "@/lib/battle";
import { BattleFlow } from "@/components/BattleFlow";
import type { BattleTeam } from "@/lib/supabase/types";

type Step = "loading" | "error" | "not-joined" | "unavailable" | "already-played" | "play";

export default function DailyBattlePage() {
  const { slug } = useParams<{ slug: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [content, setContent] = useState<BattleContent | null>(null);
  const [score, setScore] = useState<Record<BattleTeam, number>>({ adults: 0, kids: 0 });

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

        const battle = await getDailyBattle(t.id, currentTripDay(t));
        if (cancelled) return;
        if (!battle || battle.questions.length === 0) {
          setStep("unavailable");
          return;
        }
        setContent(battle);

        const played = await isBattleCompleted(battle.battle.id);
        if (cancelled) return;
        if (played) {
          const leaderboard = await getBattleLeaderboard(battle.battle.id);
          if (cancelled) return;
          setScore(leaderboard);
          setStep("already-played");
        } else {
          setStep("play");
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
        <p>Battle-ul de azi nu e încă disponibil.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }
  if (step === "already-played") {
    return (
      <Centered>
        <p className="text-2xl font-semibold">
          PĂRINȚI {score.adults} — COPII {score.kids}
        </p>
        <p className="mt-2 text-slate-600">Battle-ul de azi e deja jucat.</p>
        <Link href={`/trip/${slug}`} className="mt-4 inline-block underline">
          Înapoi acasă
        </Link>
      </Centered>
    );
  }

  if (!trip || !content) return <Centered>Se încarcă...</Centered>;

  return <BattleFlow content={content} tripId={trip.id} slug={slug} isFinal={false} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-slate-600">
      {children}
    </main>
  );
}
