"use client";

import { AnimatePresence, motion, useInView } from "framer-motion";
import {
  AppWindow,
  BarChart3,
  Bot,
  Boxes,
  Cloud,
  Coins,
  Flag,
  Lightbulb,
  ListChecks,
  Puzzle,
  RefreshCcw,
  Target,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Scene } from "@/components/ui/Scene";
import { Avatar, Pill, Sparkline, Window } from "@/components/ui/primitives";
import { PRODUCT, sceneById } from "@/lib/story";

const ease = [0.22, 1, 0.36, 1] as const;

type Kind = "Agent" | "App" | "Feature";
type Item = {
  name: string;
  kind: Kind;
  purpose: string;
  owner: string;
  initials: string;
  hue: number;
  usage: number[];
  cost: number;
  build: number;
  result: string;
  goal: number; // % of goal reached
  why: string;
};

export const PORTFOLIO: Item[] = [
  {
    name: "Support Assistant",
    kind: "Agent",
    purpose: "Resolve tier-1 tickets faster",
    owner: "Maya Reyes",
    initials: "MR",
    hue: 245,
    usage: [3, 5, 6, 8, 9, 11, 12, 14],
    cost: 5100,
    build: 18000,
    result: "First reply time −38%",
    goal: 82,
    why: "Customers waited 9 hours for a first reply. Goal: under 2 hours by Q4.",
  },
  {
    name: "Proposal Writer",
    kind: "Agent",
    purpose: "Cut proposal prep time",
    owner: "Jonas Keller",
    initials: "JK",
    hue: 200,
    usage: [2, 4, 4, 6, 7, 7, 8, 9],
    cost: 2400,
    build: 9500,
    result: "6 hours saved per proposal",
    goal: 64,
    why: "Sales spent two days on every proposal. Goal: same quality in half the time.",
  },
  {
    name: "Invoice Matcher",
    kind: "App",
    purpose: "Fewer manual reconciliations",
    owner: "Lena Park",
    initials: "LP",
    hue: 160,
    usage: [4, 6, 7, 7, 8, 8, 9, 9],
    cost: 1100,
    build: 12000,
    result: "Matching errors −52%",
    goal: 100,
    why: "Finance reconciled 1,800 invoices by hand each month. Goal: halve the errors.",
  },
  {
    name: "Smart Search",
    kind: "Feature",
    purpose: "Help users find answers",
    owner: "Arun Shah",
    initials: "AS",
    hue: 30,
    usage: [5, 6, 5, 5, 6, 5, 5, 5],
    cost: 900,
    build: 7000,
    result: "Search usage flat",
    goal: 12,
    why: "Users couldn’t find help articles. Goal: 30% fewer ‘how do I’ tickets.",
  },
  {
    name: "Meeting Notes Agent",
    kind: "Agent",
    purpose: "Share decisions faster",
    owner: "Tom Becker",
    initials: "TB",
    hue: 300,
    usage: [6, 5, 4, 2, 1, 0, 0, 0],
    cost: 1240,
    build: 4000,
    result: "Idle for 74 days",
    goal: 0,
    why: "Decisions got lost after meetings. Goal: notes shared within the hour.",
  },
  {
    name: "Onboarding Hub",
    kind: "App",
    purpose: "Ramp new hires in 30 days",
    owner: "Priya Nair",
    initials: "PN",
    hue: 280,
    usage: [2, 3, 3, 4, 5, 5, 6, 6],
    cost: 700,
    build: 8000,
    result: "Ramp time −9 days",
    goal: 71,
    why: "New hires took 45 days to be productive. Goal: 30 days.",
  },
];

const KIND_ICON = { Agent: Bot, App: AppWindow, Feature: Puzzle } as const;

const SOURCES = [
  { label: "Issue tracker", icon: ListChecks },
  { label: "Cloud billing", icon: Cloud },
  { label: "LLM usage", icon: Coins },
  { label: "Product analytics", icon: BarChart3 },
  { label: "Finance", icon: Wallet },
  { label: "Team directory", icon: Users },
  { label: "Goals & OKRs", icon: Target },
];

const money = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n}`);

function Integrations() {
  return (
    <div className="relative mx-auto mb-0 max-w-5xl">
      <div className="flex flex-wrap justify-center gap-2">
        {SOURCES.map((s, i) => {
          const Icon = s.icon;
          return (
            <motion.span
              key={s.label}
              initial={{ opacity: 0, y: -12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.3 + i * 0.08, duration: 0.6, ease }}
              whileHover={{ y: -2 }}
              className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1.5 text-[12px] font-medium text-ink-soft shadow-card"
            >
              <Icon size={13} className="text-ink-muted" />
              {s.label}
            </motion.span>
          );
        })}
      </div>
      {/* converging data lines */}
      <svg viewBox="0 0 700 70" preserveAspectRatio="none" className="mx-auto h-14 w-full max-w-3xl" aria-hidden>
        {[40, 140, 240, 350, 460, 560, 660].map((x, i) => (
          <path
            key={x}
            d={`M${x},0 C${x},40 350,30 350,70`}
            fill="none"
            stroke={i % 2 ? "#A5B4FC" : "#4F46E5"}
            strokeWidth="1.2"
            className="flow-line"
            opacity="0.7"
          />
        ))}
      </svg>
    </div>
  );
}

function Detail({ item }: { item: Item }) {
  const yearCost = item.build + item.cost * 12;
  const questions = [
    { icon: Flag, q: "Why did we build it?", a: item.why },
    {
      icon: Wallet,
      q: "How much have we invested?",
      a: `${money(item.build)} to build · ${money(item.cost)}/month to run · ${money(yearCost)} over 12 months`,
    },
    { icon: Target, q: "What have we gained?", a: `${item.result} — ${item.goal}% of the goal reached.` },
  ];
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={item.name}
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -10 }}
        transition={{ duration: 0.45, ease }}
        className="flex h-full flex-col"
      >
        <div className="mb-5 flex items-center gap-3">
          <Avatar initials={item.initials} hue={item.hue} />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">{item.name}</p>
            <p className="text-[11px] text-ink-faint">
              {item.kind} · owned by {item.owner}
            </p>
          </div>
        </div>
        <ol className="space-y-3">
          {questions.map(({ icon: Icon, q, a }, i) => (
            <motion.li
              key={q}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.1, duration: 0.5, ease }}
              className="rounded-xl border border-line-soft bg-canvas/70 p-3.5"
            >
              <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold text-accent-deep">
                <Icon size={12} />
                {q}
              </p>
              <p className="text-[12.5px] leading-relaxed text-ink-soft">{a}</p>
            </motion.li>
          ))}
        </ol>
        <div className="pt-5">
          <div className="mb-1.5 flex justify-between text-[11px] text-ink-muted">
            <span>Progress to goal</span>
            <span className="font-mono text-ink">{item.goal}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${item.goal}%` }}
              transition={{ duration: 1, ease }}
              className={`h-full rounded-full ${item.goal < 25 ? "bg-warn" : "bg-accent"}`}
            />
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function PortfolioApp() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  const [filter, setFilter] = useState<"All" | Kind>("All");
  const [selected, setSelected] = useState(0);
  const [userPicked, setUserPicked] = useState(false);
  const rows = PORTFOLIO.map((p, i) => ({ ...p, i })).filter((p) => filter === "All" || p.kind === filter);

  // Gently cycle through items until the viewer takes over.
  useEffect(() => {
    if (!inView || userPicked) return;
    const t = window.setInterval(() => setSelected((s) => (s + 1) % PORTFOLIO.length), 4200);
    return () => window.clearInterval(t);
  }, [inView, userPicked]);

  const nav = [
    { icon: Boxes, label: "Portfolio", active: true },
    { icon: Lightbulb, label: "Ideas" },
    { icon: Target, label: "Goals" },
    { icon: RefreshCcw, label: "Reviews" },
    { icon: Puzzle, label: "Integrations" },
  ];

  return (
    <div ref={ref}>
      <Window
        title={`${PRODUCT.name} · Portfolio`}
        className="mx-auto max-w-6xl"
        right={<Pill tone="accent">{PRODUCT.status}</Pill>}
      >
        <div className="grid lg:grid-cols-[168px_1fr_290px]">
          <aside className="hidden border-r border-line-soft p-3 lg:block">
            {nav.map(({ icon: Icon, label, active }) => (
              <div
                key={label}
                className={`mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] ${
                  active ? "bg-ink text-paper" : "text-ink-muted"
                }`}
              >
                <Icon size={14} />
                {label}
              </div>
            ))}
          </aside>

          <div className="min-w-0 border-line-soft lg:border-r">
            <div className="grid grid-cols-3 gap-px border-b border-line-soft bg-line-soft">
              {[
                ["Initiatives", "38"],
                ["Running cost / mo", "$84.2k"],
                ["Linked to a goal", "71%"],
              ].map(([k, v]) => (
                <div key={k} className="bg-paper px-4 py-3">
                  <p className="truncate text-[11px] text-ink-muted">{k}</p>
                  <p className="text-[18px] font-semibold tracking-tight">{v}</p>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-1 border-b border-line-soft px-3 py-2" role="tablist" aria-label="Filter portfolio">
              {(["All", "Agent", "App", "Feature"] as const).map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  onClick={() => setFilter(f)}
                  className={`relative rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                    filter === f ? "text-ink" : "text-ink-faint hover:text-ink-soft"
                  }`}
                >
                  {filter === f && (
                    <motion.span layoutId="filter-pill" className="absolute inset-0 rounded-full bg-canvas ring-1 ring-line" transition={{ type: "spring", stiffness: 400, damping: 34 }} />
                  )}
                  <span className="relative">{f === "All" ? "All" : `${f}s`}</span>
                </button>
              ))}
            </div>

            <div className="hidden grid-cols-[2fr_0.8fr_0.8fr_0.6fr_1.3fr] gap-3 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint md:grid">
              <span>Initiative · purpose</span>
              <span>Owner</span>
              <span>Usage</span>
              <span className="text-right">Cost/mo</span>
              <span>Results</span>
            </div>

            <ul>
              <AnimatePresence initial={false}>
                {rows.map((p) => {
                  const Icon = KIND_ICON[p.kind];
                  const isSel = p.i === selected;
                  const weak = p.goal < 25;
                  return (
                    <motion.li
                      layout
                      key={p.name}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.3 }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(p.i);
                          setUserPicked(true);
                        }}
                        className={`relative grid w-full grid-cols-[1fr_auto] items-center gap-3 border-t border-line-soft px-4 py-3 text-left transition-colors md:grid-cols-[2fr_0.8fr_0.8fr_0.6fr_1.3fr] ${
                          isSel ? "bg-accent-soft/50" : "hover:bg-canvas"
                        }`}
                      >
                        {isSel && <motion.span layoutId="row-marker" className="absolute inset-y-0 left-0 w-[2px] bg-accent" />}
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-canvas text-ink-soft ring-1 ring-line-soft">
                            <Icon size={13} />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium">{p.name}</span>
                            <span className="block truncate text-[11px] text-ink-faint">
                              <span className="md:hidden">{p.kind} · </span>
                              {p.purpose}
                            </span>
                          </span>
                        </span>
                        <span className="hidden items-center gap-1.5 md:flex">
                          <Avatar initials={p.initials} hue={p.hue} />
                          <span className="truncate text-[11.5px] text-ink-muted">{p.owner.split(" ")[0]}</span>
                        </span>
                        <span className="hidden md:block">
                          <Sparkline points={p.usage} stroke={weak ? "#A1A1AA" : "#4F46E5"} className="h-5 w-16" />
                        </span>
                        <span className="hidden text-right font-mono text-[12px] tabular-nums md:block">{money(p.cost)}</span>
                        <span className="flex items-center justify-end gap-2 md:justify-start">
                          <span className={`truncate text-[12px] ${weak ? "text-warn" : "text-ink-soft"}`}>{p.result}</span>
                        </span>
                      </button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </div>

          <div className="border-t border-line-soft p-5 lg:border-t-0">
            <p className="mb-4 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">Three questions, always answered</p>
            <Detail item={PORTFOLIO[selected]} />
          </div>
        </div>
      </Window>
    </div>
  );
}

export function PlatformScene() {
  return (
    <Scene
      scene={sceneById("platform")}
      layout="stacked"
      center
      className="lg:py-40"
      aside={
        <div className="flex flex-wrap justify-center gap-2 text-[13px] text-ink-soft">
          {["Why did we build it?", "How much have we invested?", "What have we gained?"].map((q, i) => (
            <span key={q} className="inline-flex items-center gap-2 rounded-full border border-line bg-paper/80 px-3.5 py-1.5 backdrop-blur">
              <span className="font-mono text-[10px] text-accent">0{i + 1}</span>
              {q}
            </span>
          ))}
        </div>
      }
    >
      <div className="relative">
        {/* reveal glow */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-24 mx-auto h-[70%] max-w-5xl rounded-[3rem] bg-gradient-to-b from-accent-glow/40 via-accent-soft/40 to-transparent blur-3xl" />
        <div className="relative">
          <Integrations />
          <PortfolioApp />
        </div>
      </div>
    </Scene>
  );
}
