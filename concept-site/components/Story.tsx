"use client";

import { MotionConfig } from "framer-motion";
import { NarrationProvider } from "@/components/narration/NarrationProvider";
import { NarrationDock } from "@/components/narration/NarrationDock";
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
      <NarrationProvider>
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
        <NarrationDock />
      </NarrationProvider>
    </MotionConfig>
  );
}
