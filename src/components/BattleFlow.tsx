"use client";

import { useState } from "react";
import Link from "next/link";
import type { BattleContent } from "@/lib/battle";
import { recordTeamAnswer } from "@/lib/battle";
import type { AnswerOption } from "@/lib/discover";
import { trackEvent } from "@/lib/analytics";
import type { BattleTeam } from "@/lib/supabase/types";

type Step = "intro" | "parents" | "kids" | "reveal" | "result";

const TEAM_LABEL: Record<BattleTeam, string> = { adults: "Părinților", kids: "Copiilor" };

export function BattleFlow({
  content,
  tripId,
  slug,
  isFinal,
  onFinished,
}: {
  content: BattleContent;
  tripId: string;
  slug: string;
  isFinal: boolean;
  onFinished?: () => void;
}) {
  const [step, setStep] = useState<Step>("intro");
  const [questionIndex, setQuestionIndex] = useState(0);
  const [parentsSelected, setParentsSelected] = useState<AnswerOption | null>(null);
  const [kidsSelected, setKidsSelected] = useState<AnswerOption | null>(null);
  const [parentsCorrect, setParentsCorrect] = useState(false);
  const [kidsCorrect, setKidsCorrect] = useState(false);
  const [tally, setTally] = useState({ adults: 0, kids: 0 });
  const [submitting, setSubmitting] = useState(false);

  const current = content.questions[questionIndex];
  const isLastQuestion = questionIndex === content.questions.length - 1;

  async function handleStart() {
    await trackEvent(tripId, "battle_opened", undefined, { battle_id: content.battle.id });
    setStep("parents");
  }

  async function handleTeamSubmit(team: BattleTeam) {
    const selected = team === "adults" ? parentsSelected : kidsSelected;
    if (!selected || !current) return;
    setSubmitting(true);
    try {
      const isCorrect = selected.is_correct;
      await recordTeamAnswer(content.battle.id, team, isCorrect);
      await trackEvent(tripId, "battle_answered", undefined, {
        battle_id: content.battle.id,
        question_id: current.question.id,
        team,
      });
      if (team === "adults") {
        setParentsCorrect(isCorrect);
        setStep("kids");
      } else {
        setKidsCorrect(isCorrect);
        setTally((t) => ({
          adults: t.adults + (parentsCorrect ? 1 : 0),
          kids: t.kids + (isCorrect ? 1 : 0),
        }));
        setStep("reveal");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleNext() {
    if (isLastQuestion) {
      if (isFinal) {
        await trackEvent(tripId, "final_battle_completed", undefined, { battle_id: content.battle.id });
      }
      setStep("result");
    } else {
      setQuestionIndex((i) => i + 1);
      setParentsSelected(null);
      setKidsSelected(null);
      setStep("parents");
    }
  }

  if (step === "intro") {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12 text-center">
        <h1 className="text-3xl font-bold uppercase tracking-wide">{content.battle.title}</h1>
        <p className="text-lg text-slate-700">
          Părinții pretind că au experiență.
          <br />
          Copiii pretind că știu tot.
          <br />
          Să verificăm. 😈
        </p>
        <button
          onClick={handleStart}
          className="rounded-xl bg-slate-900 px-4 py-3 text-lg font-semibold text-white"
        >
          HAI LA BATTLE
        </button>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 text-center text-slate-600">
        Battle-ul nu are întrebări încă.
      </main>
    );
  }

  if (step === "parents" || step === "kids") {
    const team: BattleTeam = step === "parents" ? "adults" : "kids";
    const selected = step === "parents" ? parentsSelected : kidsSelected;
    const setSelected = step === "parents" ? setParentsSelected : setKidsSelected;

    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
        <p className="text-center text-sm font-medium uppercase tracking-wide text-slate-500">
          Rândul {TEAM_LABEL[team]}
        </p>
        <h1 className="text-xl font-semibold leading-snug">{current.question.prompt}</h1>
        <div className="flex flex-col gap-3">
          {current.options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSelected(opt)}
              className={`rounded-xl border px-4 py-3 text-left text-lg ${
                selected?.id === opt.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => handleTeamSubmit(team)}
          disabled={!selected || submitting}
          className="mt-auto rounded-xl bg-slate-900 px-4 py-3 text-lg font-semibold text-white disabled:opacity-40"
        >
          {submitting ? "..." : "RĂSPUNDE"}
        </button>
      </main>
    );
  }

  if (step === "reveal") {
    const revealMessage = parentsCorrect || kidsCorrect
      ? current.question.correct_reveal_message
      : current.question.alternative_reveal_message;
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 px-6 py-10">
        <div className="flex justify-center gap-8 text-lg">
          <span>Părinți {parentsCorrect ? "✓" : "✗"}</span>
          <span>Copii {kidsCorrect ? "✓" : "✗"}</span>
        </div>
        {revealMessage && <p className="text-center text-xl">{revealMessage}</p>}
        <button
          onClick={handleNext}
          className="mt-auto rounded-xl bg-slate-900 px-4 py-3 text-lg font-semibold text-white"
        >
          {isLastQuestion ? "VEZI SCORUL" : "URMĂTOAREA ÎNTREBARE"}
        </button>
      </main>
    );
  }

  // step === "result"
  const winner =
    tally.kids > tally.adults ? "kids" : tally.adults > tally.kids ? "adults" : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 py-12 text-center">
      {isFinal ? (
        <>
          <p className="text-3xl font-bold uppercase">
            {winner === "kids" && "🏆 Copiii câștigă"}
            {winner === "adults" && "🏆 Părinții câștigă"}
            {winner === null && "🤝 Egalitate"}
          </p>
          <p className="text-2xl font-semibold">
            {tally.adults} — {tally.kids}
          </p>
        </>
      ) : (
        <>
          <p className="text-2xl font-semibold">
            PĂRINȚI {tally.adults} — COPII {tally.kids}
          </p>
          <p className="text-slate-600">
            {winner === "kids" && "Copiii conduc azi. Părinți, situația începe să devină puțin jenantă."}
            {winner === "adults" && "Se pare că experiența de viață încă valorează ceva."}
            {winner === null && "Egalitate azi — reveanșa e mâine seară."}
          </p>
        </>
      )}

      {isFinal ? (
        <button
          onClick={onFinished}
          className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-lg font-semibold text-white"
        >
          CONTINUĂ
        </button>
      ) : (
        <Link
          href={`/trip/${slug}`}
          className="mt-4 rounded-xl bg-slate-900 px-4 py-3 text-lg font-semibold text-white"
        >
          ÎNAPOI ACASĂ
        </Link>
      )}
    </main>
  );
}
