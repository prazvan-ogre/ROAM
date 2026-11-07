"use client";

import { motion, useScroll, useSpring } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { useScenes } from "@/components/SceneProvider";
import { PRODUCT, SCENES } from "@/lib/story";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366F1" />
            <stop offset="1" stopColor="#3730A3" />
          </linearGradient>
        </defs>
        <rect x="1" y="1" width="22" height="22" rx="7" fill="url(#logo-g)" />
        <path d="M6.5 8.5l2.6 7 2.9-6 2.9 6 2.6-7" fill="none" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight">{PRODUCT.name}</span>
    </span>
  );
}

export function TopBar() {
  const { goTo } = useScenes();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div aria-hidden className="pointer-events-none absolute inset-0 -bottom-6 bg-gradient-to-b from-canvas via-canvas/85 to-transparent backdrop-blur-[2px] [mask-image:linear-gradient(to_bottom,black_60%,transparent)]" />
      <motion.div style={{ scaleX }} className="relative h-[2px] origin-left bg-gradient-to-r from-accent-glow via-accent to-accent-deep" />
      <div className="relative mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8">
        <button type="button" onClick={() => goTo("opening")} aria-label={`${PRODUCT.name} — back to top`}>
          <Logo />
        </button>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-line bg-paper/70 px-3 py-1.5 text-[12px] text-ink-muted backdrop-blur md:inline-flex">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            {PRODUCT.status}
          </span>
          <a
            href={PRODUCT.bookingUrl}
            className="group inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-[13px] font-medium text-paper transition-all duration-300 ease-cine hover:bg-accent-deep"
          >
            Let’s talk
            <ArrowUpRight size={14} className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>
      </div>
    </header>
  );
}

/** Vertical chapter rail on large screens. */
export function ChapterNav() {
  const { activeScene, goTo } = useScenes();
  return (
    <nav aria-label="Scenes" className="fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 xl:block">
      <ol className="flex flex-col gap-3">
        {SCENES.map((s) => {
          const active = s.id === activeScene;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => goTo(s.id)}
                className="group relative flex h-3 w-6 items-center justify-end"
                aria-current={active ? "step" : undefined}
              >
                <span
                  className={`pointer-events-none absolute right-9 translate-x-1 whitespace-nowrap rounded-full bg-paper/90 px-2.5 py-1 text-[12px] opacity-0 shadow-card backdrop-blur transition-all duration-300 ease-cine group-hover:translate-x-0 group-hover:opacity-100 ${
                    active ? "text-ink" : "text-ink-muted"
                  }`}
                >
                  {s.label}
                </span>
                <span
                  className={`block h-1.5 rounded-full transition-all duration-500 ease-cine ${
                    active ? "w-6 bg-accent" : "w-1.5 bg-ink/15 group-hover:bg-ink/40"
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Soft, slow-moving light field behind the whole film. */
export function Atmosphere() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-canvas" />
      <div className="atmos-blob left-[-10%] top-[-20%] h-[60vw] w-[60vw] bg-[radial-gradient(circle,rgba(165,180,252,0.35),transparent_60%)]" />
      <div
        className="atmos-blob bottom-[-25%] right-[-15%] h-[55vw] w-[55vw] bg-[radial-gradient(circle,rgba(199,210,254,0.35),transparent_60%)]"
        style={{ animationDelay: "-12s" }}
      />
      <div className="absolute inset-0 bg-grid opacity-[0.5]" />
      <div className="grain absolute inset-0" />
    </div>
  );
}
