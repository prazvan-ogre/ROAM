"use client";

import { animate, motion, useInView, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** A product-UI window frame: soft shadow, hairline border, traffic-light dots. */
export function Window({
  title,
  children,
  className = "",
  right,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <div className={`overflow-hidden rounded-xl2 border border-line bg-paper shadow-float ${className}`}>
      <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="h-2.5 w-2.5 rounded-full bg-line" />
        </div>
        {title && <span className="truncate text-[12px] font-medium text-ink-muted">{title}</span>}
        <div className="ml-auto">{right}</div>
      </div>
      {children}
    </div>
  );
}

export function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn" | "ok" | "dark";
  className?: string;
}) {
  const tones = {
    neutral: "bg-canvas text-ink-soft border-line",
    accent: "bg-accent-soft text-accent-deep border-accent/15",
    warn: "bg-warn-soft text-warn border-warn/15",
    ok: "bg-ok-soft text-ok border-ok/15",
    dark: "bg-ink text-paper border-ink",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function Avatar({ initials, hue = 240 }: { initials: string; hue?: number }) {
  return (
    <span
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white ring-2 ring-paper"
      style={{ background: `linear-gradient(135deg, hsl(${hue} 60% 62%), hsl(${hue + 30} 55% 48%))` }}
    >
      {initials}
    </span>
  );
}

/** Number that counts up once it scrolls into view. */
export function CountUp({
  to,
  from = 0,
  duration = 1.8,
  prefix = "",
  suffix = "",
  decimals = 0,
  className = "",
}: {
  to: number;
  from?: number;
  duration?: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const mv = useMotionValue(from);
  const text = useTransform(mv, (v) => `${prefix}${v.toLocaleString("en-US", { maximumFractionDigits: decimals, minimumFractionDigits: decimals })}${suffix}`);
  useEffect(() => {
    if (!inView) return;
    const c = animate(mv, to, { duration, ease: [0.22, 1, 0.36, 1] });
    return c.stop;
  }, [inView, mv, to, duration]);
  return (
    <motion.span ref={ref} className={`tabular-nums ${className}`}>
      {text}
    </motion.span>
  );
}

/** Calls back every `ms` while the element is on screen. Used for living UI. */
export function useTicker(ms: number, active: boolean) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setTick((x) => x + 1), ms);
    return () => window.clearInterval(t);
  }, [ms, active]);
  return tick;
}

/** Tiny inline sparkline. */
export function Sparkline({
  points,
  className = "",
  stroke = "#4F46E5",
  fill = true,
}: {
  points: number[];
  className?: string;
  stroke?: string;
  fill?: boolean;
}) {
  const w = 80;
  const h = 24;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const xy = points.map((p, i) => [(i / (points.length - 1)) * w, h - ((p - min) / (max - min || 1)) * (h - 4) - 2]);
  const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const id = `spark-${stroke.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className={className} aria-hidden>
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor={stroke} stopOpacity="0.18" />
              <stop offset="1" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${d} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
        </>
      )}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Drop-in looping video for scenes that use filmed or rendered clips instead of
 * (or alongside) the animated UI. Plays only while visible; respects reduced motion.
 */
export function VideoLoop({ src, poster, className = "" }: { src: string; poster?: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const inView = useInView(ref, { amount: 0.3 });
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (inView && !reduce) v.play().catch(() => undefined);
    else v.pause();
  }, [inView]);
  return (
    <video
      ref={ref}
      className={`h-full w-full rounded-xl2 object-cover ${className}`}
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
    />
  );
}
