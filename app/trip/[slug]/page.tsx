"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Sun, Utensils, Moon, Check, Clock, Trophy, History } from "lucide-react";
import { currentTripDay } from "@/lib/trip";
import { getStoredActiveProfileId, type Participant } from "@/lib/participant";
import { TripNav } from "@/components/TripNav";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { Centered } from "@/components/ui";
import { supabase } from "@/lib/supabase/client";
import { getDailyBattle, getFinalBattle } from "@/lib/battle";
import { getCatchUpQuestions } from "@/lib/discover";
import { getSlotAvailability, getNextWindowOpening } from "@/lib/schedule";
import { SLOT_LABEL } from "@/lib/constants";
import { useTrip, useProfiles, useActiveProfile } from "@/lib/hooks";

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

// The profile "Cine răspunde?"/ProfileMenu is currently set to answer
// as, falling back to the first (typically the account holder/trip
// creator) profile on this device if none has been explicitly chosen
// yet. `list` must be non-empty -- every call site below already checks
// that before calling this.
function resolveActiveProfile(tripId: string, list: Participant[]): Participant {
  const stored = getStoredActiveProfileId(tripId);
  return list.find((p) => p.id === stored) ?? list[0];
}

export default function TripHomePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: trip, error: tripError } = useTrip(slug);
  const { data: profiles, error: profilesError, mutate: mutateProfiles } = useProfiles(trip?.id);
  // Reactive to ProfileMenu's "Schimbă profilul" (R2, 2026-09-05 review
  // closure batch): this used to re-resolve the active profile via a
  // plain getStoredActiveProfileId() read (resolveActiveProfile below)
  // inside the status-loading effect, keyed only on [trip, profiles, ...]
  // -- none of which change on a same-device profile switch. So switching
  // from A (who'd already answered today) to B (who hadn't) kept showing
  // A's "completed" checkmarks under B's own name until the page was
  // remounted. Same fix, same shared SWR key, as Discover/Catchup's own
  // useActiveProfile.
  const activeProfile = useActiveProfile(trip?.id, profiles);

  const [statusesLoading, setStatusesLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [morningStatus, setMorningStatus] = useState<SlotStatus>(EMPTY_STATUS);
  const [lunchStatus, setLunchStatus] = useState<SlotStatus>(EMPTY_STATUS);
  const [battleStatus, setBattleStatus] = useState<BattleStatus>(EMPTY_BATTLE_STATUS);
  const [finalStatus, setFinalStatus] = useState<BattleStatus>(EMPTY_BATTLE_STATUS);
  const [hasCatchUp, setHasCatchUp] = useState(false);

  const loadSlotStatus = useCallback(
    async (tripId: string, day: number, profileId: string) => {
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

      // Scoped to the active profile alone (hypothesis D, 2026-09-05
      // review): this used to check every profile on the device, so one
      // profile's answer marked the slot "completed" for a sibling
      // profile that had never answered it.
      async function isCompleted(questionId: string | undefined) {
        if (!questionId) return false;
        const { count } = await supabase
          .from("responses")
          .select("id", { count: "exact", head: true })
          .eq("question_id", questionId)
          .eq("participant_id", profileId);
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
    async (tripId: string, day: number, isLastDay: boolean, profileId: string) => {
      // Final Battle replaces that evening's regular Battle on the
      // trip's last day (product owner spec), not a second, additional
      // thing to play -- so the daily battle is never even fetched then,
      // regardless of whether content happens to exist for that day.
      const [daily, final] = await Promise.all([
        isLastDay ? Promise.resolve(null) : getDailyBattle(tripId, day),
        isLastDay ? getFinalBattle(tripId) : Promise.resolve(null),
      ]);

      // "Completed" here means the active profile has already answered
      // (same active-profile scoping as Discover's slot status above,
      // hypothesis D) -- not a trip-wide "has anyone at all played" flag,
      // and not "has any profile on this device played".
      async function isDeviceCompleted(content: typeof daily) {
        if (!content) return false;
        const questionIds = content.questions.map((q) => q.question.id);
        if (questionIds.length === 0) return false;
        const { count } = await supabase
          .from("responses")
          .select("id", { count: "exact", head: true })
          .in("question_id", questionIds)
          .eq("participant_id", profileId);
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
  // linking to /catchup -- checked for the active profile only (the same
  // one /catchup itself now auto-resolves to, no more "Cine recuperează?"
  // picker there), not "any profile on this device", so the banner never
  // promises catch-up questions that aren't actually there for whoever
  // it's about to send in.
  const loadCatchUpStatus = useCallback(async (tripId: string, day: number, activeProfile: Participant) => {
    const pending = await getCatchUpQuestions(tripId, day, activeProfile.id);
    setHasCatchUp(pending.length > 0);
  }, []);

  useEffect(() => {
    if (!trip || !profiles) return;
    if (profiles.length === 0) {
      setStatusesLoading(false);
      return;
    }
    // Waits for useActiveProfile to resolve too -- it's null only while
    // profiles hasn't loaded yet, which the guard above already covers,
    // but the re-run on activeProfile changing (dependency array below)
    // is the whole point of this effect no longer using
    // resolveActiveProfile's one-off localStorage snapshot.
    if (!activeProfile) return;

    let cancelled = false;

    async function load() {
      setStatusesLoading(true);
      setLoadError(false);
      try {
        const day = currentTripDay(trip!);
        await Promise.all([
          loadSlotStatus(trip!.id, day, activeProfile!.id),
          loadBattleStatus(trip!.id, day, day >= trip!.duration_days, activeProfile!.id),
          loadCatchUpStatus(trip!.id, day, activeProfile!),
        ]);
      } catch {
        if (!cancelled) setLoadError(true);
      } finally {
        if (!cancelled) setStatusesLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [trip, profiles, activeProfile, loadSlotStatus, loadBattleStatus, loadCatchUpStatus]);

  async function handleWizardComplete() {
    if (!trip) return;
    const list = await mutateProfiles();
    if (!list || list.length === 0) return;
    const day = currentTripDay(trip);
    const activeProfile = resolveActiveProfile(trip.id, list);
    await Promise.all([
      loadSlotStatus(trip.id, day, activeProfile.id),
      loadBattleStatus(trip.id, day, day >= trip.duration_days, activeProfile.id),
      loadCatchUpStatus(trip.id, day, activeProfile),
    ]);
  }

  if (tripError || profilesError) {
    return (
      <Centered>
        <p>Nu am putut încărca datele. Verifică-ți conexiunea.</p>
        <button onClick={() => window.location.reload()} className="mt-4 underline">
          Încearcă din nou
        </button>
      </Centered>
    );
  }

  if (trip === undefined) {
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

  // A publicly-created trip (app/api/trips/create) exists the instant its
  // row is inserted, but its Discover/Battle content is drafted and
  // inserted afterward as a separate, manual step (product owner
  // decision) -- showing the join wizard (or an empty dashboard) in the
  // meantime would look broken rather than "still being put together."
  if (trip.content_status === "generating" || trip.content_status === "pending") {
    return (
      <Centered>
        <p className="text-[17px] font-semibold text-foreground">Pregătim {trip.name}...</p>
        <p className="mt-2 max-w-xs text-[14px] text-muted-foreground">
          Întrebările și provocările pentru această călătorie sunt în lucru. Revino mai târziu.
        </p>
      </Centered>
    );
  }
  if (trip.content_status === "failed") {
    return (
      <Centered>
        <p className="text-[17px] font-semibold text-foreground">Pregătirea conținutului a fost întreruptă</p>
        <p className="mt-2 max-w-xs text-[14px] text-muted-foreground">
          Călătoria {trip.name} există, dar întrebările nu sunt încă gata. Contactează administratorul.
        </p>
      </Centered>
    );
  }

  if (!profiles || statusesLoading) {
    return <Centered>Se încarcă...</Centered>;
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
            isLast={day >= trip.duration_days}
          />
          {/* Final Battle replaces that evening's regular Battle on the
              last day (product owner spec) -- its own card right below
              already covers "tonight's battle" then, so this row would
              just be a redundant, always-unavailable duplicate. */}
          {day < trip.duration_days && <BattleChallengeRow status={battleStatus} slug={slug} isLast />}
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
          <span className="text-[11px] text-muted-foreground">{SLOT_LABEL[next.slot]}</span>
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
        Următorul challenge: {SLOT_LABEL[next.slot]}
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
  isLast,
}: {
  icon: ReactNode;
  title: string;
  status: SlotStatus;
  href: string;
  scheduledSlot: "morning" | "lunch";
  isLast?: boolean;
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
    <div className={`flex items-center gap-3 py-4 ${!isLast ? "border-b border-secondary" : ""}`}>
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
