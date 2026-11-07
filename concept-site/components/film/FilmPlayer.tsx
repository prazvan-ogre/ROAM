"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Play, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { FILM } from "@/lib/story";

type FilmApi = { available: boolean; open: () => void };
const Ctx = createContext<FilmApi>({ available: false, open: () => undefined });

export const useFilm = () => useContext(Ctx);

/** Turns a YouTube/Vimeo page link into an autoplaying embed URL; null for plain video files. */
function embedUrl(src: string): string | null {
  const yt = src.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&rel=0&modestbranding=1`;
  const vimeo = src.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}?autoplay=1&title=0&byline=0&portrait=0`;
  return null;
}

export function FilmProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const available = FILM.src.trim().length > 0;
  const open = useCallback(() => available && setOpen(true), [available]);
  const value = useMemo(() => ({ available, open }), [available, open]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [isOpen]);

  const embed = available ? embedUrl(FILM.src) : null;

  return (
    <Ctx.Provider value={value}>
      {children}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Promotional film"
            className="fixed inset-0 z-[60] grid place-items-center bg-ink/80 p-4 backdrop-blur-md sm:p-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close film"
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-paper/10 text-paper transition-colors hover:bg-paper/20 sm:right-8 sm:top-8"
            >
              <X size={18} />
            </button>
            <motion.div
              initial={{ scale: 0.94, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.96, y: 10 }}
              transition={{ type: "spring", stiffness: 220, damping: 26 }}
              onClick={(e) => e.stopPropagation()}
              className="aspect-video w-full max-w-6xl overflow-hidden rounded-2xl bg-black shadow-2xl"
            >
              {embed ? (
                <iframe
                  src={embed}
                  title="Promotional film"
                  className="h-full w-full"
                  allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                  allowFullScreen
                />
              ) : (
                <video
                  src={FILM.src}
                  poster={FILM.poster || undefined}
                  className="h-full w-full"
                  controls
                  autoPlay
                  playsInline
                />
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Ctx.Provider>
  );
}

/** "Watch the film" button. Renders nothing until FILM.src is set. */
export function WatchFilmButton({ tone = "dark", className = "" }: { tone?: "dark" | "light"; className?: string }) {
  const { available, open } = useFilm();
  if (!available) return null;
  const styles =
    tone === "dark"
      ? "bg-ink text-paper shadow-float hover:bg-accent-deep"
      : "bg-paper text-ink hover:shadow-[0_12px_40px_-8px_rgba(165,180,252,0.7)]";
  return (
    <button
      type="button"
      onClick={open}
      className={`group inline-flex items-center gap-2.5 rounded-full py-2 pl-2 pr-5 text-[14px] font-medium transition-all duration-300 ease-cine hover:-translate-y-0.5 ${styles} ${className}`}
    >
      <span
        className={`grid h-8 w-8 place-items-center rounded-full transition-transform duration-300 group-hover:scale-110 ${
          tone === "dark" ? "bg-paper/15" : "bg-ink/10"
        }`}
      >
        <Play size={13} fill="currentColor" className="ml-0.5" />
      </span>
      Watch the film{FILM.duration ? ` · ${FILM.duration}` : ""}
    </button>
  );
}
