"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Sun, Utensils, Moon, Check, Clock, Trophy, History } from "lucide-react";
import { getTripBySlug, currentTripDay, type Trip } from "@/lib/trip";
import { listProfilesForDevice, type Participant } from "@/lib/participant";
import { TripNav } from "@/components/TripNav";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { Centered } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { getDailyBattle, getFinalBattle } from "@/lib/battle";
import { getCatchUpQuestions } from "@/lib/discover";
import { getSlotAvailability, getNextWindowOpening } from "@/lib/schedule";

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

export default function TripHomePage() {
  const { slug } = useParams<{ slug: string }>();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [profiles, setProfiles] = useState<Participant[]>([]);
  const [morningStatus, setMorningStatus] = useState<SlotStatus>(EMPTY_STATUS);
  const [lunchStatus, setLunchStatus] = useState<SlotStatus>(EMPTY_STATUS);
  const [battleStatus, setBattleStatus] = useState<BattleStatus>(EMPTY_BATTLE_STATUS);
  const [finalStatus, setFinalStatus] = useState<BattleStatus>(EMPTY_BATTLE_STATUS);
  const [hasCatchUp, setHasCatchUp] = useState(false);

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

  const loadBattleStatus = useCallback(
    async (tripId: string, day: number, isLastDay: boolean, profileIds: string[]) => {
      const [daily, final] = await Promise.all([
        getDailyBattle(tripId, day),
        isLastDay ? getFinalBattle(tripId) : Promise.resolve(null),
      ]);

      // Everyone on this device answers Battle questions individually
      // now (like Discover), so "completed" here means this device's own
      // participants have already answered, same check as Discover's
      // slot status -- not a trip-wide "has anyone at all played" flag.
      async function isDeviceCompleted(content: typeof daily) {
        if (!content || profileIds.length === 0) return false;
        const questionIds = content.questions.map((q) => q.question.id);
        if (questionIds.length === 0) return false;
        const { count } = await supabase
          .from("responses")
          .select("id", { count: "exact", head: true })
          .in("question_id", questionIds)
          .in("participant_id", profileIds);
        return (count ?? 0) > 0;
      }

      const [dailyCompleted, finalCompleted] = await Promise.all([
        isDeviceCompleted(daily),
        isDeviceCompleted(final),
      ]);

      setBattleStatus({ available: !!daily && daily.questions.length > 0, completed: dailyCompleted });
      setFinalStatus({ available: !!final && final.questions.length > 0, completed: finalCompleted });
    },
    [],
  );

  // Catch-up questions (past days' Discover/Battle this device's profiles
  // never answered) are otherwise only ever offered once, during the
  // onboarding wizard right after a participant is created -- a returning
  // participant who joined earlier and missed some has no other way back
  // to them once the day rolls over. This surfaces that gap as a banner
  // linking to /catchup, checked per profile since each has its own
  // pending list.
  const loadCatchUpStatus = useCallback(async (tripId: string, day: number, list: Participant[]) => {
    const perProfile = await Promise.all(
      list.map((p) => getCatchUpQuestions(tripId, day, p.id)),
    );
    setHasCatchUp(perProfile.some((pending) => pending.length > 0));
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
        if (list.length > 0) {
          const day = currentTripDay(t);
          const profileIds = list.map((p) => p.id);
          await Promise.all([
            loadSlotStatus(t.id, day, profileIds),
            loadBattleStatus(t.id, day, day >= t.duration_days, profileIds),
            loadCatchUpStatus(t.id, day, list),
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
  }, [slug, loadProfiles, loadSlotStatus, loadBattleStatus, loadCatchUpStatus]);

  async function handleWizardComplete() {
    if (!trip) return;
    const list = await loadProfiles(trip.id);
    const day = currentTripDay(trip);
    const profileIds = list.map((p) => p.id);
    await Promise.all([
      loadSlotStatus(trip.id, day, profileIds),
      loadBattleStatus(trip.id, day, day >= trip.duration_days, profileIds),
      loadCatchUpStatus(trip.id, day, list),
    ]);
  }

  if (loading) {
    return <Centered>Se încarcă...</Centered>;
  }

  if (loadError) {
    return (
      <Centered>
        <p>Nu am putut încărca datele. Verifică-ți conexiunea.</p>
        <button onClick={() => window.location.reload()} className="mt-4 underline">
          Încearcă din nou
        </button>
      </Centered>
    );
  }

  if (!trip) {
    return <Centered>Nu am găsit această călătorie.</Centered>;
  }

  if (profiles.length === 0) {
    return <OnboardingWizard trip={trip} onComplete={handleWizardComplete} />;
  }

  const day = currentTripDay(trip);
  const daysToFinal = trip.duration_days - day;

  const completedToday = [morningStatus.completed, lunchStatus.completed, battleStatus.completed].filter(
    Boolean,
  ).length;
  const totalToday = [morningStatus.questionId, lunchStatus.questionId, battleStatus.available].filter(
    Boolean,
  ).length;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-5 pb-32 pt-14">
      <header>
        <h1 className="mb-2 text-[34px] font-semibold leading-[1.1] tracking-tight text-foreground">{trip.name}</h1>
        <div className="flex items-end justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[15px] text-muted-foreground">
              Ziua {day} din {trip.duration_days}
            </span>
            <span className="text-disabled">·</span>
            <ProgressDots current={day} total={trip.duration_days} />
          </div>
          <NextChallengeCountdown compact />
        </div>
        {trip.location_info && (
          <p className="mt-3 max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
            {trip.location_info}
          </p>
        )}
      </header>

      {hasCatchUp && (
        <Link
          href={`/trip/${slug}/catchup`}
          className="flex items-center gap-3 rounded-[20px] border border-primary/30 bg-accent px-5 py-4 shadow-[0_2px_16px_rgba(0,0,0,0.06)] transition-all active:scale-[0.99]"
        >
          <History size={18} className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-foreground">Ai întrebări de recuperat</p>
            <p className="text-[13px] text-muted-foreground">Din zilele anterioare</p>
          </div>
        </Link>
      )}

      {totalToday > 0 && (
        <div className="rounded-[20px] border border-border bg-card p-5 shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
            Provocarea de azi
          </p>
          <p className="mb-4 text-[14px] text-muted-foreground">
            {completedToday} din {totalToday} completate
          </p>
          <div className="mb-1 h-[3px] rounded-full bg-secondary">
            <div
              className="h-[3px] rounded-full bg-primary transition-all duration-700"
              style={{ width: `${(completedToday / totalToday) * 100}%` }}
            />
          </div>
          {completedToday === totalToday && (
            <div className="mt-4 flex items-center justify-center gap-2 py-1 text-[15px] font-semibold text-primary">
              <Check size={16} />
              Totul completat pentru azi
            </div>
          )}
        </div>
      )}

      <section>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Detalii</p>
        <div className="mt-3">
          <ChallengeRow
            icon={<Sun size={17} />}
            title="Dimineață"
            status={morningStatus}
            href={`/trip/${slug}/discover/morning`}
            scheduledSlot="morning"
          />
          <ChallengeRow
            icon={<Utensils size={17} />}
            title="Prânz"
            status={lunchStatus}
            href={`/trip/${slug}/discover/lunch`}
            scheduledSlot="lunch"
          />
          <BattleChallengeRow status={battleStatus} slug={slug} isLast />
        </div>
      </section>

      {day >= trip.duration_days ? (
        finalStatus.available ? (
          <div className="rounded-[20px] border border-border bg-card p-5 text-center shadow-[0_2px_16px_rgba(0,0,0,0.06)]">
            <p className="mb-3 flex items-center justify-center gap-2 text-[17px] font-semibold text-foreground">
              <Trophy size={18} className="text-primary" /> Final Battle
            </p>
            {finalStatus.completed ? (
              <Link href={`/trip/${slug}/final`} className="inline-flex items-center gap-1 text-[15px] font-medium text-primary underline">
                <Check size={14} /> Completat — vezi rezultatul
              </Link>
            ) : (
              <Link
                href={`/trip/${slug}/final`}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary py-[14px] text-[15px] font-semibold text-primary-foreground transition-all duration-150 hover:bg-primary-hover active:scale-[0.98]"
              >
                HAI LA FINALĂ
              </Link>
            )}
          </div>
        ) : (
          <p className="text-center text-[13px] text-muted-foreground">Final Battle azi</p>
        )
      ) : (
        <p className="text-center text-[13px] text-muted-foreground">Final Battle în {daysToFinal} zile</p>
      )}

      <TripNav slug={slug} />
    </main>
  );
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`rounded-full transition-all duration-300 ${
            i < current ? "h-2 w-2 bg-primary" : "h-1.5 w-1.5 bg-disabled"
          }`}
        />
      ))}
    </div>
  );
}

const COUNTDOWN_SLOT_LABEL: Record<string, string> = {
  morning: "Dimineață",
  lunch: "Prânz",
  battle: "Battle",
};

function NextChallengeCountdown({ compact }: { compact?: boolean }) {
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

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <div className="flex items-center gap-1">
          <Clock size={11} className="text-muted-foreground" />
          <span className="text-[11px] text-muted-foreground">{COUNTDOWN_SLOT_LABEL[next.slot]}</span>
        </div>
        <span className="font-mono text-[17px] font-semibold leading-none tracking-[0.03em] text-foreground">
          {pad(hours)}:{pad(minutes)}:{pad(seconds)}
        </span>
      </div>
    );
  }

  return (
    <div className="text-center">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Următorul challenge: {COUNTDOWN_SLOT_LABEL[next.slot]}
      </p>
      <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
        {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </p>
    </div>
  );
}

function ChallengeRow({
  icon,
  title,
  status,
  href,
  scheduledSlot,
}: {
  icon: ReactNode;
  title: string;
  status: SlotStatus;
  href: string;
  scheduledSlot: "morning" | "lunch";
}) {
  const availability = getSlotAvailability(scheduledSlot);

  let right: ReactNode;
  if (status.completed) {
    right = <Check size={16} className="shrink-0 text-primary" />;
  } else if (!status.questionId) {
    right = <span className="shrink-0 text-[13px] text-muted-foreground">nepublicat</span>;
  } else if (availability.status === "before") {
    right = <span className="shrink-0 text-[13px] text-muted-foreground">de la {availability.opensAt}</span>;
  } else if (availability.status === "after") {
    right = <span className="shrink-0 text-[13px] text-disabled">încheiat</span>;
  } else {
    right = (
      <Link href={href} className="shrink-0 text-[13px] font-semibold text-primary active:opacity-60">
        Descoperă
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-3 border-b border-secondary py-4">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          status.completed || !status.questionId ? "bg-secondary" : "bg-accent"
        }`}
      >
        <div className={status.completed ? "text-disabled" : status.questionId ? "text-primary" : "text-muted-foreground"}>
          {icon}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-none text-foreground">{title}</p>
      </div>
      {right}
    </div>
  );
}

function BattleChallengeRow({
  status,
  slug,
  isLast,
}: {
  status: BattleStatus;
  slug: string;
  isLast?: boolean;
}) {
  let right: ReactNode;
  if (!status.available) {
    right = <span className="shrink-0 text-[13px] text-muted-foreground">diseară</span>;
  } else if (status.completed) {
    right = <Check size={16} className="shrink-0 text-primary" />;
  } else {
    const availability = getSlotAvailability("battle");
    if (availability.status === "before") {
      right = <span className="shrink-0 text-[13px] text-muted-foreground">de la {availability.opensAt}</span>;
    } else if (availability.status === "after") {
      right = <span className="shrink-0 text-[13px] text-disabled">încheiat</span>;
    } else {
      right = (
        <Link href={`/trip/${slug}/battle`} className="shrink-0 text-[13px] font-semibold text-primary active:opacity-60">
          Începe
        </Link>
      );
    }
  }

  return (
    <div className={`flex items-center gap-3 py-4 ${!isLast ? "border-b border-secondary" : ""}`}>
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          status.completed || !status.available ? "bg-secondary" : "bg-accent"
        }`}
      >
        <div className={status.completed ? "text-disabled" : status.available ? "text-primary" : "text-muted-foreground"}>
          <Moon size={17} />
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium leading-none text-foreground">Battle</p>
      </div>
      {right}
    </div>
  );
}
