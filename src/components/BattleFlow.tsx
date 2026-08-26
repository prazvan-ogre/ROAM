"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Moon } from "lucide-react";
import type { BattleContent } from "@/lib/battle";
import { recordTeamAnswer } from "@/lib/battle";
import type { AnswerOption } from "@/lib/discover";
import { trackEvent } from "@/lib/analytics";
import type { BattleTeam } from "@/lib/supabase/types";
import { Btn, FlowHeader, OptionButton } from "@/components/ui";

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
  const router = useRouter();
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

  function goHome() {
    router.push(`/trip/${slug}`);
  }

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
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label="Battle" icon={<Moon size={15} />} onClose={goHome} />
        <div className="flex flex-1 flex-col gap-6">
          <div>
            <h1 className="mb-3 text-[28px] font-semibold tracking-tight text-foreground">{content.battle.title}</h1>
            <p className="text-[16px] leading-relaxed text-muted-foreground">
              Părinții pretind că au experiență. Copiii pretind că știu tot. Să verificăm. 😈
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
            <div className="flex items-center justify-between">
              <div className="flex-1 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                  <span className="text-[20px]">👨‍👩‍👧</span>
                </div>
                <p className="text-[13px] font-semibold text-foreground">Adulți</p>
              </div>
              <div className="text-[20px] font-light text-disabled">vs</div>
              <div className="flex-1 text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-secondary">
                  <span className="text-[20px]">🧒</span>
                </div>
                <p className="text-[13px] font-semibold text-foreground">Copii</p>
              </div>
            </div>
          </div>
          <div className="mt-auto pt-4">
            <Btn onClick={handleStart}>HAI LA BATTLE</Btn>
          </div>
        </div>
      </main>
    );
  }

  if (!current) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6 text-center text-muted-foreground">
        Battle-ul nu are întrebări încă.
      </main>
    );
  }

  if (step === "parents" || step === "kids") {
    const team: BattleTeam = step === "parents" ? "adults" : "kids";
    const selected = step === "parents" ? parentsSelected : kidsSelected;
    const setSelected = step === "parents" ? setParentsSelected : setKidsSelected;

    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label="Battle" icon={<Moon size={15} />} onClose={goHome} />
        <div className="flex flex-1 flex-col gap-5">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                Rândul {TEAM_LABEL[team]}
              </span>
              <span className="text-[12px] font-medium text-disabled">
                {questionIndex + 1} / {content.questions.length}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-disabled">
              {step === "parents" ? "Copiii nu se uită." : "Adulții au răspuns. Acum e rândul vostru."}
            </p>
          </div>
          <h2 className="text-[20px] font-semibold leading-snug tracking-tight text-foreground">{current.question.prompt}</h2>
          <div className="flex flex-col gap-2">
            {current.options.map((opt) => (
              <OptionButton key={opt.id} label={opt.label} selected={selected?.id === opt.id} onSelect={() => setSelected(opt)} />
            ))}
          </div>
          <div className="mt-auto pt-4">
            <Btn onClick={() => handleTeamSubmit(team)} disabled={!selected || submitting}>
              {submitting ? "..." : "RĂSPUNDE"}
            </Btn>
          </div>
        </div>
      </main>
    );
  }

  if (step === "reveal") {
    const revealMessage = parentsCorrect || kidsCorrect
      ? current.question.correct_reveal_message
      : current.question.alternative_reveal_message;
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
        <FlowHeader label="Battle" icon={<Moon size={15} />} onClose={goHome} />
        <div className="flex flex-1 flex-col gap-5">
          <h3 className="text-[18px] font-semibold leading-snug tracking-tight text-foreground">{current.question.prompt}</h3>
          <div className="rounded-xl bg-accent px-4 py-3">
            <p className="text-[13px] font-semibold text-primary">
              Răspuns: {current.options.find((o) => o.is_correct)?.label}
            </p>
          </div>
          <div className="flex gap-3">
            <TeamRevealCard
              label="Adulți"
              correct={parentsCorrect}
              answer={parentsSelected?.label ?? "—"}
            />
            <TeamRevealCard
              label="Copii"
              correct={kidsCorrect}
              answer={kidsSelected?.label ?? "—"}
            />
          </div>
          {revealMessage && <p className="text-[15px] leading-relaxed text-secondary-foreground">{revealMessage}</p>}
          <div className="mt-auto pt-4">
            <Btn onClick={handleNext}>{isLastQuestion ? "VEZI SCORUL" : "URMĂTOAREA ÎNTREBARE"}</Btn>
          </div>
        </div>
      </main>
    );
  }

  // step === "result"
  const winner = tally.kids > tally.adults ? "kids" : tally.adults > tally.kids ? "adults" : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col px-5 pb-12 pt-14">
      <FlowHeader label="Battle" icon={<Moon size={15} />} onClose={goHome} />
      <div className="flex flex-1 flex-col gap-6 pt-4 text-center">
        {isFinal ? (
          <>
            <p className="text-[28px] font-bold uppercase tracking-tight text-foreground">
              {winner === "kids" && "🏆 Copiii câștigă"}
              {winner === "adults" && "🏆 Părinții câștigă"}
              {winner === null && "🤝 Egalitate"}
            </p>
            <div className="text-[56px] font-semibold leading-none tracking-tight text-foreground">
              {tally.adults} — {tally.kids}
            </div>
          </>
        ) : (
          <>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Scor final</p>
            <div className="text-[56px] font-semibold leading-none tracking-tight text-foreground">
              {tally.adults} — {tally.kids}
            </div>
            <div className="flex justify-center gap-8">
              <span className="text-[13px] text-muted-foreground">Adulți</span>
              <span className="text-[13px] text-muted-foreground">Copii</span>
            </div>
            <div className="h-px bg-secondary" />
            <p className="text-[17px] leading-relaxed text-secondary-foreground">
              {winner === "kids" && "Copiii conduc azi. Părinți, situația începe să devină puțin jenantă."}
              {winner === "adults" && "Se pare că experiența de viață încă valorează ceva."}
              {winner === null && "Egalitate azi — revanșa e mâine seară."}
            </p>
          </>
        )}

        <div className="pt-2">
          <Btn onClick={isFinal ? onFinished : goHome}>{isFinal ? "CONTINUĂ" : "ÎNAPOI ACASĂ"}</Btn>
        </div>
      </div>
    </main>
  );
}

function TeamRevealCard({ label, correct, answer }: { label: string; correct: boolean; answer: string }) {
  return (
    <div
      className={`flex-1 rounded-2xl border p-4 text-center transition-all ${
        correct ? "border-primary/25 bg-accent" : "border-border bg-background"
      }`}
    >
      <div className={`mb-1.5 text-[18px] font-semibold ${correct ? "text-primary" : "text-disabled"}`}>
        {correct ? "✓" : "✗"}
      </div>
      <p className="text-[13px] font-semibold text-foreground">{label}</p>
      <p className="mt-1 text-[12px] leading-tight text-muted-foreground">{answer}</p>
    </div>
  );
}
