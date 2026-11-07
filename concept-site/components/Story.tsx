"use client";

import { MotionConfig } from "framer-motion";
import { SceneProvider } from "@/components/SceneProvider";
import { FilmProvider } from "@/components/film/FilmPlayer";
import { Atmosphere, ChapterNav, TopBar } from "@/components/ui/Chrome";
import { OpeningScene } from "@/components/scenes/OpeningScene";
import { CompetitionScene } from "@/components/scenes/CompetitionScene";
import { CostsScene } from "@/components/scenes/CostsScene";
import { ValueScene } from "@/components/scenes/ValueScene";
import { PlatformScene } from "@/components/scenes/PlatformScene";
import { BeforeScene } from "@/components/scenes/BeforeScene";
import { AfterScene } from "@/components/scenes/AfterScene";
import { ClosingScene } from "@/components/scenes/ClosingScene";

export function Story() {
  return (
    <MotionConfig reducedMotion="user">
      <SceneProvider>
        <FilmProvider>
          <Atmosphere />
          <TopBar />
          <ChapterNav />
          <main className="relative">
            <OpeningScene />
            <CompetitionScene />
            <CostsScene />
            <ValueScene />
            <PlatformScene />
            <BeforeScene />
            <AfterScene />
            <ClosingScene />
          </main>
        </FilmProvider>
      </SceneProvider>
    </MotionConfig>
  );
}
