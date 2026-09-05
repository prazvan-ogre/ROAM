"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { currentTripDay } from "@/lib/trip";
import { getDailyBattle, getFinalBattle, getBattleWindowStatus, getBattleResult, getTripBattleWinTally } from "@/lib/battle";
import { getParticipantLeaderboard, type LeaderboardEntry } from "@/lib/discover";
import { TripNav } from "@/components/TripNav";
import { Centered } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { useTrip, useProfiles } from "@/lib/hooks";
import type { BattleTeam } from "@/lib/supabase/types";

type Step = "loading" | "error" | "ready";
type Tab = "total" | "today";

const EMPTY_SCORE: Record<BattleTeam, number> = { adults: 0, kids: 0 };
const RANK_MEDAL: Record<number, string> = { 0: "🥇", 1: "🥈", 2: "🥉" };

export default function LeaderboardPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: trip, error: tripError } = useTrip(slug);
  const { data: profiles, error: profilesError } = useProfiles(trip?.id);

  const [step, setStep] = useState<Step>("loading");
  const [day, setDay] = useState(1);
  const [tab, setTab] = useState<Tab>("total");
  const [dailyScore, setDailyScore] = useState<Record<BattleTeam, number>>(EMPTY_SCORE);
  const [tripScore, setTripScore] = useState<Record<BattleTeam, number>>(EMPTY_SCORE);
  const [totalRanking, setTotalRanking] = useState<LeaderboardEntry[]>([]);
  const [todayRanking, setTodayRanking] = useState<LeaderboardEntry[]>([]);

  const load = useCallback(async () => {
    if (!trip || !profiles || profiles.length === 0) return;
    try {
      const d = currentTripDay(trip);
      setDay(d);

      // Final Battle replaces that evening's regular Battle on the
      // trip's last day (product owner spec), so "Scor zilnic" reflects
      // its result then instead of a regular battle that's never played.
      const daily = d >= trip.duration_days ? await getFinalBattle(trip.id) : await getDailyBattle(trip.id, d);

      // The evening's result stays hidden for 15 minutes after the
      // first individual answer (product owner spec), so nobody can peek
      // at a partial score here while others are still answering.
      const dailyVisible = daily ? (await getBattleWindowStatus(daily.battle.id)).visible : false;

      const [dailyResult, tripWinTally, total, today] = await Promise.all([
        daily && dailyVisible ? getBattleResult(daily.battle.id) : Promise.resolve(EMPTY_SCORE),
        getTripBattleWinTally(trip.id),
        getParticipantLeaderboard(trip.id),
        getParticipantLeaderboard(trip.id, d),
      ]);
      setDailyScore(dailyResult);
      setTripScore(tripWinTally);
      setTotalRanking(total);
      setTodayRanking(today);
      setStep("ready");
    } catch (err) {
      // Logged rather than swallowed -- the generic error screen hides real
      // causes (e.g. trip_battle_win_tally() not yet migrated) otherwise.
      console.error("Leaderboard load failed", err);
      setStep("error");
    }
  }, [trip, profiles]);

  useEffect(() => {
    load();

    // The evening's score can flip from hidden to revealed (the 15-minute
    // window in getBattleWindowStatus) while someone is just sitting on
    // this screen, and any answer anywhere moves the rankings -- without a
    // refresh, this page would stay frozen at whatever it looked like when
    // it happened to load. Re-fetch on every new `responses`/`battle_scores`
    // row (Realtime, see 20260831090000_realtime_publication.sql) instead
    // of a fixed poll, plus immediately when the tab regains focus and on
    // a slow fallback interval in case the socket drops without Postgres
    // Changes noticing.
    const channel = supabase
      .channel(`leaderboard:${slug}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "responses" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "battle_scores" }, load)
      .subscribe();
    const fallback = setInterval(load, 120_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(fallback);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load, slug]);

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

  const isTotal = tab === "total";
  const teamScore = isTotal ? tripScore : dailyScore;
  const ranking = (isTotal ? totalRanking : todayRanking).filter((e) => e.answered > 0);

  // Dense ranking: equal scores share the same place (and medal), and
  // the next distinct score is only ever one place below, regardless of
  // how many people were tied above it (1, 1, 2 -- not 1, 1, 3, and not
  // each row getting a strictly increasing number regardless of ties).
  const ranks: number[] = [];
  ranking.forEach((e, i) => {
    if (i === 0) ranks.push(1);
    else ranks.push(ranking[i - 1].score === e.score ? ranks[i - 1] : ranks[i - 1] + 1);
  });

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
            {ranking.map((e, i) => {
              const rank = ranks[i];
              return (
              <div key={e.participantId} className="flex items-center border-b border-secondary py-3.5 last:border-0">
                <span className={`w-6 shrink-0 text-[14px] font-bold ${rank === 1 ? "text-primary" : "text-disabled"}`}>
                  {RANK_MEDAL[rank - 1] ?? rank}
                </span>
                <div className="ml-3 min-w-0 flex-1">
                  <p className="text-[16px] font-semibold text-foreground">{e.displayName}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {e.role === "adult" ? "Adult" : e.age ? `Copil · ${e.age} ani` : "Copil"}
                  </p>
                </div>
                <p className={`shrink-0 text-[16px] font-bold ${rank === 1 ? "text-primary" : "text-foreground"}`}>
                  {e.score}
                </p>
              </div>
              );
            })}
          </div>
        </div>
      )}

      <TripNav slug={slug} />
    </main>
  );
}
