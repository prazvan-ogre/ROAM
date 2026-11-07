/**
 * Voice engine with three interchangeable backends:
 *
 *  1. "audio"   — pre-rendered voice-over files listed in /audio/manifest.json
 *                 (generate them with `npm run voiceover`). Best quality.
 *  2. "speech"  — on-device Web Speech synthesis, using the most natural English
 *                 voice the browser offers. Zero setup.
 *  3. "silent"  — captions only, paced at a natural speaking rate. Used when the
 *                 browser has neither of the above.
 *
 * Every backend reports progress as a 0..1 fraction of the narration's characters,
 * which drives the word-by-word captions.
 */

export type VoiceBackend = "audio" | "speech" | "silent";

export type PlayHandlers = {
  onProgress: (fraction: number) => void;
  onEnd: () => void;
};

export interface Voice {
  backend: VoiceBackend;
  play(id: string, text: string, src: string, handlers: PlayHandlers): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

const CHARS_PER_SECOND = 14.5;

export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.?!]+[.?!]+["”’]?\s*|[^.?!]+$/g);
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ audio */

function createAudioVoice(available: Set<string>, fallback: Voice): Voice {
  let el: HTMLAudioElement | null = null;
  let raf = 0;
  let usingFallback = false;
  let current: PlayHandlers | null = null;

  const tick = (onProgress: (f: number) => void) => {
    if (!el) return;
    if (el.duration > 0) onProgress(Math.min(1, el.currentTime / el.duration));
    raf = requestAnimationFrame(() => tick(onProgress));
  };

  const stop = () => {
    cancelAnimationFrame(raf);
    if (el) {
      el.pause();
      el.src = "";
      el = null;
    }
    if (usingFallback) fallback.stop();
    usingFallback = false;
  };

  return {
    backend: "audio",
    play(id, text, src, handlers) {
      stop();
      if (!available.has(id)) {
        usingFallback = true;
        fallback.play(id, text, src, handlers);
        return;
      }
      current = handlers;
      el = new Audio(src);
      el.preload = "auto";
      el.onended = () => {
        cancelAnimationFrame(raf);
        handlers.onProgress(1);
        handlers.onEnd();
      };
      el.onerror = () => {
        stop();
        usingFallback = true;
        fallback.play(id, text, src, handlers);
      };
      el.play().then(
        () => tick(handlers.onProgress),
        () => {
          stop();
          usingFallback = true;
          fallback.play(id, text, src, handlers);
        },
      );
    },
    pause() {
      if (usingFallback) return fallback.pause();
      cancelAnimationFrame(raf);
      el?.pause();
    },
    resume() {
      if (usingFallback) return fallback.resume();
      if (!el || !current) return;
      const h = current;
      el.play().then(() => tick(h.onProgress), () => undefined);
    },
    stop,
  };
}

/* ----------------------------------------------------------------- speech */

const PREFERRED_VOICES = [
  /natural/i,
  /neural/i,
  /premium/i,
  /enhanced/i,
  /google us english/i,
  /google uk english female/i,
  /samantha/i,
  /ava/i,
  /serena/i,
  /daniel/i,
  /aria/i,
  /jenny/i,
];

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
  if (!voices.length) return null;
  for (const pattern of PREFERRED_VOICES) {
    const match = voices.find((v) => pattern.test(v.name));
    if (match) return match;
  }
  return voices.find((v) => v.lang.toLowerCase() === "en-us") ?? voices[0];
}

function createSpeechVoice(silent: Voice): Voice {
  const synth = window.speechSynthesis;
  let usingSilent = false;
  let session = 0;
  let sentences: string[] = [];
  let offsets: number[] = [];
  let total = 1;
  let index = 0;
  let handlers: PlayHandlers | null = null;
  let estimateTimer = 0;
  let paused = false;

  const clearEstimate = () => window.clearInterval(estimateTimer);

  const speakFrom = (i: number) => {
    const my = ++session;
    clearEstimate();
    synth.cancel();
    if (i >= sentences.length) {
      handlers?.onProgress(1);
      handlers?.onEnd();
      return;
    }
    index = i;
    const sentence = sentences[i];
    const u = new SpeechSynthesisUtterance(sentence);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-US";
    u.rate = 0.96;
    u.pitch = 1;

    let gotBoundary = false;
    let started = false;
    const startedAt = performance.now();
    u.onstart = () => (started = true);
    // Watchdog: if the engine never starts speaking, fall back to paced captions.
    window.setTimeout(() => {
      if (my !== session || started || paused || !handlers) return;
      session++;
      clearEstimate();
      synth.cancel();
      usingSilent = true;
      silent.play("", sentences.slice(i).join(" "), "", {
        onProgress: (f) => handlers?.onProgress((offsets[i] + f * (total - offsets[i])) / total),
        onEnd: () => handlers?.onEnd(),
      });
    }, 2500);
    // Some voices never fire boundary events: estimate instead.
    estimateTimer = window.setInterval(() => {
      if (gotBoundary || my !== session || paused) return;
      const spoken = ((performance.now() - startedAt) / 1000) * CHARS_PER_SECOND;
      const local = Math.min(sentence.length * 0.98, spoken);
      handlers?.onProgress((offsets[i] + local) / total);
    }, 80);

    u.onboundary = (e) => {
      if (my !== session) return;
      gotBoundary = true;
      const wordEnd = sentence.slice(e.charIndex).search(/\s|$/);
      handlers?.onProgress((offsets[i] + e.charIndex + Math.max(0, wordEnd)) / total);
    };
    u.onend = () => {
      if (my !== session || paused) return;
      clearEstimate();
      handlers?.onProgress((offsets[i] + sentence.length) / total);
      window.setTimeout(() => my === session && !paused && speakFrom(i + 1), 160);
    };
    u.onerror = () => {
      if (my !== session) return;
      clearEstimate();
    };
    synth.speak(u);
  };

  return {
    backend: "speech",
    play(id, text, src, h) {
      this.stop();
      // Some browsers expose the API but ship no voices: keep the captions running.
      usingSilent = synth.getVoices().length === 0;
      if (usingSilent) return silent.play(id, text, src, h);
      handlers = h;
      paused = false;
      sentences = splitSentences(text);
      offsets = [];
      let acc = 0;
      for (const s of sentences) {
        offsets.push(acc);
        acc += s.length + 1;
      }
      total = Math.max(1, acc);
      speakFrom(0);
    },
    // Chrome's native pause is unreliable, so pause = stop and remember the sentence.
    pause() {
      if (usingSilent) return silent.pause();
      paused = true;
      session++;
      clearEstimate();
      synth.cancel();
    },
    resume() {
      if (usingSilent) return silent.resume();
      if (!paused) return;
      paused = false;
      speakFrom(index);
    },
    stop() {
      silent.stop();
      paused = false;
      session++;
      clearEstimate();
      synth.cancel();
    },
  };
}

/* ----------------------------------------------------------------- silent */

function createSilentVoice(): Voice {
  let timer = 0;
  let elapsed = 0;
  let duration = 1;
  let handlers: PlayHandlers | null = null;
  let last = 0;

  const loop = () => {
    const now = performance.now();
    elapsed += now - last;
    last = now;
    const f = Math.min(1, elapsed / duration);
    handlers?.onProgress(f);
    if (f >= 1) {
      window.clearInterval(timer);
      handlers?.onEnd();
    }
  };

  return {
    backend: "silent",
    play(_id, text, _src, h) {
      window.clearInterval(timer);
      handlers = h;
      elapsed = 0;
      duration = (text.length / CHARS_PER_SECOND) * 1000;
      last = performance.now();
      timer = window.setInterval(loop, 60);
    },
    pause() {
      window.clearInterval(timer);
    },
    resume() {
      last = performance.now();
      window.clearInterval(timer);
      timer = window.setInterval(loop, 60);
    },
    stop() {
      window.clearInterval(timer);
    },
  };
}

/* ---------------------------------------------------------------- factory */

export async function createVoice(): Promise<Voice> {
  const hasSpeech = typeof window !== "undefined" && "speechSynthesis" in window;
  const silent = createSilentVoice();
  const base = hasSpeech ? createSpeechVoice(silent) : silent;

  try {
    const res = await fetch("/audio/manifest.json", { cache: "no-store" });
    if (res.ok) {
      const manifest = (await res.json()) as { files?: string[] };
      const files = new Set(manifest.files ?? []);
      if (files.size) return createAudioVoice(files, base);
    }
  } catch {
    /* no pre-rendered audio — fine */
  }
  return base;
}
