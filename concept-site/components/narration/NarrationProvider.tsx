"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SCENES, sceneById, type SceneId } from "@/lib/story";
import { createVoice, type Voice, type VoiceBackend } from "./voice";

type NarrationState = {
  /** Narration is switched on (the viewer opted in). */
  soundOn: boolean;
  /** A narration is currently being spoken (not paused). */
  playing: boolean;
  /** Auto-advance to the next scene when narration ends. */
  tour: boolean;
  captionsOn: boolean;
  activeScene: SceneId;
  narratingScene: SceneId | null;
  progress: number;
  backend: VoiceBackend | null;
  transcriptOpen: boolean;
};

type NarrationApi = NarrationState & {
  startStory: () => void;
  toggleSound: () => void;
  togglePlay: () => void;
  replay: () => void;
  stopTour: () => void;
  toggleCaptions: () => void;
  setTranscriptOpen: (open: boolean) => void;
  setActiveScene: (id: SceneId) => void;
  goTo: (id: SceneId) => void;
};

const Ctx = createContext<NarrationApi | null>(null);

export function useNarration() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useNarration must be used inside <NarrationProvider>");
  return ctx;
}

/** Scene a programmatic scroll is heading to; scenes passed on the way are not narrated. */
let scrollTarget: SceneId | null = null;
let scrollTargetTimer = 0;

export function scrollToScene(id: SceneId) {
  scrollTarget = id;
  window.clearTimeout(scrollTargetTimer);
  scrollTargetTimer = window.setTimeout(() => (scrollTarget = null), 2500);
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function NarrationProvider({ children }: { children: ReactNode }) {
  const voiceRef = useRef<Voice | null>(null);
  const [backend, setBackend] = useState<VoiceBackend | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tour, setTour] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [activeScene, setActiveSceneState] = useState<SceneId>("opening");
  const [narratingScene, setNarratingScene] = useState<SceneId | null>(null);
  const [progress, setProgress] = useState(0);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const tourRef = useRef(tour);
  tourRef.current = tour;
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  useEffect(() => {
    let cancelled = false;
    createVoice().then((v) => {
      if (cancelled) return;
      voiceRef.current = v;
      setBackend(v.backend);
    });
    // warm up the voice list (Chrome loads voices asynchronously)
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
    return () => {
      cancelled = true;
      voiceRef.current?.stop();
    };
  }, []);

  const speak = useCallback((id: SceneId) => {
    const voice = voiceRef.current;
    if (!voice) return;
    const scene = sceneById(id);
    setNarratingScene(id);
    setProgress(0);
    setPlaying(true);
    voice.play(id, scene.narration, scene.audio, {
      onProgress: setProgress,
      onEnd: () => {
        setPlaying(false);
        if (!tourRef.current || !soundRef.current) return;
        const i = SCENES.findIndex((s) => s.id === id);
        const next = SCENES[i + 1];
        if (next) {
          window.setTimeout(() => {
            if (tourRef.current && soundRef.current) scrollToScene(next.id);
          }, 1100);
        } else {
          setTour(false);
        }
      },
    });
  }, []);

  // Follow the viewer: when narration is on, the scene in view is the one narrated.
  useEffect(() => {
    if (!soundOn) return;
    if (narratingScene === activeScene) return;
    if (scrollTarget && scrollTarget !== activeScene) return;
    const t = window.setTimeout(() => {
      scrollTarget = null;
      speak(activeScene);
    }, 450);
    return () => window.clearTimeout(t);
  }, [activeScene, soundOn, narratingScene, speak]);

  const stopAll = useCallback(() => {
    voiceRef.current?.stop();
    setPlaying(false);
    setNarratingScene(null);
    setProgress(0);
  }, []);

  const startStory = useCallback(() => {
    setSoundOn(true);
    setTour(true);
    if (activeScene !== "opening") {
      setNarratingScene(null);
      scrollToScene("opening");
    } else {
      speak("opening");
    }
  }, [activeScene, speak]);

  const toggleSound = useCallback(() => {
    if (soundRef.current) {
      setSoundOn(false);
      setTour(false);
      stopAll();
    } else {
      setSoundOn(true);
      speak(activeScene);
    }
  }, [activeScene, speak, stopAll]);

  const togglePlay = useCallback(() => {
    const voice = voiceRef.current;
    if (!voice) return;
    if (!soundRef.current) {
      setSoundOn(true);
      speak(activeScene);
      return;
    }
    if (playing) {
      voice.pause();
      setPlaying(false);
    } else if (narratingScene === activeScene && progress < 1) {
      voice.resume();
      setPlaying(true);
    } else {
      speak(activeScene);
    }
  }, [activeScene, narratingScene, playing, progress, speak]);

  const replay = useCallback(() => {
    setSoundOn(true);
    speak(activeScene);
  }, [activeScene, speak]);

  const value = useMemo<NarrationApi>(
    () => ({
      soundOn,
      playing,
      tour,
      captionsOn,
      activeScene,
      narratingScene,
      progress,
      backend,
      transcriptOpen,
      startStory,
      toggleSound,
      togglePlay,
      replay,
      stopTour: () => setTour(false),
      toggleCaptions: () => setCaptionsOn((c) => !c),
      setTranscriptOpen,
      setActiveScene: setActiveSceneState,
      goTo: scrollToScene,
    }),
    [
      soundOn,
      playing,
      tour,
      captionsOn,
      activeScene,
      narratingScene,
      progress,
      backend,
      transcriptOpen,
      startStory,
      toggleSound,
      togglePlay,
      replay,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
