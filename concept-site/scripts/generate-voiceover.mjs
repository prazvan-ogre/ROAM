#!/usr/bin/env node
/**
 * Renders the narration in lib/story.ts to studio-quality MP3s in public/audio/
 * and writes public/audio/manifest.json so the site uses them instead of the
 * on-device voice.
 *
 *   ELEVENLABS_API_KEY=… [ELEVENLABS_VOICE_ID=…] npm run voiceover
 *   OPENAI_API_KEY=…     [OPENAI_VOICE=sage]      npm run voiceover
 *
 * Optional: pass scene ids to render only those, e.g. `npm run voiceover -- opening closing`.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "audio");

const STYLE =
  "Calm, confident, warm documentary narrator. Natural human pacing with short pauses between sentences. " +
  "Thoughtful, never salesy. Clear English.";

async function loadScenes() {
  const src = await readFile(path.join(root, "lib", "story.ts"), "utf8");
  const scenes = [];
  const re = /id:\s*"([a-z]+)"[\s\S]*?narration:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src))) scenes.push({ id: m[1], text: m[2] });
  if (!scenes.length) throw new Error("No scenes found in lib/story.ts");
  return scenes;
}

async function elevenlabs(text) {
  const voice = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // a calm narrator voice
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      text,
      model_id: process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2",
      voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function openai(text) {
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts",
      voice: process.env.OPENAI_VOICE || "sage",
      input: text,
      instructions: STYLE,
      response_format: "mp3",
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const render = process.env.ELEVENLABS_API_KEY ? elevenlabs : process.env.OPENAI_API_KEY ? openai : null;
  if (!render) {
    console.error("Set ELEVENLABS_API_KEY or OPENAI_API_KEY to render the voice-over.");
    process.exit(1);
  }
  const only = new Set(process.argv.slice(2));
  const scenes = (await loadScenes()).filter((s) => !only.size || only.has(s.id));
  await mkdir(outDir, { recursive: true });

  for (const s of scenes) {
    process.stdout.write(`→ ${s.id} … `);
    const audio = await render(s.text);
    await writeFile(path.join(outDir, `${s.id}.mp3`), audio);
    console.log(`${(audio.length / 1024).toFixed(0)} KB`);
  }

  const all = await loadScenes();
  const files = all.map((s) => s.id).filter((id) => existsSync(path.join(outDir, `${id}.mp3`)));
  await writeFile(path.join(outDir, "manifest.json"), JSON.stringify({ files }, null, 2) + "\n");
  console.log(`manifest.json lists ${files.length} of ${all.length} scenes.`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
