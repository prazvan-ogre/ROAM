"use client";

import { motion, useInView } from "framer-motion";
import { Moon } from "lucide-react";
import { useRef } from "react";
import { Scene } from "@/components/ui/Scene";
import { CountUp, Pill, Sparkline, Window, useTicker } from "@/components/ui/primitives";
import { sceneById } from "@/lib/story";

const ease = [0.22, 1, 0.36, 1] as const;

// Indexed to 100 in January. Features grow ~4x; usage barely moves.
const FEATURES = [100, 100, 140, 160, 160, 210, 250, 260, 300, 330, 360, 400];
const USAGE = [100, 102, 99, 101, 103, 100, 102, 101, 99, 102, 103, 102];
const MONTHS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

function GapChart({ play }: { play: boolean }) {
  const W = 560;
  const H = 220;
  const max = 420;
  const min = 60;
  const x = (i: number) => 12 + (i / (FEATURES.length - 1)) * (W - 24);
  const y = (v: number) => H - ((v - min) / (max - min)) * (H - 20);

  // stepped line for shipped features
  const step = FEATURES.map((v, i) => (i === 0 ? `M${x(0)},${y(v)}` : `H${x(i)} V${y(v)}`)).join(" ");
  const usage = USAGE.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  const gap =
    FEATURES.map((v, i) => (i === 0 ? `M${x(0)},${y(v)}` : `H${x(i)} V${y(v)}`)).join(" ") +
    " " +
    [...USAGE].reverse().map((v, j) => `L${x(USAGE.length - 1 - j)},${y(v)}`).join(" ") +
    " Z";

  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} className="w-full" role="img" aria-label="Features shipped rise while usage stays flat">
      <defs>
        <linearGradient id="gap-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#4F46E5" stopOpacity="0.14" />
          <stop offset="1" stopColor="#4F46E5" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[100, 200, 300, 400].map((v) => (
        <g key={v}>
          <line x1={12} x2={W - 12} y1={y(v)} y2={y(v)} stroke="#F0EFEA" />
        </g>
      ))}
      <motion.path
        d={gap}
        fill="url(#gap-fill)"
        initial={{ opacity: 0 }}
        animate={{ opacity: play ? 1 : 0 }}
        transition={{ delay: 2.2, duration: 1.2 }}
      />
      <motion.path
        d={usage}
        fill="none"
        stroke="#A1A1AA"
        strokeWidth="2"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: play ? 1 : 0 }}
        transition={{ duration: 2.4, ease: [0.45, 0, 0.2, 1] }}
      />
      <motion.path
        d={step}
        fill="none"
        stroke="#4F46E5"
        strokeWidth="2.25"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: play ? 1 : 0 }}
        transition={{ duration: 2.4, ease: [0.45, 0, 0.2, 1] }}
      />
      <motion.g initial={{ opacity: 0 }} animate={{ opacity: play ? 1 : 0 }} transition={{ delay: 2.4, duration: 0.6 }}>
        <text x={x(11) - 4} y={y(400) - 8} textAnchor="end" className="fill-accent text-[11px] font-medium">
          Features shipped ×4
        </text>
        <text x={x(1)} y={y(102) - 10} className="fill-ink-muted text-[11px] font-medium">
          Active usage +2%
        </text>
        <g transform={`translate(${x(7.5)}, ${y(200)})`}>
          <rect x="-44" y="-12" width="88" height="22" rx="11" fill="#FFFFFF" stroke="#E7E6E1" />
          <text textAnchor="middle" y="3" className="fill-ink text-[10.5px] font-semibold">
            The value gap
          </text>
        </g>
      </motion.g>
      {MONTHS.map((m, i) => (
        <text key={i} x={x(i)} y={H + 16} textAnchor="middle" className="fill-ink-faint font-mono text-[10px]">
          {m}
        </text>
      ))}
    </svg>
  );
}

function Kpi({ label, children, note, tone = "neutral" }: { label: string; children: React.ReactNode; note: string; tone?: "neutral" | "accent" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line-soft bg-canvas/60 p-3.5">
      <p className="truncate text-[11px] text-ink-muted">{label}</p>
      <p className={`mt-1 text-[22px] font-semibold tracking-tight ${tone === "accent" ? "text-accent" : "text-ink"}`}>{children}</p>
      <p className="truncate text-[11px] text-ink-faint">{note}</p>
    </div>
  );
}

function IdleAgent() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const tick = useTicker(1200, inView);
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24, rotate: -1 }}
      whileInView={{ opacity: 1, y: 0, rotate: 1.5 }}
      viewport={{ once: true }}
      transition={{ delay: 1.4, duration: 1, ease }}
      className="absolute -bottom-14 right-2 w-[260px] rounded-2xl border border-line bg-paper p-4 shadow-float sm:-right-6 lg:-right-10"
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-canvas text-ink-faint">
          <Moon size={15} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">Meeting Notes Agent</p>
          <p className="text-[11px] text-ink-faint">Last used 74 days ago</p>
        </div>
      </div>
      <Sparkline points={[6, 5, 4, 2, 1, 0, 0, 0, 0, 0, 0, 0]} stroke="#A1A1AA" className="h-6 w-full" />
      <div className="mt-3 flex items-center justify-between">
        <Pill tone="warn">Idle · still running</Pill>
        <span className="font-mono text-[12px] tabular-nums text-ink">
          ${(14_880 + tick * 3).toLocaleString("en-US")}
          <span className="text-ink-faint"> spent</span>
        </span>
      </div>
    </motion.div>
  );
}

function Analytics() {
  const ref = useRef<HTMLDivElement>(null);
  const play = useInView(ref, { amount: 0.4, once: true });
  return (
    <div ref={ref} className="relative pb-16">
      <Window title="Product analytics · last 12 months" right={<span className="hidden font-mono text-[11px] text-ink-faint sm:inline">Indexed, Jan = 100</span>}>
        <div className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4">
          <Kpi label="Features shipped" note="since January" tone="accent">
            <CountUp from={6} to={24} />
          </Kpi>
          <Kpi label="Weekly active users" note="+1.4%">
            <CountUp from={4120} to={4178} />
          </Kpi>
          <Kpi label="Time saved" note="not measured">
            —
          </Kpi>
          <Kpi label="Error rate" note="unchanged">
            3.1%
          </Kpi>
        </div>
        <div className="px-4 pb-5">
          <GapChart play={play} />
        </div>
      </Window>
      <IdleAgent />
    </div>
  );
}

export function ValueScene() {
  return (
    <Scene scene={sceneById("value")}>
      <Analytics />
    </Scene>
  );
}
