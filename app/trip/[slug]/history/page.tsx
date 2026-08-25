"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { getTripBySlug, currentTripDay, type Trip } from "@/lib/trip";
import { listProfilesForDevice, type Participant } from "@/lib/participant";
import { getTripHistory, type TripHistory } from "@/lib/history";

type Step = "loading" | "error" | "not-joined" | "ready";

const SLOT_LABEL: Record<string, string> = { morning: "Dimineață", lunch: "Prânz" };

export default function HistoryPage() {
  const { slug } = useParams<{ slug: string }>();

  const [step, setStep] = useState<Step>("loading");
  const [trip, setTrip] = useState<Trip | null>(null);
  const [profiles, setProfiles] = useState<Participant[]>([]);
  const [history, setHistory] = useState<TripHistory | null>(null);

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

  if (!history) return <Centered>Se încarcă...</Centered>;

  const profileName = (id: string) => profiles.find((p) => p.id === id)?.display_name ?? "?";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-8 px-6 py-10">
      <header className="text-center">
        <h1 className="text-2xl font-semibold">Istoric</h1>
        <p className="mt-1 text-slate-600">{trip?.name}</p>
      </header>

      {history.discover.length === 0 && history.battles.length === 0 && (
        <p className="text-center text-slate-500">Nimic de arătat încă.</p>
      )}

      {history.discover.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Discover</h2>
          {history.discover.map((item) => {
            const correctOption = item.options.find((o) => o.is_correct);
            const answers = Object.entries(item.responsesByParticipant);
            return (
              <div key={item.question.id} className="rounded-2xl border border-slate-200 px-5 py-4">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Ziua {item.question.day_number} · {SLOT_LABEL[item.question.slot ?? ""] ?? ""}
                </p>
                <p className="mt-1 font-medium leading-snug">{item.question.prompt}</p>
                {correctOption && (
                  <p className="mt-2 text-sm text-emerald-600">Răspuns corect: {correctOption.label}</p>
                )}
                {item.question.one_thing && (
                  <p className="mt-2 rounded-xl bg-slate-100 px-3 py-2 text-sm">{item.question.one_thing}</p>
                )}
                {answers.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-600">
                    {answers.map(([participantId, response]) => {
                      const chosen = item.options.find((o) => o.id === response.selected_option_id);
                      return (
                        <li key={participantId}>
                          {profileName(participantId)}: {chosen?.label ?? "—"}{" "}
                          {response.is_correct ? "✓" : "✗"}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}

      {history.battles.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Battle</h2>
          {history.battles.map((item) => (
            <div key={item.content.battle.id} className="rounded-2xl border border-slate-200 px-5 py-4">
              <p className="font-medium">{item.content.battle.title}</p>
              <p className="mt-1 text-sm text-slate-600">
                PĂRINȚI {item.leaderboard.adults} — COPII {item.leaderboard.kids}
              </p>
              <ul className="mt-2 flex flex-col gap-1 text-sm text-slate-600">
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
          ))}
        </section>
      )}

      <Link
        href={`/trip/${slug}`}
        className="mt-auto rounded-xl bg-slate-900 px-4 py-3 text-center text-lg font-semibold text-white"
      >
        ÎNAPOI ACASĂ
      </Link>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-6 text-center text-slate-600">
      {children}
    </main>
  );
}
