"use client";

import { motion, useInView } from "framer-motion";
import { Bot, Cloud, Coins, CreditCard, LifeBuoy, Wrench } from "lucide-react";
import { useMemo, useRef } from "react";
import { Scene } from "@/components/ui/Scene";
import { CountUp, Pill, Window, useTicker } from "@/components/ui/primitives";
import { sceneById } from "@/lib/story";

const ease = [0.22, 1, 0.36, 1] as const;
const BUILD = 18_000;
const MONTHS = 12;

const STREAMS = [
  { key: "tokens", label: "AI tokens", icon: Coins, base: 1200, growth: 0.09, color: "#3730A3" },
  { key: "cloud", label: "Cloud infrastructure", icon: Cloud, base: 800, growth: 0.04, color: "#4F46E5" },
  { key: "subs", label: "Subscriptions", icon: CreditCard, base: 650, growth: 0.0, color: "#818CF8" },
  { key: "support", label: "Support", icon: LifeBuoy, base: 1100, growth: 0.05, color: "#A5B4FC" },
  { key: "maint", label: "Maintenance", icon: Wrench, base: 1500, growth: 0.04, color: "#C7D2FE" },
] as const;

const monthly = (base: number, growth: number, m: number) => base * Math.pow(1 + growth, m);

function useSeries() {
  return useMemo(() => {
    // cumulative[m][k] = cumulative running cost of stream k up to month m (m = 0..MONTHS)
    const cumulative: number[][] = [];
    const acc = STREAMS.map(() => 0);
    for (let m = 0; m <= MONTHS; m++) {
      if (m > 0) STREAMS.forEach((s, k) => (acc[k] += monthly(s.base, s.growth, m - 1)));
      cumulative.push([...acc]);
    }
    const totalRunning = acc.reduce((a, b) => a + b, 0);
    return { cumulative, totalRunning };
  }, []);
}

function CostChart({ play }: { play: boolean }) {
  const { cumulative, totalRunning } = useSeries();
  const W = 420;
  const H = 260;
  const padL = 8;
  const padR = 8;
  const max = BUILD + totalRunning;
  const xOf = (m: number) => padL + ((m + 1) / (MONTHS + 1)) * (W - padL - padR); // m from -1..12
  const yOf = (v: number) => H - (v / max) * (H - 16);

  // stacked areas sit on top of the build cost
  const layers = STREAMS.map((s, k) => {
    const top: string[] = [];
    const bottom: string[] = [];
    for (let m = 0; m <= MONTHS; m++) {
      const below = BUILD + cumulative[m].slice(0, k).reduce((a, b) => a + b, 0);
      const above = below + cumulative[m][k];
      top.push(`${xOf(m)},${yOf(above)}`);
      bottom.unshift(`${xOf(m)},${yOf(below)}`);
    }
    return { ...s, d: `M${top.join(" L")} L${bottom.join(" L")} Z` };
  });

  const buildPath = `M${xOf(-1)},${H} L${xOf(0)},${yOf(BUILD)} L${xOf(MONTHS)},${yOf(BUILD)} L${xOf(MONTHS)},${H} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H + 30}`} className="w-full" role="img" aria-label="Cumulative cost keeps rising after launch">
      <defs>
        <clipPath id="cost-reveal">
          <motion.rect
            x="0"
            y="0"
            height={H + 30}
            initial={{ width: 0 }}
            animate={{ width: play ? W : 0 }}
            transition={{ duration: 4.2, ease: [0.45, 0, 0.2, 1] }}
          />
        </clipPath>
      </defs>
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <line key={t} x1={padL} x2={W - padR} y1={yOf(max * t)} y2={yOf(max * t)} stroke="#F0EFEA" />
      ))}
      <g clipPath="url(#cost-reveal)">
        <path d={buildPath} fill="#0E0E12" opacity="0.9" />
        {layers.map((l) => (
          <path key={l.key} d={l.d} fill={l.color} />
        ))}
      </g>
      <line x1={xOf(0)} x2={xOf(0)} y1={8} y2={H} stroke="#0E0E12" strokeDasharray="3 4" opacity="0.5" />
      <text x={xOf(0) + 6} y={20} className="fill-ink font-mono text-[13px]">
        Launch
      </text>
      <text x={xOf(-0.5)} y={H + 22} textAnchor="middle" className="fill-ink-faint font-mono text-[12px]">
        Build
      </text>
      {[3, 6, 9, 12].map((m) => (
        <text key={m} x={xOf(m)} y={H + 22} textAnchor="middle" className="fill-ink-faint font-mono text-[12px]">
          M{m}
        </text>
      ))}
    </svg>
  );
}

function StreamRow({ s, i, live }: { s: (typeof STREAMS)[number]; i: number; live: number }) {
  const Icon = s.icon;
  const value = monthly(s.base, s.growth, MONTHS) + live * s.base * 0.004;
  return (
    <motion.li
      initial={{ opacity: 0, x: 20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay: 0.6 + i * 0.35, duration: 0.7, ease }}
      className="flex items-center gap-3 py-2"
    >
      <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
      <Icon size={14} className="shrink-0 text-ink-muted" />
      <span className="flex-1 text-[13px] text-ink-soft">{s.label}</span>
      {s.growth > 0 && (
        <span className="font-mono text-[10.5px] text-warn">+{Math.round(s.growth * 100)}%/mo</span>
      )}
      <span className="w-20 text-right font-mono text-[12.5px] tabular-nums text-ink">
        ${Math.round(value).toLocaleString("en-US")}
      </span>
    </motion.li>
  );
}

function CostBoard() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.4 });
  const once = useInView(ref, { amount: 0.4, once: true });
  const live = useTicker(900, inView);
  const { totalRunning } = useSeries();

  return (
    <div ref={ref} className="relative">
      <Window
        title="Support Assistant · cost of ownership"
        right={
          <Pill tone="ok">
            <Bot size={11} /> Live since March
          </Pill>
        }
      >
        <div className="grid gap-0 md:grid-cols-[1.35fr_1fr]">
          <div className="border-b border-line-soft p-5 md:border-b-0 md:border-r">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-[11px] text-ink-muted">Total cost, first year</p>
                <p className="text-[28px] font-semibold tracking-tight">
                  <CountUp to={BUILD + totalRunning} prefix="$" duration={4.2} />
                </p>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-ink-muted">To build</p>
                <p className="font-mono text-[14px] text-ink">${BUILD.toLocaleString("en-US")}</p>
              </div>
            </div>
            <CostChart play={once} />
          </div>
          <div className="p-5">
            <p className="mb-2 text-[11px] text-ink-muted">Running cost per month, today</p>
            <ul className="divide-y divide-line-soft">
              {STREAMS.map((s, i) => (
                <StreamRow key={s.key} s={s} i={i} live={live} />
              ))}
            </ul>
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 2.6, duration: 0.7, ease }}
              className="mt-4 rounded-xl bg-canvas p-3.5"
            >
              <p className="text-[12px] leading-relaxed text-ink-soft">
                Running it for a year costs{" "}
                <span className="font-semibold text-ink">{(totalRunning / BUILD).toFixed(1)}×</span> what it cost to build.
              </p>
            </motion.div>
          </div>
        </div>
      </Window>
    </div>
  );
}

export function CostsScene() {
  return (
    <Scene scene={sceneById("costs")} layout="reverse">
      <CostBoard />
    </Scene>
  );
}
