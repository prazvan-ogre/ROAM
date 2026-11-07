"use client";

import { AnimatePresence, motion, useInView } from "framer-motion";
import { Copy, Rocket, Sparkles, TrendingUp, Archive, Combine, Wrench, Target, Activity } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Scene } from "@/components/ui/Scene";
import { Avatar, Pill, Sparkline, Window, useTicker } from "@/components/ui/primitives";
import { PRODUCT, sceneById } from "@/lib/story";

const ease = [0.22, 1, 0.36, 1] as const;

type Decision = "Expand" | "Improve" | "Combine" | "Retire";
const DECISIONS: { key: Decision; icon: typeof Rocket }[] = [
  { key: "Expand", icon: Rocket },
  { key: "Improve", icon: Wrench },
  { key: "Combine", icon: Combine },
  { key: "Retire", icon: Archive },
];

const ALERTS: {
  icon: typeof Copy;
  title: string;
  item: string;
  evidence: string;
  spark: number[];
  suggested: Decision;
}[] = [
  {
    icon: Copy,
    title: "Another team already uses a similar agent.",
    item: "Contract Q&A Bot · Legal",
    evidence: "86% overlap with Proposal Writer · both cost $2.1k/mo",
    spark: [4, 5, 5, 6, 6, 7, 7, 8],
    suggested: "Combine",
  },
  {
    icon: TrendingUp,
    title: "Running costs are rising. Usage is unchanged.",
    item: "Meeting Notes Agent · Ops",
    evidence: "Cost +46% in 90 days · 3 weekly users",
    spark: [3, 4, 4, 5, 6, 7, 8, 9],
    suggested: "Retire",
  },
  {
    icon: Target,
    title: "The new feature hasn’t yet delivered the expected improvement.",
    item: "Smart Search · Product",
    evidence: "Goal: −30% ‘how do I’ tickets · so far −4%",
    spark: [6, 6, 5, 6, 6, 5, 6, 6],
    suggested: "Improve",
  },
];

function LiveStrip({ active }: { active: boolean }) {
  const t = useTicker(1000, active);
  const stats = [
    { icon: Activity, label: "Initiatives monitored", value: "38" },
    { icon: TrendingUp, label: "Running cost this month", value: `$${(61_240 + t * 7).toLocaleString("en-US")}` },
    { icon: Target, label: "On track to goal", value: "24 of 31" },
  ];
  return (
    <div className="grid grid-cols-3 gap-px border-b border-line-soft bg-line-soft">
      {stats.map(({ icon: Icon, label, value }) => (
        <div key={label} className="bg-paper px-4 py-3">
          <p className="flex items-center gap-1.5 truncate text-[11px] text-ink-muted">
            <Icon size={11} />
            <span className="truncate">{label}</span>
          </p>
          <p className="font-mono text-[14px] tabular-nums text-ink sm:text-[15px]">{value}</p>
        </div>
      ))}
    </div>
  );
}

function Monitor() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const [shown, setShown] = useState(0);
  const [decided, setDecided] = useState<(Decision | null)[]>([null, null, null]);
  const [touched, setTouched] = useState(false);

  // alerts arrive one by one, then the team reviews and decides
  useEffect(() => {
    if (!inView) return;
    const timers: number[] = [];
    ALERTS.forEach((_, i) => timers.push(window.setTimeout(() => setShown((s) => Math.max(s, i + 1)), 600 + i * 1300)));
    if (!touched) {
      ALERTS.forEach((a, i) =>
        timers.push(
          window.setTimeout(
            () => setDecided((d) => d.map((x, j) => (j === i && !x ? a.suggested : x))),
            5200 + i * 900,
          ),
        ),
      );
    }
    return () => timers.forEach(window.clearTimeout);
  }, [inView, touched]);

  const doneCount = decided.filter(Boolean).length;

  return (
    <div ref={ref}>
      <Window title={`${PRODUCT.name} · Monitoring`} right={<Pill tone="accent"><Sparkles size={11} /> 3 new signals</Pill>}>
        <LiveStrip active={inView} />
        <ul className="space-y-2.5 p-3 sm:p-4">
          <AnimatePresence>
            {ALERTS.slice(0, shown).map((a, i) => {
              const Icon = a.icon;
              return (
                <motion.li
                  key={a.title}
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.6, ease }}
                  className="rounded-xl border border-line bg-paper p-3.5 sm:p-4"
                >
                  <div className="flex gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-warn-soft text-warn">
                      <Icon size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold leading-snug">{a.title}</p>
                      <p className="mt-0.5 text-[11.5px] text-ink-muted">
                        <span className="text-ink-soft">{a.item}</span> · {a.evidence}
                      </p>
                    </div>
                    <Sparkline points={a.spark} stroke={i === 1 ? "#D97706" : "#A1A1AA"} className="hidden h-6 w-16 shrink-0 sm:block" />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5 pl-11" role="group" aria-label={`Decision for ${a.item}`}>
                    {DECISIONS.map(({ key, icon: DIcon }) => {
                      const on = decided[i] === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => {
                            setTouched(true);
                            setDecided((d) => d.map((x, j) => (j === i ? (x === key ? null : key) : x)));
                          }}
                          aria-pressed={on}
                          className={`relative inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all duration-300 ease-cine ${
                            on ? "border-ink bg-ink text-paper" : "border-line text-ink-muted hover:border-ink-faint hover:text-ink"
                          }`}
                        >
                          <DIcon size={11} />
                          {key}
                        </button>
                      );
                    })}
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
        <div className="flex items-center gap-3 border-t border-line-soft px-4 py-3">
          <div className="flex -space-x-1.5">
            <Avatar initials="MR" hue={245} />
            <Avatar initials="JK" hue={200} />
            <Avatar initials="LP" hue={160} />
          </div>
          <p className="flex-1 text-[12px] text-ink-muted">
            Portfolio review ·{" "}
            <span className="text-ink">
              {doneCount} of {ALERTS.length} decided
            </span>
          </p>
          <AnimatePresence>
            {doneCount === ALERTS.length && (
              <motion.span initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <Pill tone="ok">Saves ~$3.3k / month</Pill>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </Window>
    </div>
  );
}

export function AfterScene() {
  return (
    <Scene
      scene={sceneById("after")}
      layout="reverse"
      aside={
        <div className="flex flex-wrap gap-2">
          {DECISIONS.map(({ key, icon: Icon }) => (
            <span key={key} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-[12px] font-medium text-ink-soft">
              <Icon size={12} className="text-accent" />
              {key}
            </span>
          ))}
        </div>
      }
    >
      <Monitor />
    </Scene>
  );
}
