"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Sun, Utensils, Moon, ExternalLink } from "lucide-react";
import { currentTripDay } from "@/lib/trip";
import {
  getTripHistory,
  type TripHistory,
  type DiscoverHistoryItem,
  type BattleHistoryItem,
} from "@/lib/history";
import { getAnsweredCorrectOptions } from "@/lib/discover";
import { TripNav } from "@/components/TripNav";
import { Centered } from "@/components/ui";
import { SLOT_LABEL, EXTRA_TYPE_LABEL } from "@/lib/constants";
import { supabase } from "@/lib/supabase/client";
import { useTrip, useProfiles } from "@/lib/hooks";

type Step = "loading" | "error" | "ready";

const SLOT_ICON: Record<string, typeof Sun> = { morning: Sun, lunch: Utensils };
const FINAL_TAB = "final";

export default function QuestionsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: trip, error: tripError } = useTrip(slug);
  const { data: profiles, error: profilesError } = useProfiles(trip?.id);

  const [step, setStep] = useState<Step>("loading");
  const [history, setHistory] = useState<TripHistory | null>(null);
  const [correctOptions, setCorrectOptions] = useState<Map<string, string>>(new Map());
  const [selectedTab, setSelectedTab] = useState<number | typeof FINAL_TAB | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!trip || !profiles || profiles.length === 0) return;

    let cancelled = false;

    async function load() {
      try {
        const h = await getTripHistory(trip!.id, currentTripDay(trip!), profiles!.map((p) => p.id));
        if (cancelled) return;
        setHistory(h);

        // R3 (20260906140000_record_answer_authoritative.sql): which
        // option was correct is no longer part of the fetched
        // answer_options rows themselves (is_correct is masked at the DB
        // level) -- fetched separately, once, for every question this
        // device has an answer on record for (the RPC itself re-checks
        // that, so a question nobody here has answered yet just comes
        // back absent, same spoiler-avoidance as before).
        const questionIds = [
          ...h.discover.map((d) => d.question.id),
          ...h.battles.flatMap((b) => b.questions.map((q) => q.question.id)),
        ];
        const options = await getAnsweredCorrectOptions(questionIds);
        if (cancelled) return;
        setCorrectOptions(options);
        setStep("ready");
      } catch {
        if (!cancelled) setStep("error");
      }
    }

    load();

    // Same staleness bug as the Scor page (leaderboard/page.tsx): a Battle
    // played, or a question answered, after this page's first fetch never
    // showed up until a manual reload. Re-fetch on every new
    // `responses`/`battle_scores` row (Realtime, see
    // 20260831090000_realtime_publication.sql) instead of a fixed poll,
    // plus immediately when the tab regains focus and on a slow fallback
    // interval in case the socket drops without Postgres Changes noticing.
    const channel = supabase
      .channel(`questions:${slug}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "responses" }, load)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "battle_scores" }, load)
      .subscribe();
    const fallback = setInterval(load, 120_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      clearInterval(fallback);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [trip, profiles, slug]);

  const days = useMemo(() => {
    if (!history) return [];
    const dayNumbers = new Set<number>();
    for (const item of history.discover) {
      if (item.question.day_number != null) dayNumbers.add(item.question.day_number);
    }
    for (const item of history.battles) {
      if (!item.battle.is_final && item.battle.day_number != null) {
        dayNumbers.add(item.battle.day_number);
      }
    }
    return Array.from(dayNumbers).sort((a, b) => a - b);
  }, [history]);

  const hasFinal = useMemo(
    () => (history?.battles ?? []).some((b) => b.battle.is_final),
    [history],
  );

  useEffect(() => {
    if (selectedTab !== null || !trip) return;
    const today = currentTripDay(trip);
    if (days.includes(today)) setSelectedTab(today);
    else if (days.length > 0) setSelectedTab(days[days.length - 1]);
    else if (hasFinal) setSelectedTab(FINAL_TAB);
  }, [days, hasFinal, selectedTab, trip]);

  function toggle(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

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

  if (!history || (days.length === 0 && !hasFinal)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-5 pb-32 pt-14">
        <h1 className="text-[28px] font-semibold tracking-tight text-foreground">Întrebări</h1>
        <p className="text-center text-[15px] text-muted-foreground">Nimic de arătat încă.</p>
        <TripNav slug={slug} />
      </main>
    );
  }

  const profileName = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? "?";

  const discoverForTab = history.discover.filter(
    (item) => item.question.day_number === selectedTab && Object.keys(item.responsesByParticipant).length > 0,
  );
  const battlesForTab = history.battles.filter((item) =>
    selectedTab === FINAL_TAB ? item.battle.is_final : item.battle.day_number === selectedTab,
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 pb-32 pt-14">
      <h1 className="px-5 text-[28px] font-semibold tracking-tight text-foreground">Întrebări</h1>

      <div className="flex gap-2 overflow-x-auto px-5 pb-1" style={{ scrollbarWidth: "none" }}>
        {days.map((d) => (
          <button
            key={d}
            onClick={() => setSelectedTab(d)}
            className={`shrink-0 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all ${
              selectedTab === d ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            Ziua {d}
          </button>
        ))}
        {hasFinal && (
          <button
            onClick={() => setSelectedTab(FINAL_TAB)}
            className={`shrink-0 rounded-xl px-4 py-2 text-[13px] font-semibold transition-all ${
              selectedTab === FINAL_TAB ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            Final
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2 px-5">
        {discoverForTab.map((item) => (
          <DiscoverRow
            key={item.question.id}
            item={item}
            expanded={expandedIds.has(item.question.id)}
            onToggle={() => toggle(item.question.id)}
            profileName={profileName}
            correctOptionId={correctOptions.get(item.question.id)}
          />
        ))}
        {battlesForTab.map((item) => (
          <BattleRow
            key={item.battle.id}
            item={item}
            expanded={expandedIds.has(item.battle.id)}
            onToggle={() => toggle(item.battle.id)}
            correctOptions={correctOptions}
          />
        ))}
        {discoverForTab.length === 0 && battlesForTab.length === 0 && (
          <p className="text-center text-[15px] text-disabled">Nimic pentru această zi.</p>
        )}
      </div>

      <TripNav slug={slug} />
    </main>
  );
}

function DiscoverRow({
  item,
  expanded,
  onToggle,
  profileName,
  correctOptionId,
}: {
  item: DiscoverHistoryItem;
  expanded: boolean;
  onToggle: () => void;
  profileName: (id: string) => string;
  correctOptionId: string | undefined;
}) {
  const correctOption = item.options.find((o) => o.id === correctOptionId);
  const answers = Object.entries(item.responsesByParticipant);
  const Icon = SLOT_ICON[item.question.slot ?? ""] ?? Sun;
  const extra = answers.map(([pid]) => item.extrasByParticipant[pid]).find((e) => e != null);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-4 text-left">
        <div className="text-muted-foreground">
          <Icon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {(SLOT_LABEL as Record<string, string>)[item.question.slot ?? ""] ?? ""}
          </p>
          <p className="mt-0.5 text-[15px] font-medium leading-snug text-foreground">{item.question.prompt}</p>
        </div>
        <ChevronDown
          size={15}
          className={`shrink-0 text-disabled transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-secondary px-4 pb-5 pt-4">
          {correctOption && (
            <div className="rounded-xl bg-accent px-3.5 py-3">
              <p className="text-[13px] font-semibold text-primary">Răspuns: {correctOption.label}</p>
            </div>
          )}
          {item.question.common_core && (
            <p className="text-[13px] leading-relaxed text-secondary-foreground">{item.question.common_core}</p>
          )}
          {item.question.one_thing && (
            <div className="rounded-xl bg-background px-3.5 py-3">
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-disabled">The One Thing</p>
              <p className="text-[13px] leading-relaxed text-secondary-foreground">{item.question.one_thing}</p>
            </div>
          )}
          {extra && (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                {extra.extra_type ? EXTRA_TYPE_LABEL[extra.extra_type] : "EXTRA"}
              </span>
              <p className="text-[13px] leading-relaxed text-secondary-foreground">
                {extra.description ?? extra.title}
              </p>
            </div>
          )}
          {item.exploreLinks.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-disabled">🐇 Explorează</p>
              {item.exploreLinks.map((link) => (
                <a
                  key={link.id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-[13px] text-primary hover:underline"
                >
                  <ExternalLink size={12} />
                  {link.title}
                </a>
              ))}
            </div>
          )}
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-disabled">Răspunsuri</p>
            {answers.map(([participantId, response]) => {
              const chosen = item.options.find((o) => o.id === response.selected_option_id);
              return (
                <div
                  key={participantId}
                  className="flex items-center justify-between border-b border-background py-2 last:border-0"
                >
                  <span className="text-[14px] text-foreground">{profileName(participantId)}</span>
                  <span className="text-[13px] font-medium">
                    {response.is_correct ? (
                      <span className="text-primary">{chosen?.label ?? "—"} · Corect</span>
                    ) : (
                      <span className="text-muted-foreground">{chosen?.label ?? "—"} · Aproape</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BattleRow({
  item,
  expanded,
  onToggle,
  correctOptions,
}: {
  item: BattleHistoryItem;
  expanded: boolean;
  onToggle: () => void;
  correctOptions: Map<string, string>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-4 text-left">
        <div className="text-muted-foreground">
          <Moon size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Battle</p>
          <p className="mt-0.5 text-[15px] font-medium text-foreground">{item.battle.title}</p>
        </div>
        <ChevronDown
          size={15}
          className={`shrink-0 text-disabled transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-secondary px-4 pb-5 pt-4">
          <p className="text-[15px] font-semibold text-foreground">
            PĂRINȚI {Math.round(item.score.adults)} — COPII {Math.round(item.score.kids)}
          </p>
          <div className="flex flex-col gap-2">
            {item.questions.map(({ question, options }) => {
              const correctOption = options.find((o) => o.id === correctOptions.get(question.id));
              return (
                <div key={question.id} className="rounded-xl bg-background px-3.5 py-3">
                  <p className="mb-1 text-[14px] text-foreground">{question.prompt}</p>
                  <p className="text-[13px] font-semibold text-primary">{correctOption?.label ?? "—"}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
