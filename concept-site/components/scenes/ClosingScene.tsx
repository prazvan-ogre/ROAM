"use client";

import { AnimatePresence, LayoutGroup, motion, useInView } from "framer-motion";
import { ArrowUpRight, Mail, RotateCcw, Target } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/ui/Chrome";
import { useRegisterScene } from "@/components/ui/Scene";
import { Avatar } from "@/components/ui/primitives";
import { PRODUCT, sceneById } from "@/lib/story";

const ease = [0.22, 1, 0.36, 1] as const;
const scene = sceneById("closing");

const KEEP = [
  { name: "Support Assistant", goal: "First reply under 2 hours", owner: "MR", hue: 245 },
  { name: "Proposal Writer", goal: "Proposals in half the time", owner: "JK", hue: 200 },
  { name: "Invoice Matcher", goal: "Half the matching errors", owner: "LP", hue: 160 },
  { name: "Onboarding Hub", goal: "New hires ramped in 30 days", owner: "PN", hue: 280 },
];

const NOISE = [
  "Slack summariser", "Meeting Notes Agent", "Smart Search v2", "Lead scorer", "Expense bot", "Docs copilot",
  "Churn predictor", "Contract Q&A Bot", "FAQ generator", "Pricing widget", "Survey analyser", "Ticket tagger",
  "HR helpdesk", "Release notes AI", "Dark mode", "CSV export", "Forecast agent", "Email drafter", "Translator",
  "Status page", "Sales coach", "Data cleaner", "Persona bot", "Calendar agent", "Alt-text tool", "Quiz builder",
  "Recap emails", "Brand checker", "Feedback wall", "KPI bot",
];

// deterministic scatter so server and client agree
function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}
const ALL = [
  ...NOISE.map((n, i) => ({ name: n, keep: false, i })),
  ...KEEP.map((k, i) => ({ name: k.name, keep: true, i: NOISE.length + i })),
].sort((a, b) => rand(a.i + 3) - rand(b.i + 3));

function Portfolio() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.5 });
  const [focused, setFocused] = useState(false);
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (!inView || focused) return;
    const t = window.setTimeout(() => setFocused(true), 1800);
    return () => window.clearTimeout(t);
  }, [inView, focused, run]);

  return (
    <div ref={ref} className="relative mx-auto w-full max-w-5xl">
      <LayoutGroup>
        <div className={`relative ${focused ? "" : "min-h-[420px] sm:min-h-[200px]"}`}>
          <AnimatePresence mode="popLayout">
            {!focused ? (
              <motion.div
                key="chaos"
                exit={{ opacity: 1 }}
                className="flex flex-wrap justify-center gap-1.5 sm:gap-2"
              >
                {ALL.map((t) => {
                  const keep = KEEP.find((k) => k.name === t.name);
                  return (
                    <motion.span
                      key={t.name}
                      layoutId={keep ? `keep-${t.name}` : undefined}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1, rotate: (rand(t.i) - 0.5) * 6, y: (rand(t.i + 7) - 0.5) * 10 }}
                      exit={keep ? undefined : { opacity: 0, scale: 0.6, filter: "blur(6px)", transition: { duration: 0.6, delay: rand(t.i) * 0.4 } }}
                      transition={{ duration: 0.6, ease, delay: rand(t.i + 1) * 0.4 }}
                      className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[11.5px] text-ink-muted shadow-card"
                    >
                      {t.name}
                    </motion.span>
                  );
                })}
              </motion.div>
            ) : (
              <motion.div key="focus" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {KEEP.map((k, i) => (
                  <motion.div
                    key={k.name}
                    layoutId={`keep-${k.name}`}
                    transition={{ type: "spring", stiffness: 110, damping: 20, delay: 0.1 * i }}
                    className="rounded-2xl border border-line bg-paper p-5 shadow-float"
                  >
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.7 + i * 0.1, duration: 0.6 }}
                    >
                      <p className="text-[15px] font-semibold tracking-tight text-ink">{k.name}</p>
                      <p className="mt-3 flex items-start gap-1.5 text-[12.5px] leading-snug text-ink-soft">
                        <Target size={13} className="mt-0.5 shrink-0 text-accent" />
                        {k.goal}
                      </p>
                      <div className="mt-4 flex items-center gap-2 border-t border-line-soft pt-3">
                        <Avatar initials={k.owner} hue={k.hue} />
                        <span className="text-[11px] text-ink-faint">Owner</span>
                        <span className="ml-auto h-1.5 w-1.5 rounded-full bg-ok" />
                      </div>
                    </motion.div>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>

      <div className="mt-6 flex items-center justify-center gap-4 font-mono text-[11px] text-ink-faint">
        <span>{focused ? `${KEEP.length} initiatives · each with a goal and an owner` : `${ALL.length} initiatives · unclear goals`}</span>
        {focused && (
          <button
            type="button"
            onClick={() => {
              setFocused(false);
              setRun((r) => r + 1);
            }}
            className="inline-flex items-center gap-1 text-ink-muted transition-colors hover:text-ink"
          >
            <RotateCcw size={11} /> Replay
          </button>
        )}
      </div>
    </div>
  );
}

export function ClosingScene() {
  const ref = useRef<HTMLElement>(null);
  useRegisterScene(ref, "closing");

  return (
    <section ref={ref} id="closing" aria-labelledby="closing-title" className="relative px-5 pb-40 pt-28 sm:px-8 lg:pt-36">
      <div className="mx-auto max-w-7xl">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease }}
          className="mb-12 text-center font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint"
        >
          {scene.eyebrow}
        </motion.p>

        <Portfolio />

        <div className="mx-auto mt-32 max-w-4xl text-center sm:mt-40">
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 1, ease }}
            className="mx-auto max-w-xl text-balance text-[17px] leading-relaxed text-ink-muted sm:text-lg"
          >
            {scene.narration}
          </motion.p>
          <motion.h2
            id="closing-title"
            initial={{ opacity: 0, y: 40, filter: "blur(14px)" }}
            whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: 1.4, ease, delay: 0.3 }}
            className="mt-8 text-display font-semibold"
          >
            Build what <span className="text-gradient">matters.</span>
          </motion.h2>
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1, ease, delay: 0.2 }}
          className="relative mx-auto mt-24 max-w-4xl overflow-hidden rounded-[2rem] bg-ink px-6 py-14 text-center text-paper sm:px-12 sm:py-20"
        >
          <div aria-hidden className="pointer-events-none absolute -top-1/2 left-1/2 h-[140%] w-[90%] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.45),transparent_60%)] blur-2xl" />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-dots opacity-[0.15] invert" />
          <div className="relative">
            <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.16em] text-accent-glow">{PRODUCT.status}</p>
            <h3 className="mx-auto max-w-2xl text-balance text-[clamp(1.8rem,3.6vw,3rem)] font-semibold leading-[1.05] tracking-[-0.035em]">
              Want to explore this with your team? Let’s talk.
            </h3>
            <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-paper/60">
              We’re shaping {PRODUCT.name} with a small group of product, innovation and operations teams. Thirty minutes, no slides.
            </p>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              <a
                href={PRODUCT.bookingUrl}
                className="group inline-flex items-center gap-2 rounded-full bg-paper px-6 py-3.5 text-[15px] font-medium text-ink transition-all duration-300 ease-cine hover:-translate-y-0.5 hover:shadow-[0_12px_40px_-8px_rgba(165,180,252,0.7)]"
              >
                Book a conversation
                <ArrowUpRight size={16} className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
              <a
                href={`mailto:${PRODUCT.contactEmail}`}
                className="inline-flex items-center gap-2 rounded-full px-5 py-3.5 text-[14px] text-paper/70 transition-colors hover:text-paper"
              >
                <Mail size={15} />
                {PRODUCT.contactEmail}
              </a>
            </div>
          </div>
        </motion.div>

        <footer className="mx-auto mt-20 flex max-w-4xl flex-col items-center justify-between gap-4 border-t border-line pt-8 text-[12px] text-ink-faint sm:flex-row">
          <Logo className="text-ink" />
          <span>{PRODUCT.tagline} · © {new Date().getFullYear()}</span>
        </footer>
      </div>
    </section>
  );
}
