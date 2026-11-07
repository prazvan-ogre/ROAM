"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { SceneId } from "@/lib/story";

type SceneApi = {
  activeScene: SceneId;
  setActiveScene: (id: SceneId) => void;
  goTo: (id: SceneId) => void;
};

const Ctx = createContext<SceneApi | null>(null);

export function useScenes() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useScenes must be used inside <SceneProvider>");
  return ctx;
}

export function scrollToScene(id: SceneId) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** Tracks which scene is in view, for the chapter rail. */
export function SceneProvider({ children }: { children: ReactNode }) {
  const [activeScene, setActiveScene] = useState<SceneId>("opening");
  const value = useMemo(() => ({ activeScene, setActiveScene, goTo: scrollToScene }), [activeScene]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
