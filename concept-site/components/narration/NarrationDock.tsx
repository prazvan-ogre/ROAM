"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Captions, CaptionsOff, FileText, Pause, Play, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import { useMemo } from "react";
import { SCENES, sceneById } from "@/lib/story";
import { splitSentences } from "./voice";
import { useNarration } from "./NarrationProvider";

/** Word-by-word caption for the sentence currently being spoken. */
function Caption() {
  const { narratingScene, progress, captionsOn, soundOn } = useNarration();

  const data = useMemo(() => {
    if (!narratingScene) return null;
    const text = sceneById(narratingScene).narration;
    const sentences = splitSentences(text);
    let offset = 0;
    const list = sentences.map((s) => {
      const start = offset;
      offset += s.length + 1;
      return { text: s, start, end: offset };
    });
    return { list, total: offset };
  }, [narratingScene]);

  if (!data || !captionsOn || !soundOn) return null;
  const at = progress * data.total;
  const current = data.list.find((s) => at < s.end) ?? data.list[data.list.length - 1];
  const words = current.text.split(" ");
  let cursor = current.start;

  return (
    <AnimatePresence mode="wait">
      <motion.p
        key={current.start + (narratingScene ?? "")}
        initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto max-w-2xl text-balance text-center text-[15px] leading-relaxed sm:text-base"
        aria-live="polite"
      >
        {words.map((w, i) => {
          const spoken = at >= cursor + w.length * 0.5;
          cursor += w.length + 1;
          return (
            <span key={i} className={`transition-colors duration-300 ${spoken ? "text-ink" : "text-ink-faint"}`}>
              {w}{" "}
            </span>
          );
        })}
      </motion.p>
    </AnimatePresence>
  );
}

function IconButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`grid h-9 w-9 place-items-center rounded-full transition-all duration-200 ease-cine hover:bg-ink/5 active:scale-95 ${
        active ? "text-ink" : "text-ink-muted"
      }`}
    >
      {children}
    </button>
  );
}

export function NarrationDock() {
  const n = useNarration();
  const scene = sceneById(n.activeScene);
  const index = SCENES.findIndex((s) => s.id === n.activeScene);
  const ringProgress = n.narratingScene === n.activeScene ? n.progress : 0;

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-3 px-4 pb-4 sm:pb-6">
        <AnimatePresence>
          {n.soundOn && n.captionsOn && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="pointer-events-auto w-full max-w-2xl rounded-2xl border border-line bg-paper/90 px-5 py-3 shadow-card backdrop-blur-xl"
            >
              <Caption />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-auto flex items-center gap-1 rounded-full border border-line bg-paper/85 p-1.5 shadow-float backdrop-blur-xl"
        >
          <button
            type="button"
            onClick={n.togglePlay}
            aria-label={n.playing ? "Pause narration" : "Play narration"}
            className="relative grid h-10 w-10 place-items-center rounded-full bg-ink text-paper transition-transform duration-200 hover:scale-105 active:scale-95"
          >
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 40 40" aria-hidden>
              <circle cx="20" cy="20" r="18.5" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
              <circle
                cx="20"
                cy="20"
                r="18.5"
                fill="none"
                stroke="#A5B4FC"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={116.24}
                strokeDashoffset={116.24 * (1 - ringProgress)}
                style={{ transition: "stroke-dashoffset 120ms linear" }}
              />
            </svg>
            {n.playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
          </button>

          <div className="hidden min-w-0 flex-col px-3 sm:flex">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
              {String(index + 1).padStart(2, "0")} / {String(SCENES.length).padStart(2, "0")}
              {n.tour && n.soundOn ? " · Playing story" : ""}
            </span>
            <span className="max-w-[180px] truncate text-[13px] font-medium text-ink">{scene.label}</span>
          </div>

          <div className="mx-1 h-6 w-px bg-line" />
          <IconButton label="Replay this scene" onClick={n.replay}>
            <RotateCcw size={16} />
          </IconButton>
          <IconButton label={n.soundOn ? "Mute narration" : "Unmute narration"} onClick={n.toggleSound} active={n.soundOn}>
            {n.soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </IconButton>
          <IconButton label={n.captionsOn ? "Hide captions" : "Show captions"} onClick={n.toggleCaptions} active={n.captionsOn}>
            {n.captionsOn ? <Captions size={16} /> : <CaptionsOff size={16} />}
          </IconButton>
          <IconButton label="Open transcript" onClick={() => n.setTranscriptOpen(true)}>
            <FileText size={16} />
          </IconButton>
        </motion.div>
      </div>

      <Transcript />
    </>
  );
}

function Transcript() {
  const n = useNarration();
  return (
    <AnimatePresence>
      {n.transcriptOpen && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-ink/20 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => n.setTranscriptOpen(false)}
          />
          <motion.aside
            role="dialog"
            aria-label="Narration transcript"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-paper shadow-float"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 260, damping: 32 }}
          >
            <div className="flex items-center justify-between border-b border-line px-6 py-5">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">Transcript</p>
                <p className="text-[15px] font-medium">The full narration</p>
              </div>
              <IconButton label="Close transcript" onClick={() => n.setTranscriptOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <ol className="flex-1 space-y-1 overflow-y-auto p-3">
              {SCENES.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => {
                      n.setTranscriptOpen(false);
                      n.goTo(s.id);
                    }}
                    className={`w-full rounded-xl p-4 text-left transition-colors hover:bg-canvas ${
                      n.activeScene === s.id ? "bg-accent-soft/60" : ""
                    }`}
                  >
                    <p className="mb-1 font-mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                      {String(i + 1).padStart(2, "0")} · {s.label}
                    </p>
                    <p className="text-[14px] leading-relaxed text-ink-soft">{s.narration}</p>
                  </button>
                </li>
              ))}
            </ol>
            <p className="border-t border-line px-6 py-4 text-[12px] text-ink-faint">
              Voice:{" "}
              {n.backend === "audio"
                ? "studio voice-over"
                : n.backend === "speech"
                  ? "on-device voice (add pre-rendered audio for studio quality)"
                  : "captions only"}
            </p>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
