import { resolve, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { sha256, type ReplayAssets } from "./assets";
import type { ExportCue } from "./cues";
export interface SpeechAlignment {
  textStart: number;
  textEnd: number;
  startMs: number;
  endMs: number;
}
export interface SpeechAttachment {
  messageId: string;
  speakerId: string | null;
  textHash: string;
  file: string;
  alignment?: SpeechAlignment[];
}
export function validateAlignment(
  value: unknown,
  text: string,
  durationMs: number,
): SpeechAlignment[] {
  if (!Array.isArray(value) || !value.length)
    throw new Error("Speech alignment must contain spans");
  let lastText = 0,
    lastTime = 0;
  const spans: SpeechAlignment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object")
      throw new Error("Invalid speech alignment span");
    const span = item as SpeechAlignment;
    if (
      Object.keys(span).sort().join() !== "endMs,startMs,textEnd,textStart" ||
      !Number.isSafeInteger(span.textStart) ||
      !Number.isSafeInteger(span.textEnd) ||
      span.textStart !== lastText ||
      span.textEnd <= span.textStart ||
      span.textEnd > text.length ||
      !Number.isFinite(span.startMs) ||
      !Number.isFinite(span.endMs) ||
      span.startMs < lastTime ||
      span.endMs <= span.startMs ||
      span.endMs > durationMs
    )
      throw new Error(
        "Speech alignment must cover text in order within the recording",
      );
    spans.push(span);
    lastText = span.textEnd;
    lastTime = span.endMs;
  }
  if (lastText !== text.length)
    throw new Error("Speech alignment does not cover the whole message");
  return spans;
}
export async function attachSpeech(
  path: string,
  cues: ExportCue[],
  assets: Pick<ReplayAssets, "cache" | "table">,
) {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(value))
    throw new Error("Speech manifest must be an array");
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object")
      throw new Error("Invalid speech attachment");
    const entry = item as SpeechAttachment;
    if (
      Object.keys(entry).some(
        (key) =>
          !["messageId", "speakerId", "textHash", "file", "alignment"].includes(
            key,
          ),
      ) ||
      typeof entry.messageId !== "string" ||
      typeof entry.file !== "string" ||
      seen.has(entry.messageId)
    )
      throw new Error("Invalid or duplicate speech attachment");
    seen.add(entry.messageId);
    const matches = cues.filter(
      (cue) => cue.speech?.messageId === entry.messageId,
    );
    if (matches.length !== 1)
      throw new Error(
        `Speech message is missing or ambiguous: ${entry.messageId}`,
      );
    const cue = matches[0]!,
      speech = cue.speech!;
    if (
      speech.speakerId !== entry.speakerId ||
      sha256(speech.text) !== entry.textHash
    )
      throw new Error(`Speech speaker/text mismatch: ${entry.messageId}`);
    const assetId = await assets.cache(
        resolve(dirname(path), entry.file),
        true,
      ),
      asset = assets.table[assetId]!;
    if (asset.mediaType !== "audio")
      throw new Error("Speech attachment must be audio");
    cue.timing.recording = { assetId, durationMs: asset.durationMs! };
    if (entry.alignment)
      cue.alignment = validateAlignment(
        entry.alignment,
        speech.text,
        asset.durationMs!,
      );
  }
}
