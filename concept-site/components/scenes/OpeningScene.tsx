"use client";

import { AnimatePresence, motion, useInView, useScroll, useTransform } from "framer-motion";
import { ArrowDown, Bot, CornerDownLeft, Inbox, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { WatchFilmButton, useFilm } from "@/components/film/FilmPlayer";
import { useRegisterScene } from "@/components/ui/Scene";
import { Pill, Window } from "@/components/ui/primitives";
import { sceneById } from "@/lib/story";

const scene = sceneById("opening");
const ease = [0.22, 1, 0.36, 1] as const;
const PROMPT = "Build an app that turns customer emails into prioritised tickets";

const FEATURES = [
  { label: "Auto-reply drafts", x: "-6%", y: "8%" },
  { label: "Sentiment score", x: "80%", y: "2%" },
  { label: "Slack alerts", x: "88%", y: "40%" },
  { label: "Weekly digest", x: "-10%", y: "56%" },
  { label: "CSV export", x: "78%", y: "80%" },
  { label: "Smart routing", x: "4%", y: "88%" },
  { label: "12 languages", x: "40%", y: "-6%" },
  { label: "SLA tracker", x: "46%", y: "96%" },
];

/** Phases: 0 typing · 1 app · 2 agent · 3 features · 4 hold */
function useHeroTimeline(active: boolean) {
  const [phase, setPhase] = useState(0);
  const [typed, setTyped] = useState(0);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    if (!active) return;
    setPhase(0);
    setTyped(0);
    const timers: number[] = [];
    let i = 0;
    const type = window.setInterval(() => {
      i += 1;
      setTyped(i);
      if (i >= PROMPT.length) window.clearInterval(type);
    }, 28);
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    const typingDone = PROMPT.length * 28 + 500;
    at(typingDone, () => setPhase(1));
    at(typingDone + 1700, () => setPhase(2));
    at(typingDone + 3000, () => setPhase(3));
    at(typingDone + 9500, () => setPhase(4));
    at(typingDone + 10600, () => setCycle((c) => c + 1));
    return () => {
      window.clearInterval(type);
      timers.forEach(window.clearTimeout);
    };
  }, [active, cycle]);

  return { phase, typed };
}

function PromptBar({ typed, submitted }: { typed: number; submitted: boolean }) {
  return (
    <motion.div
      layout
      transition={{ duration: 0.8, ease }}
      className={`relative z-20 mx-auto flex w-full items-center gap-3 rounded-2xl border bg-paper/95 px-4 py-3.5 shadow-float backdrop-blur ${
        submitted ? "max-w-md border-line" : "max-w-xl border-accent/25"
      }`}
    >
      <Sparkles size={16} className="shrink-0 text-accent" />
      <p className="min-w-0 flex-1 truncate text-left text-[14px] text-ink-soft">
        {PROMPT.slice(0, typed)}
        {!submitted && <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-[3px] animate-pulse bg-accent" />}
      </p>
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors duration-500 ${
          submitted ? "bg-accent text-paper" : "bg-canvas text-ink-faint"
        }`}
      >
        <CornerDownLeft size={14} />
      </span>
    </motion.div>
  );
}

const TICKETS = [
  { from: "Northwind", subject: "Invoice export is failing", pri: "P1" },
  { from: "Acme Co.", subject: "Can we add SSO for contractors?", pri: "P2" },
  { from: "Globex", subject: "Thanks — the fix worked", pri: "P3" },
  { from: "Initech", subject: "Data looks off since Monday", pri: "P1" },
];

function AppMock() {
  return (
    <Window title="ticket-triage.app" className="w-full" right={<Pill tone="ok">● Live</Pill>}>
      <div className="grid grid-cols-[110px_1fr] sm:grid-cols-[150px_1fr]">
        <div className="space-y-1 border-r border-line-soft p-3">
          {["Inbox", "Urgent", "Waiting", "Resolved"].map((l, i) => (
            <motion.div
              key={l}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.07, ease }}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[12px] ${i === 0 ? "bg-accent-soft text-accent-deep" : "text-ink-muted"}`}
            >
              {i === 0 && <Inbox size={12} />}
              {l}
            </motion.div>
          ))}
        </div>
        <div className="divide-y divide-line-soft">
          {TICKETS.map((t, i) => (
            <motion.div
              key={t.subject}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.12, duration: 0.6, ease }}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                  t.pri === "P1" ? "bg-ink text-paper" : "bg-canvas text-ink-muted"
                }`}
              >
                {t.pri}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12.5px] font-medium text-ink">{t.subject}</p>
                <p className="text-[11px] text-ink-faint">{t.from}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </Window>
  );
}

function AgentOrb() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.6, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.8 }}
      transition={{ type: "spring", stiffness: 180, damping: 18 }}
      className="absolute -right-3 -top-6 z-30 flex items-center gap-2.5 rounded-2xl border border-accent/20 bg-paper/95 py-2 pl-2 pr-3.5 shadow-glow backdrop-blur sm:-right-10 sm:-top-8"
    >
      <span className="relative grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-deep text-paper">
        <span className="absolute inset-0 animate-ping rounded-xl bg-accent/30" />
        <Bot size={16} className="relative" />
      </span>
      <div className="text-left">
        <p className="text-[12px] font-semibold leading-tight">Triage Agent</p>
        <p className="font-mono text-[10px] text-accent">reading 1,204 emails…</p>
      </div>
    </motion.div>
  );
}

function Stage({ active }: { active: boolean }) {
  const { phase, typed } = useHeroTimeline(active);
  const submitted = phase >= 1;

  return (
    <div className="relative mx-auto h-[440px] w-full max-w-3xl sm:h-[480px]">
      <motion.div animate={{ opacity: phase === 4 ? 0 : 1 }} transition={{ duration: 0.9, ease }} className="relative h-full">
        <div className="absolute inset-x-0 top-0 px-2">
          <PromptBar typed={typed} submitted={submitted} />
        </div>

        <AnimatePresence>
          {submitted && (
            <motion.div
              key="app"
              initial={{ opacity: 0, y: 30, scale: 0.94, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1, ease }}
              className="absolute inset-x-6 top-[96px] sm:inset-x-20"
            >
              {/* beam from prompt to app */}
              <motion.span
                initial={{ scaleY: 0, opacity: 0 }}
                animate={{ scaleY: 1, opacity: [0, 1, 0] }}
                transition={{ duration: 1.1, ease }}
                className="absolute -top-10 left-1/2 h-10 w-px origin-top bg-gradient-to-b from-accent to-transparent"
              />
              <div className="relative">
                <AppMock />
                <AnimatePresence>{phase >= 2 && <AgentOrb key="agent" />}</AnimatePresence>
                {phase >= 3 &&
                  FEATURES.map((f, i) => (
                    <motion.div
                      key={f.label}
                      initial={{ opacity: 0, scale: 0.3, left: "45%", top: "45%" }}
                      animate={{ opacity: 1, scale: 1, left: f.x, top: f.y }}
                      transition={{ delay: i * 0.38, type: "spring", stiffness: 140, damping: 16 }}
                      className="absolute z-20 hidden sm:block"
                    >
                      <motion.span
                        animate={{ y: [0, -4, 0] }}
                        transition={{ duration: 3 + (i % 3), repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-paper px-3 py-1.5 text-[11.5px] font-medium text-ink-soft shadow-card"
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
                        {f.label}
                      </motion.span>
                    </motion.div>
                  ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* mobile: show the feature count instead of a crowded orbit */}
        <AnimatePresence>
          {phase >= 3 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-2 flex flex-wrap justify-center gap-1.5 px-4 sm:hidden"
            >
              {FEATURES.slice(0, 5).map((f) => (
                <Pill key={f.label}>{f.label}</Pill>
              ))}
              <Pill tone="accent">+3 more</Pill>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {phase >= 3 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ delay: 3.4 }}
              className="absolute bottom-0 left-1/2 hidden -translate-x-1/2 font-mono text-[11px] tracking-wide text-ink-faint sm:block"
            >
              1 prompt → 1 app → 1 agent → 8 features · 00:04:12
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

export function OpeningScene() {
  const ref = useRef<HTMLElement>(null);
  useRegisterScene(ref, "opening");
  const stageInView = useInView(ref, { amount: 0.3 });
  const film = useFilm();

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const titleY = useTransform(scrollYProgress, [0, 1], [0, -120]);
  const titleOpacity = useTransform(scrollYProgress, [0, 0.6], [1, 0]);
  const stageScale = useTransform(scrollYProgress, [0, 1], [1, 0.92]);
  const stageY = useTransform(scrollYProgress, [0, 1], [0, 80]);

  return (
    <section
      ref={ref}
      id="opening"
      aria-labelledby="opening-title"
      className="relative flex min-h-[100svh] flex-col items-center px-5 pb-24 pt-28 sm:px-8 sm:pt-32"
    >
      <motion.div style={{ y: titleY, opacity: titleOpacity }} className="relative z-10 mx-auto max-w-5xl text-center">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease }}
          className="mb-7 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-faint"
        >
          {scene.eyebrow}
        </motion.p>
        <h1 id="opening-title" className="text-balance text-display font-semibold">
          {["It’s", "easy", "to", "build", "anything", "today."].map((w, i) => (
            <motion.span
              key={w}
              initial={{ opacity: 0, y: 40, filter: "blur(12px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 1, ease, delay: 0.15 + i * 0.07 }}
              className="inline-block pr-[0.22em]"
            >
              {w}
            </motion.span>
          ))}
          <br className="hidden sm:block" />
          <motion.span
            initial={{ opacity: 0, y: 40, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 1.2, ease, delay: 1.0 }}
            className="text-gradient inline-block"
          >
            But is everything worth building?
          </motion.span>
        </h1>
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease, delay: 1.5 }}
          className="mx-auto mt-7 max-w-xl text-pretty text-[17px] leading-relaxed text-ink-muted sm:text-lg"
        >
          {scene.lede}
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease, delay: 1.7 }}
          className="mt-9 flex flex-wrap items-center justify-center gap-3"
        >
          <WatchFilmButton />
          <a
            href="#competition"
            className={`group inline-flex items-center gap-2 rounded-full px-5 py-3 text-[14px] font-medium transition-all duration-300 ease-cine ${
              film.available
                ? "text-ink-soft hover:text-ink"
                : "bg-ink text-paper shadow-float hover:-translate-y-0.5 hover:bg-accent-deep"
            }`}
          >
            Scroll to explore
            <ArrowDown size={15} className="transition-transform duration-300 group-hover:translate-y-0.5" />
          </a>
        </motion.div>
      </motion.div>

      <motion.div style={{ scale: stageScale, y: stageY }} className="relative mt-14 w-full sm:mt-16">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.2, ease, delay: 1.9 }}
        >
          <Stage active={stageInView} />
        </motion.div>
      </motion.div>
    </section>
  );
}
