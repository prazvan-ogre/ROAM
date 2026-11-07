"use client";

import { motion, useInView, useScroll, useTransform } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";
import { useScenes } from "@/components/SceneProvider";
import type { Scene as SceneData } from "@/lib/story";

const ease = [0.22, 1, 0.36, 1] as const;

export const reveal = {
  hidden: { opacity: 0, y: 28, filter: "blur(6px)" },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.9, ease, delay: 0.08 * i },
  }),
};

/** Marks a section as the active scene while it crosses the middle of the viewport. */
export function useRegisterScene(ref: React.RefObject<HTMLElement>, id: SceneData["id"]) {
  const { setActiveScene } = useScenes();
  const centered = useInView(ref, { margin: "-48% 0px -48% 0px" });
  useEffect(() => {
    if (centered) setActiveScene(id);
  }, [centered, id, setActiveScene]);
}

type Props = {
  scene: SceneData;
  children: ReactNode;
  /** split: text left / visual right. reverse: visual left. stacked: text above full-width visual. */
  layout?: "split" | "reverse" | "stacked";
  className?: string;
  /** Extra content under the lede (chips, links…). */
  aside?: ReactNode;
  /** Centre the text block (used with the stacked layout for reveal moments). */
  center?: boolean;
};

/**
 * One scene of the film. Registers itself as the active scene when it crosses the
 * middle of the viewport, and gives its visual a gentle camera-like drift.
 */
export function Scene({ scene, children, layout = "split", className = "", aside, center = false }: Props) {
  const ref = useRef<HTMLElement>(null);
  useRegisterScene(ref, scene.id);

  const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "end start"] });
  const drift = useTransform(scrollYProgress, [0, 1], [60, -60]);
  const textDrift = useTransform(scrollYProgress, [0, 1], [24, -24]);

  const text = (
    <motion.div
      style={{ y: textDrift }}
      className={`relative z-10 ${center ? "mx-auto max-w-3xl text-center" : "max-w-xl"}`}
    >
      <motion.p
        variants={reveal}
        custom={0}
        className="mb-5 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-faint"
      >
        {scene.eyebrow}
      </motion.p>
      <motion.h2 id={`${scene.id}-title`} variants={reveal} custom={1} className="text-balance text-headline font-semibold text-ink">
        {scene.headline}
      </motion.h2>
      <motion.p variants={reveal} custom={2} className={`mt-6 max-w-md text-pretty ${center ? "mx-auto max-w-xl" : ""} text-[17px] leading-relaxed text-ink-muted`}>
        {scene.lede}
      </motion.p>
      {aside && (
        <motion.div variants={reveal} custom={3} className="mt-8">
          {aside}
        </motion.div>
      )}
    </motion.div>
  );

  const visual = (
    <motion.div style={{ y: drift }} variants={reveal} custom={2} className="relative w-full">
      {children}
    </motion.div>
  );

  return (
    <motion.section
      ref={ref}
      id={scene.id}
      aria-labelledby={`${scene.id}-title`}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.25 }}
      className={`relative flex min-h-[100svh] items-center px-5 py-28 sm:px-8 lg:py-36 ${className}`}
    >
      <div
        className={`mx-auto grid w-full max-w-7xl items-center gap-14 lg:gap-20 ${
          layout === "stacked"
            ? "grid-cols-1"
            : layout === "reverse"
              ? "grid-cols-1 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
              : "grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
        }`}
      >
        {layout === "reverse" ? (
          <>
            <div className="order-2 lg:order-1">{visual}</div>
            <div className="order-1 lg:order-2">{text}</div>
          </>
        ) : (
          <>
            {text}
            {visual}
          </>
        )}
      </div>
    </motion.section>
  );
}
