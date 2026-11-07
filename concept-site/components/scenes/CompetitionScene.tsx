"use client";

import { AnimatePresence, motion, useInView } from "framer-motion";
import { Copy, PauseCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Scene } from "@/components/ui/Scene";
import { Pill, Window } from "@/components/ui/primitives";
import { sceneById } from "@/lib/story";

const ease = [0.22, 1, 0.36, 1] as const;

type Source = "Customer" | "Sales" | "Ops" | "Support" | "Finance" | "Marketing" | "Leadership";
type Req = { id: number; title: string; source: Source; twin?: string; state?: "paused" };

const POOL: Omit<Req, "id">[] = [
  { title: "AI assistant for proposal writing", source: "Sales", twin: "proposal" },
  { title: "Export dashboards to Excel", source: "Customer" },
  { title: "Automate invoice matching", source: "Finance" },
  { title: "Chatbot for the help centre", source: "Support", twin: "chatbot" },
  { title: "Agent that drafts RFP answers", source: "Sales", twin: "proposal" },
  { title: "Onboarding checklist app", source: "Ops" },
  { title: "Campaign copy generator", source: "Marketing" },
  { title: "Support reply copilot", source: "Support", twin: "chatbot" },
  { title: "Board-ready KPI summary", source: "Leadership" },
  { title: "SSO for contractor accounts", source: "Customer" },
  { title: "Contract clause checker", source: "Ops" },
];

const SOURCE_HUE: Record<Source, string> = {
  Customer: "bg-accent",
  Sales: "bg-ink",
  Ops: "bg-ink-muted",
  Support: "bg-accent-glow",
  Finance: "bg-ink-soft",
  Marketing: "bg-accent-deep",
  Leadership: "bg-ink-faint",
};

const MAX = 6;

function useBacklog(active: boolean) {
  const [items, setItems] = useState<Req[]>(() => POOL.slice(0, 3).map((r, i) => ({ ...r, id: i })));
  const [waiting, setWaiting] = useState(9);
  const [paused, setPaused] = useState(0);
  const [shifts, setShifts] = useState(14);
  const next = useRef(3);

  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => {
      setItems((prev) => {
        const r = POOL[next.current % POOL.length];
        const item: Req = { ...r, id: next.current };
        next.current += 1;
        const list = [...prev];
        // new work jumps the queue at a random spot near the top
        list.splice(Math.floor(Math.random() * Math.min(3, list.length + 1)), 0, item);
        // something gets parked to make room
        if (list.length > MAX) {
          const victim = list.findIndex((x, i) => i > 1 && x.state !== "paused");
          if (victim > -1) list[victim] = { ...list[victim], state: "paused" };
          const firstPaused = list.findIndex((x) => x.state === "paused");
          if (list.filter((x) => x.state === "paused").length > 1 && firstPaused > -1) {
            list.splice(firstPaused, 1);
            setPaused((p) => p + 1);
          }
        }
        return list.slice(0, MAX + 1);
      });
      setWaiting((w) => w + 1 + Math.round(Math.random()));
      setShifts((x) => x + 1);
    }, 1900);
    return () => window.clearInterval(t);
  }, [active]);

  return { items, waiting, paused, shifts };
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-[11px] text-ink-muted">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-ink">{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
        <motion.div
          className={`h-full rounded-full ${value > 95 ? "bg-warn" : "bg-ink"}`}
          animate={{ width: `${Math.min(100, value)}%` }}
          transition={{ duration: 1.2, ease }}
        />
      </div>
    </div>
  );
}

function Board() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const { items, waiting, paused, shifts } = useBacklog(inView);
  const load = Math.min(100, 82 + items.length * 2 + (waiting % 5));
  const twins = new Map<string, number>();
  items.forEach((x) => x.twin && x.state !== "paused" && twins.set(x.twin, (twins.get(x.twin) ?? 0) + 1));

  return (
    <div ref={ref} className="relative">
      <Window
        title="Shared backlog · Q3"
        right={
          <span className="font-mono text-[11px] text-ink-faint">
            <motion.span key={waiting} initial={{ opacity: 0.2 }} animate={{ opacity: 1 }} className="text-ink">
              +{waiting}
            </motion.span>{" "}
            waiting
          </span>
        }
      >
        <div className="flex gap-4 border-b border-line-soft px-5 py-4 sm:gap-6">
          <Meter label="Team time" value={load} />
          <Meter label="Attention" value={Math.min(100, load + 4)} />
          <Meter label="Budget" value={Math.max(70, load - 6)} />
        </div>
        <ol className="relative min-h-[392px] space-y-2 p-3 sm:p-4">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((r, i) => {
              const isDup = r.twin && (twins.get(r.twin) ?? 0) > 1 && r.state !== "paused";
              const isPaused = r.state === "paused";
              return (
                <motion.li
                  layout
                  key={r.id}
                  initial={{ opacity: 0, x: 80, scale: 0.96 }}
                  animate={{ opacity: isPaused ? 0.45 : 1, x: 0, scale: 1 }}
                  exit={{ opacity: 0, x: -40, transition: { duration: 0.35 } }}
                  transition={{ type: "spring", stiffness: 260, damping: 28 }}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 sm:px-4 ${
                    isDup ? "border-dashed border-warn/50 bg-warn-soft/40" : "border-line bg-paper"
                  }`}
                >
                  <span className="w-5 font-mono text-[11px] tabular-nums text-ink-faint">{i + 1}</span>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${SOURCE_HUE[r.source]}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-[13px] font-medium ${isPaused ? "text-ink-muted line-through decoration-ink-faint" : "text-ink"}`}>
                      {r.title}
                    </p>
                    <p className="text-[11px] text-ink-faint">{r.source}</p>
                  </div>
                  {isDup && (
                    <Pill tone="warn" className="hidden sm:inline-flex">
                      <Copy size={11} /> Similar work exists
                    </Pill>
                  )}
                  {isPaused && (
                    <Pill className="hidden sm:inline-flex">
                      <PauseCircle size={11} /> On hold
                    </Pill>
                  )}
                  {!isDup && !isPaused && i === 0 && <Pill tone="dark">Now</Pill>}
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
        <div className="flex items-center justify-between border-t border-line-soft px-5 py-3 text-[11px] text-ink-faint">
          <span>Priorities reshuffled {shifts} times this quarter</span>
          <span>{paused + 2} items left unfinished</span>
        </div>
      </Window>

    </div>
  );
}

export function CompetitionScene() {
  return (
    <Scene
      scene={sceneById("competition")}
      aside={
        <ul className="space-y-2.5 text-[14px] text-ink-soft">
          {["Do we already have something similar?", "What problem are we solving?", "What are we putting on hold?"].map((q) => (
            <li key={q} className="flex items-center gap-3">
              <span className="h-px w-5 bg-accent" />
              {q}
            </li>
          ))}
        </ul>
      }
    >
      <Board />
    </Scene>
  );
}
