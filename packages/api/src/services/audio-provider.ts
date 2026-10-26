import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AudioClipRecipe } from "./audio-source.js";

/** Published xAI price checked 2026-10-24. Estimates include markup conservatively. */
export const AUDIO_USD_PER_MILLION_CHARACTERS = 15;
export const audioCharacters = (text: string) => Array.from(text).length;
export const audioEstimateUsd = (characters: number) => characters * AUDIO_USD_PER_MILLION_CHARACTERS / 1_000_000;
export interface AudioProviderResult { bytes: Uint8Array; durationMs?: number; evidence: Record<string, unknown> }
export type AudioProvider = (recipe: AudioClipRecipe, signal?: AbortSignal) => Promise<AudioProviderResult>;
export class AudioProviderFailure extends Error {
  constructor(message: string, readonly retryable: boolean, readonly evidence: Record<string, unknown>) { super(message); }
}

/** Probe only. No resampling, normalization, filtering, speed or pitch changes. */
export async function measureAudio(bytes: Uint8Array): Promise<number> {
  const directory = await mkdtemp(join(tmpdir(), "house-audio-"));
  try {
    const path = join(directory, "clip.mp3");
    await writeFile(path, bytes);
    const child = Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_name,codec_type", "-of", "json", path], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), 15_000);
    try {
      const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (status !== 0) throw new Error(`Audio probe failed: ${stderr.slice(0, 200)}`);
      const value = JSON.parse(stdout) as { streams?: { codec_name?: string; codec_type?: string }[]; format?: { duration?: string } };
      const durationMs = Number(value.format?.duration) * 1000;
      if (value.streams?.length !== 1 || value.streams[0]?.codec_name !== "mp3" || value.streams[0]?.codec_type !== "audio" || !Number.isFinite(durationMs) || durationMs <= 0)
        throw new Error("Provider returned invalid MP3 audio");
      return durationMs;
    } finally { clearTimeout(timer); }
  } finally { await rm(directory, { recursive: true, force: true }); }
}
export const generateXaiAudio: AudioProvider = async (recipe, signal) => {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new AudioProviderFailure("XAI_API_KEY is unavailable", false, {});
  const request = { text: recipe.synthesisText, voice_id: recipe.voice.voiceId, language: "en",
    output_format: { codec: recipe.codec, sample_rate: recipe.sampleRate, bit_rate: recipe.bitRate } };
  let response: Response;
  try {
    response = await fetch("https://api.x.ai/v1/tts", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(request), signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])]) });
  } catch (error) {
    // A lost response can already have been billed. Require an explicit retry.
    throw new AudioProviderFailure("xAI audio response unavailable; inspect before retrying", false, { request, transport: error instanceof Error ? error.name : "unknown" });
  }
  const evidence = { request, status: response.status, requestId: response.headers.get("x-request-id") };
  if (!response.ok) throw new AudioProviderFailure(`xAI audio request failed (${response.status})`, response.status === 429 || response.status >= 500,
    { ...evidence, response: (await response.text()).slice(0, 8000) });
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, evidence };
};
