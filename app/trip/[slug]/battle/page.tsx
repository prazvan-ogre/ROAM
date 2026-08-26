"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripBySlug, currentTripDay, type Trip } from "@/lib/trip";
import { listProfilesForDevice, type Participant } from "@/lib/participant";
import { getDailyBattle, type BattleContent } from "@/lib/battle";
import { BattleFlow } from "@/components/BattleFlow";
import { Centered } from "@/components/ui";

type Step = "loading" | "error" | "not-joined" | "unavailable" | "play";

export default function DailyBattlePage() {
  const { slug } = useParams<{ slug: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [content, setContent] = useState<BattleContent | null>(null);
  const [profiles, setProfiles] = useState<Participant[]>([]);

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

        const battle = await getDailyBattle(t.id, currentTripDay(t));
        if (cancelled) return;
        if (!battle || battle.questions.length === 0) {
          setStep("unavailable");
          return;
        }
        setContent(battle);
        setStep("play");
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
  if (!trip || !content) return <Centered>Se încarcă...</Centered>;

  return <BattleFlow content={content} tripId={trip.id} slug={slug} isFinal={false} profiles={profiles} />;
}
