"use client";

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripBySlug, currentTripDay, type Trip } from "@/lib/trip";
import {
  listProfilesForDevice,
  getOrCreateAdultParticipant,
  addChildProfile,
  getParticipantCounts,
  type Participant,
  type ParticipantCounts,
} from "@/lib/participant";
import { supabase } from "@/lib/supabase/client";
import { trackEvent } from "@/lib/analytics";
import {
  getDailyBattle,
  getFinalBattle,
  isBattleCompleted,
  getBattleLeaderboard,
  getTripLeaderboard,
} from "@/lib/battle";
import { getSlotAvailability, getNextWindowOpening } from "@/lib/schedule";
import type { BattleTeam } from "@/lib/supabase/types";

interface SlotStatus {
  questionId: string | null;
  completed: boolean;
}

interface BattleStatus {
  available: boolean;
  completed: boolean;
}

const EMPTY_STATUS: SlotStatus = { questionId: null, completed: false };
const EMPTY_BATTLE_STATUS: BattleStatus = { available: false, completed: false };
const EMPTY_SCORE: Record<BattleTeam, number> = { adults: 0, kids: 0 };
const EMPTY_COUNTS: ParticipantCounts = { adults: 0, children: 0 };

export default function TripHomePage() {
  const { slug } = useParams<{ slug: string }>();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [profiles, setProfiles] = useState<Participant[]>([]);
  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [morningStatus, setMorningStatus] = useState<SlotStatus>(EMPTY_STATUS);
  const [lunchStatus, setLunchStatus] = useState<SlotStatus>(EMPTY_STATUS);
  const [battleStatus, setBattleStatus] = useState<BattleStatus>(EMPTY_BATTLE_STATUS);
  const [finalStatus, setFinalStatus] = useState<BattleStatus>(EMPTY_BATTLE_STATUS);
  const [dailyScore, setDailyScore] = useState<Record<BattleTeam, number>>(EMPTY_SCORE);
  const [tripScore, setTripScore] = useState<Record<BattleTeam, number>>(EMPTY_SCORE);
  const [participantCounts, setParticipantCounts] = useState<ParticipantCounts>(EMPTY_COUNTS);
  const [showAddChild, setShowAddChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [childAge, setChildAge] = useState("");

  const loadProfiles = useCallback(async (tripId: string) => {
    const list = await listProfilesForDevice(tripId);
    setProfiles(list);
    return list;
  }, []);

  const loadSlotStatus = useCallback(
    async (tripId: string, day: number, profileIds: string[]) => {
      const [{ data: morningQ }, { data: lunchQ }] = await Promise.all([
        supabase
          .from("questions")
          .select("id")
          .eq("trip_id", tripId)
          .eq("kind", "discover")
          .eq("day_number", day)
          .eq("slot", "morning")
          .maybeSingle(),
        supabase
          .from("questions")
          .select("id")
          .eq("trip_id", tripId)
          .eq("kind", "discover")
          .eq("day_number", day)
          .eq("slot", "lunch")
          .maybeSingle(),
      ]);

      async function isCompleted(questionId: string | undefined) {
        if (!questionId || profileIds.length === 0) return false;
        const { count } = await supabase
          .from("responses")
          .select("id", { count: "exact", head: true })
          .eq("question_id", questionId)
          .in("participant_id", profileIds);
        return (count ?? 0) > 0;
      }

      const [morningDone, lunchDone] = await Promise.all([
        isCompleted(morningQ?.id),
        isCompleted(lunchQ?.id),
      ]);

      setMorningStatus({ questionId: morningQ?.id ?? null, completed: morningDone });
      setLunchStatus({ questionId: lunchQ?.id ?? null, completed: lunchDone });
    },
    [],
  );

  const loadBattleStatus = useCallback(async (tripId: string, day: number) => {
    const [daily, final] = await Promise.all([
      getDailyBattle(tripId, day),
      getFinalBattle(tripId),
    ]);

    const [dailyCompleted, finalCompleted] = await Promise.all([
      daily ? isBattleCompleted(daily.battle.id) : Promise.resolve(false),
      final ? isBattleCompleted(final.battle.id) : Promise.resolve(false),
    ]);

    setBattleStatus({ available: !!daily && daily.questions.length > 0, completed: dailyCompleted });
    setFinalStatus({ available: !!final && final.questions.length > 0, completed: finalCompleted });

    const [dailyLeaderboard, tripLeaderboard] = await Promise.all([
      daily ? getBattleLeaderboard(daily.battle.id) : Promise.resolve(EMPTY_SCORE),
      getTripLeaderboard(tripId),
    ]);
    setDailyScore(dailyLeaderboard);
    setTripScore(tripLeaderboard);
  }, []);

  const loadParticipantCounts = useCallback(async (tripId: string) => {
    setParticipantCounts(await getParticipantCounts(tripId));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setLoadError(false);
      try {
        const t = await getTripBySlug(slug);
        if (cancelled) return;
        setTrip(t);
        if (!t) return;
        const list = await loadProfiles(t.id);
        if (cancelled) return;
        await loadParticipantCounts(t.id);
        if (cancelled) return;
        if (list.length > 0) {
          const day = currentTripDay(t);
          await Promise.all([
            loadSlotStatus(t.id, day, list.map((p) => p.id)),
            loadBattleStatus(t.id, day),
          ]);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug, loadProfiles, loadSlotStatus, loadBattleStatus, loadParticipantCounts]);

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!trip || !joinName.trim()) return;
    setJoining(true);
    try {
      const adult = await getOrCreateAdultParticipant(trip.id, joinName.trim());
      await trackEvent(trip.id, "trip_joined", adult.id);
      const list = await loadProfiles(trip.id);
      const day = currentTripDay(trip);
      await Promise.all([
        loadSlotStatus(trip.id, day, list.map((p) => p.id)),
        loadBattleStatus(trip.id, day),
        loadParticipantCounts(trip.id),
      ]);
    } finally {
      setJoining(false);
    }
  }

  async function handleAddChild(e: FormEvent) {
    e.preventDefault();
    if (!trip || !childName.trim() || !childAge) return;
    const adult = profiles.find((p) => p.role === "adult");
    if (!adult) return;
    await addChildProfile(trip.id, adult.id, childName.trim(), Number(childAge));
    setChildName("");
    setChildAge("");
    setShowAddChild(false);
    await loadProfiles(trip.id);
  }

  if (loading) {
    return <CenteredMessage>Se încarcă...</CenteredMessage>;
  }

  if (loadError) {
    return (
      <CenteredMessage>
        <p>Nu am putut încărca datele. Verifică-ți conexiunea.</p>
        <button onClick={() => window.location.reload()} className="mt-4 underline">
          Încearcă din nou
        </button>
      </CenteredMessage>
    );
  }

  if (!trip) {
    return <CenteredMessage>Nu am găsit această călătorie.</CenteredMessage>;
  }

  if (profiles.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
        <div className="text-center">
          <h1 className="text-3xl font-semibold uppercase tracking-wide">{trip.name}</h1>
          <p className="mt-2 text-slate-600">Hai să descoperim {trip.name} împreună.</p>
        </div>
        <form onSubmit={handleJoin} className="flex flex-col gap-3">
          <label className="text-sm font-medium text-slate-700" htmlFor="joinName">
            Cum te numești?
          </label>
          <input
            id="joinName"
            className="rounded-xl border border-slate-300 px-4 py-3 text-lg"
            value={joinName}
            onChange={(e) => setJoinName(e.target.value)}
            placeholder="Numele tău"
            autoFocus
          />
          <button
            type="submit"
            disabled={joining || !joinName.trim()}
            className="rounded-xl bg-slate-900 px-4 py-3 text-lg font-semibold text-white disabled:opacity-40"
          >
            {joining ? "..." : "ALĂTURĂ-TE"}
          </button>
        </form>
      </main>
    );
  }

  const day = currentTripDay(trip);
  const daysToFinal = trip.duration_days - day;
  const adult = profiles.find((p) => p.role === "adult");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-6 py-10">
      <header className="text-center">
        <h1 className="text-3xl font-bold uppercase tracking-wide">{trip.name}</h1>
        <p className="mt-1 text-slate-600">
          Ziua {day} din {trip.duration_days}
        </p>
        <Link href={`/trip/${slug}/history`} className="mt-2 inline-block text-sm text-slate-500 underline">
          Istoric întrebări și răspunsuri
        </Link>
      </header>

      <Dashboard
        trip={trip}
        day={day}
        daysToFinal={daysToFinal}
        counts={participantCounts}
        dailyScore={dailyScore}
        tripScore={tripScore}
      />

      <section className="flex flex-col gap-4">
        <SlotCard
          emoji="☀️"
          label="Dimineață"
          status={morningStatus}
          href={`/trip/${slug}/discover/morning`}
          scheduledSlot="morning"
        />
        <SlotCard
          emoji="🍉"
          label="Prânz"
          status={lunchStatus}
          href={`/trip/${slug}/discover/lunch`}
          scheduledSlot="lunch"
        />
        <div className="rounded-2xl border border-slate-200 px-5 py-4">
          <div className="flex items-center gap-2 text-lg font-medium">
            <span>🌙</span>
            <span>Battle</span>
          </div>
          <BattleAvailability status={battleStatus} slug={slug} />
        </div>
      </section>

      {finalStatus.available ? (
        <div className="rounded-2xl border border-slate-200 px-5 py-4 text-center">
          <p className="text-lg font-medium">🏆 Final Battle</p>
          {finalStatus.completed ? (
            <Link href={`/trip/${slug}/final`} className="mt-1 inline-block text-emerald-600 underline">
              ✓ Completat — vezi rezultatul
            </Link>
          ) : (
            <Link
              href={`/trip/${slug}/final`}
              className="mt-2 inline-block rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white"
            >
              HAI LA FINALĂ
            </Link>
          )}
        </div>
      ) : (
        <p className="text-center text-sm text-slate-500">
          {daysToFinal > 0 ? `Final Battle în ${daysToFinal} zile` : "Final Battle azi"}
        </p>
      )}

      <section className="mt-auto flex flex-col gap-3 border-t border-slate-200 pt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Profiluri</h2>
        <ul className="flex flex-col gap-2">
          {profiles.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-xl bg-slate-100 px-4 py-2"
            >
              <span>{p.display_name}</span>
              <span className="text-xs uppercase text-slate-500">
                {p.role === "adult" ? "Adult" : `Copil${p.age ? `, ${p.age}` : ""}`}
              </span>
            </li>
          ))}
        </ul>

        {showAddChild ? (
          <form onSubmit={handleAddChild} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-4">
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Numele copilului"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2"
              placeholder="Vârsta"
              type="number"
              min={0}
              max={17}
              value={childAge}
              onChange={(e) => setChildAge(e.target.value)}
            />
            <div className="flex gap-2">
              <button type="submit" className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-white">
                Adaugă
              </button>
              <button
                type="button"
                onClick={() => setShowAddChild(false)}
                className="flex-1 rounded-lg border border-slate-300 px-3 py-2"
              >
                Anulează
              </button>
            </div>
          </form>
        ) : (
          adult && (
            <button
              onClick={() => setShowAddChild(true)}
              className="rounded-xl border border-dashed border-slate-300 px-4 py-2 text-slate-600"
            >
              + Adaugă profil copil
            </button>
          )
        )}
      </section>
    </main>
  );
}

function Dashboard({
  trip,
  day,
  daysToFinal,
  counts,
  dailyScore,
  tripScore,
}: {
  trip: Trip;
  day: number;
  daysToFinal: number;
  counts: ParticipantCounts;
  dailyScore: Record<BattleTeam, number>;
  tripScore: Record<BattleTeam, number>;
}) {
  const daysPassed = Math.max(day - 1, 0);

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 px-5 py-4">
      {(trip.destination || trip.location_info) && (
        <div>
          {trip.destination && <p className="font-medium">📍 {trip.destination}</p>}
          {trip.location_info && <p className="mt-1 text-sm text-slate-600">{trip.location_info}</p>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-center">
        <Stat label="Participanți" value={`${counts.adults} adulți, ${counts.children} copii`} />
        <Stat label="Zile" value={`${daysPassed} trecute · ${Math.max(daysToFinal, 0)} rămase`} />
        <Stat label="Scorul zilei" value={`${dailyScore.adults} — ${dailyScore.kids}`} />
        <Stat label="Scor general" value={`${tripScore.adults} — ${tripScore.kids}`} />
      </div>

      <NextChallengeCountdown />
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

const COUNTDOWN_SLOT_LABEL: Record<string, string> = {
  morning: "Dimineață",
  lunch: "Prânz",
  battle: "Battle",
};

function NextChallengeCountdown() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const next = getNextWindowOpening(now);
  const totalSeconds = Math.max(0, Math.floor((next.opensAt.getTime() - now.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <div className="text-center">
      <p className="text-xs uppercase tracking-wide text-slate-500">
        Următorul challenge: {COUNTDOWN_SLOT_LABEL[next.slot]}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">
        {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </p>
    </div>
  );
}

function SlotCard({
  emoji,
  label,
  status,
  href,
  scheduledSlot,
}: {
  emoji: string;
  label: string;
  status: SlotStatus;
  href: string;
  scheduledSlot: "morning" | "lunch";
}) {
  const availability = getSlotAvailability(scheduledSlot);

  return (
    <div className="rounded-2xl border border-slate-200 px-5 py-4">
      <div className="flex items-center gap-2 text-lg font-medium">
        <span>{emoji}</span>
        <span>{label}</span>
      </div>
      {status.completed ? (
        <p className="mt-1 text-emerald-600">✓ Completat</p>
      ) : !status.questionId ? (
        <p className="mt-1 text-slate-400">Conținutul nu e încă disponibil</p>
      ) : availability.status === "before" ? (
        <p className="mt-1 text-slate-500">Disponibil de la {availability.opensAt}</p>
      ) : availability.status === "after" ? (
        <p className="mt-1 text-slate-400">S-a încheiat pentru azi</p>
      ) : (
        <Link href={href} className="mt-2 inline-block rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white">
          DESCOPERĂ
        </Link>
      )}
    </div>
  );
}

function BattleAvailability({ status, slug }: { status: BattleStatus; slug: string }) {
  if (!status.available) {
    return <p className="mt-1 text-slate-500">Disponibil diseară</p>;
  }
  if (status.completed) {
    return <p className="mt-1 text-emerald-600">✓ Completat</p>;
  }
  const availability = getSlotAvailability("battle");
  if (availability.status === "before") {
    return <p className="mt-1 text-slate-500">Disponibil de la {availability.opensAt}</p>;
  }
  if (availability.status === "after") {
    return <p className="mt-1 text-slate-400">S-a încheiat pentru azi</p>;
  }
  return (
    <Link
      href={`/trip/${slug}/battle`}
      className="mt-2 inline-block rounded-lg bg-slate-900 px-4 py-2 font-semibold text-white"
    >
      HAI LA BATTLE
    </Link>
  );
}

function CenteredMessage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 text-center text-slate-600">
      {children}
    </main>
  );
}
