"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripBySlug, currentTripDay, type Trip } from "@/lib/trip";
import { listProfilesForDevice } from "@/lib/participant";
import { getDailyBattle, getBattleLeaderboard, getTripLeaderboard } from "@/lib/battle";
import { getParticipantLeaderboard, type LeaderboardEntry } from "@/lib/discover";
import { TripNav } from "@/components/TripNav";
import { Centered } from "@/components/ui";
import type { BattleTeam } from "@/lib/supabase/types";

type Step = "loading" | "error" | "not-joined" | "ready";
type Tab = "total" | "today";

const EMPTY_SCORE: Record<BattleTeam, number> = { adults: 0, kids: 0 };
const RANK_MEDAL: Record<number, string> = { 0: "🥇", 1: "🥈", 2: "🥉" };

export default function LeaderboardPage() {
  const { slug } = useParams<{ slug: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [day, setDay] = useState(1);
  const [tab, setTab] = useState<Tab>("total");
  const [dailyScore, setDailyScore] = useState<Record<BattleTeam, number>>(EMPTY_SCORE);
  const [tripScore, setTripScore] = useState<Record<BattleTeam, number>>(EMPTY_SCORE);
  const [totalRanking, setTotalRanking] = useState<LeaderboardEntry[]>([]);
  const [todayRanking, setTodayRanking] = useState<LeaderboardEntry[]>([]);

  const load = useCallback(async () => {
    try {
      const t = await getTripBySlug(slug);
      if (!t) return;
      setTrip(t);

      const list = await listProfilesForDevice(t.id);
      if (list.length === 0) {
        setStep("not-joined");
        return;
      }

      const d = currentTripDay(t);
      setDay(d);

      const daily = await getDailyBattle(t.id, d);
      const [dailyLeaderboard, tripLeaderboard, total, today] = await Promise.all([
        daily ? getBattleLeaderboard(daily.battle.id) : Promise.resolve(EMPTY_SCORE),
        getTripLeaderboard(t.id),
        getParticipantLeaderboard(t.id),
        getParticipantLeaderboard(t.id, d),
      ]);
      setDailyScore(dailyLeaderboard);
      setTripScore(tripLeaderboard);
      setTotalRanking(total);
      setTodayRanking(today);
      setStep("ready");
    } catch {
      setStep("error");
    }
  }, [slug]);

  useEffect(() => {
    load();
  }, [load]);

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

  const isTotal = tab === "total";
  const teamScore = isTotal ? tripScore : dailyScore;
  const ranking = (isTotal ? totalRanking : todayRanking).filter((e) => e.answered > 0);

  const todayDiff = dailyScore.adults - dailyScore.kids;
  const todayChip =
    todayDiff > 0
      ? `Astăzi +${todayDiff} Adulți`
      : todayDiff < 0
        ? `Astăzi +${Math.abs(todayDiff)} Copii`
        : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col pb-32">
      <div className="px-5 pb-6 pt-14">
        <p className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-primary">
          {trip?.name?.toUpperCase()} · ZIUA {day}
        </p>
        <h1 className="text-[34px] font-bold leading-[1.05] tracking-tight text-foreground">Cine conduce?</h1>
      </div>

      <div className="mb-8 px-5">
        <div className="flex rounded-xl bg-secondary p-1">
          {(["total", "today"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-lg py-2 text-[14px] font-semibold transition-all duration-200 ${
                tab === t ? "bg-card text-foreground shadow-[0_1px_4px_rgba(0,0,0,0.10)]" : "text-muted-foreground"
              }`}
            >
              {t === "total" ? "Scor total" : "Scor zilnic"}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-10 px-5">
        <div className="flex items-center justify-center gap-4">
          <div className="flex flex-col items-center">
            <span className="text-[56px] font-bold leading-none tracking-tight text-foreground">
              {teamScore.adults}
            </span>
            <span className="mt-1 text-[13px] text-muted-foreground">Adulți</span>
          </div>
          <span className="mb-5 text-[24px] font-light text-disabled">—</span>
          <div className="flex flex-col items-center">
            <span className="text-[56px] font-bold leading-none tracking-tight text-foreground">
              {teamScore.kids}
            </span>
            <span className="mt-1 text-[13px] text-muted-foreground">Copii</span>
          </div>
        </div>

        {isTotal && todayChip && (
          <div className="mt-4 flex justify-center">
            <span className="inline-block rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-primary">
              {todayChip}
            </span>
          </div>
        )}
      </div>

      {ranking.length > 0 && (
        <div className="px-5">
          <h2 className="mb-5 text-[22px] font-bold tracking-tight text-foreground">Clasamentul familiei</h2>
          <div>
            {ranking.map((e, i) => (
              <div key={e.participantId} className="flex items-center border-b border-secondary py-3.5 last:border-0">
                <span className={`w-6 shrink-0 text-[14px] font-bold ${i === 0 ? "text-primary" : "text-disabled"}`}>
                  {RANK_MEDAL[i] ?? i + 1}
                </span>
                <div className="ml-3 min-w-0 flex-1">
                  <p className="text-[16px] font-semibold text-foreground">{e.displayName}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {e.role === "adult" ? "Adult" : `Copil · ${e.age} ani`}
                  </p>
                </div>
                <p className={`shrink-0 text-[16px] font-bold ${i === 0 ? "text-primary" : "text-foreground"}`}>
                  {e.score}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <TripNav slug={slug} />
    </main>
  );
}
