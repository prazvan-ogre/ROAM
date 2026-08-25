"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripBySlug, currentTripDay, type Trip } from "@/lib/trip";
import { listProfilesForDevice, type Participant } from "@/lib/participant";
import {
  getTripHistory,
  type TripHistory,
  type DiscoverHistoryItem,
  type BattleHistoryItem,
} from "@/lib/history";
import { TripNav } from "@/components/TripNav";

type Step = "loading" | "error" | "not-joined" | "ready";

const SLOT_LABEL: Record<string, string> = { morning: "Dimineață", lunch: "Prânz" };
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
      if (!item.content.battle.is_final && item.content.battle.day_number != null) {
        dayNumbers.add(item.content.battle.day_number);
      }
    }
    return Array.from(dayNumbers).sort((a, b) => a - b);
  }, [history]);

  const hasFinal = useMemo(
    () => (history?.battles ?? []).some((b) => b.content.battle.is_final),
    [history],
  );

  useEffect(() => {
    if (selectedTab !== null) return;
    if (days.length > 0) setSelectedTab(days[days.length - 1]);
    else if (hasFinal) setSelectedTab(FINAL_TAB);
  }, [days, hasFinal, selectedTab]);

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
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
        <h1 className="text-center text-2xl font-semibold">Întrebări</h1>
        <p className="text-center text-slate-500">Nimic de arătat încă.</p>
        <TripNav slug={slug} />
      </main>
    );
  }

  const profileName = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? "?";

  const discoverForTab = history.discover.filter(
    (item) => item.question.day_number === selectedTab,
  );
  const battlesForTab = history.battles.filter((item) =>
    selectedTab === FINAL_TAB
      ? item.content.battle.is_final
      : item.content.battle.day_number === selectedTab,
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
      <h1 className="text-center text-2xl font-semibold">Întrebări</h1>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {days.map((d) => (
          <button
            key={d}
            onClick={() => setSelectedTab(d)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium ${
              selectedTab === d ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
            }`}
          >
            Ziua {d}
          </button>
        ))}
        {hasFinal && (
          <button
            onClick={() => setSelectedTab(FINAL_TAB)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium ${
              selectedTab === FINAL_TAB ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
            }`}
          >
            Final
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
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
            key={item.content.battle.id}
            item={item}
            expanded={expandedIds.has(item.content.battle.id)}
            onToggle={() => toggle(item.content.battle.id)}
          />
        ))}
        {discoverForTab.length === 0 && battlesForTab.length === 0 && (
          <p className="text-center text-slate-400">Nimic pentru această zi.</p>
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

  return (
    <div className="rounded-2xl border border-slate-200 px-5 py-4">
      <button onClick={onToggle} className="flex w-full items-center justify-between text-left">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {SLOT_LABEL[item.question.slot ?? ""] ?? ""}
          </p>
          <p className="mt-1 font-medium leading-snug">{item.question.prompt}</p>
        </div>
        <span className="ml-3 shrink-0 text-slate-400">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3">
          {correctOption && (
            <p className="text-sm text-emerald-600">Răspuns corect: {correctOption.label}</p>
          )}
          {item.question.one_thing && (
            <p className="rounded-xl bg-slate-100 px-3 py-2 text-sm">{item.question.one_thing}</p>
          )}
          {answers.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm text-slate-600">
              {answers.map(([participantId, response]) => {
                const chosen = item.options.find((o) => o.id === response.selected_option_id);
                return (
                  <li key={participantId}>
                    {profileName(participantId)}: {chosen?.label ?? "—"} {response.is_correct ? "✓" : "✗"}
                  </li>
                );
              })}
            </ul>
          )}
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
    <div className="rounded-2xl border border-slate-200 px-5 py-4">
      <button onClick={onToggle} className="flex w-full items-center justify-between text-left">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Battle</p>
          <p className="mt-1 font-medium">{item.content.battle.title}</p>
        </div>
        <span className="ml-3 shrink-0 text-slate-400">{expanded ? "▾" : "▸"}</span>
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-600">
            PĂRINȚI {item.leaderboard.adults} — COPII {item.leaderboard.kids}
          </p>
          <ul className="flex flex-col gap-1 text-sm text-slate-600">
            {item.content.questions.map(({ question, options }) => {
              const correctOption = options.find((o) => o.is_correct);
              return (
                <li key={question.id}>
                  {question.prompt} — {correctOption?.label ?? "—"}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-slate-600">
      {children}
    </main>
  );
}
