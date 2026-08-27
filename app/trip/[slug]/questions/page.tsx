"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronDown, Sun, Utensils, Moon, ExternalLink } from "lucide-react";
import { getTripBySlug, currentTripDay, type Trip } from "@/lib/trip";
import { listProfilesForDevice, type Participant } from "@/lib/participant";
import {
  getTripHistory,
  type TripHistory,
  type DiscoverHistoryItem,
  type BattleHistoryItem,
} from "@/lib/history";
import { TripNav } from "@/components/TripNav";
import { Centered } from "@/components/ui";

type Step = "loading" | "error" | "not-joined" | "ready";

const SLOT_LABEL: Record<string, string> = { morning: "Dimineață", lunch: "Prânz" };
const SLOT_ICON: Record<string, typeof Sun> = { morning: Sun, lunch: Utensils };
const EXTRA_TYPE_LABEL: Record<string, string> = {
  know: "ȘTIAI CĂ",
  think: "GÂNDEȘTE-TE",
  connect: "CONEXIUNE",
  ask: "ÎNTREABĂ",
  explore: "EXPLOREAZĂ",
};
const FINAL_TAB = "final";

export default function QuestionsPage() {
  const { slug } = useParams<{ slug: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [profiles, setProfiles] = useState<Participant[]>([]);
  const [history, setHistory] = useState<TripHistory | null>(null);
  const [selectedTab, setSelectedTab] = useState<number | typeof FINAL_TAB | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

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

        const h = await getTripHistory(t.id, currentTripDay(t), list.map((p) => p.id));
        if (cancelled) return;
        setHistory(h);
        setStep("ready");
      } catch {
        if (!cancelled) setStep("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

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
          />
        ))}
        {battlesForTab.map((item) => (
          <BattleRow
            key={item.battle.id}
            item={item}
            expanded={expandedIds.has(item.battle.id)}
            onToggle={() => toggle(item.battle.id)}
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
}: {
  item: DiscoverHistoryItem;
  expanded: boolean;
  onToggle: () => void;
  profileName: (id: string) => string;
}) {
  const correctOption = item.options.find((o) => o.is_correct);
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
            {SLOT_LABEL[item.question.slot ?? ""] ?? ""}
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
}: {
  item: BattleHistoryItem;
  expanded: boolean;
  onToggle: () => void;
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
              const correctOption = options.find((o) => o.is_correct);
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
