import { resolve, dirname } from "node:path";
import { readFile } from "node:fs/promises";
import { sha256, type ReplayAssets } from "./assets";
import type { ExportCue } from "./cues";
import {validateAlignment,validateSpeechManifest,type ProductionRecording} from "./speech-contract";
import {stableProductionJson} from "@influence/engine/production-moments/export";
export {validateAlignment} from "./speech-contract";
export type {SpeechAlignment, SpeechAttachment} from "./speech-contract";
export async function attachSpeech(
  path: string,
  cues: ExportCue[],
  assets: Pick<ReplayAssets, "cache" | "table">,
  permittedSpeech: readonly ExportCue[] = cues,
  frozen?:readonly ProductionRecording[],
) {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  const validated = await validateSpeechManifest(value,permittedSpeech,sha256);
  if (frozen?.some(recording => !validated.some(({entry}) => entry.messageId === recording.messageId))) throw new Error("Frozen recording is missing from the local speech manifest");
  const selectedSpeech = new Map<string,ExportCue>();
  for (const cue of cues) {
    if (!cue.speech) continue;
    if (selectedSpeech.has(cue.speech.messageId)) throw new Error(`Selected speech message is ambiguous: ${cue.speech.messageId}`);
    selectedSpeech.set(cue.speech.messageId,cue);
  }
  const frozenByMessage = new Map(frozen?.map(recording => [recording.messageId,recording]));
  for (const recording of frozen ?? []) {
    if (selectedSpeech.get(recording.messageId)?.momentId !== recording.momentId)
      throw new Error(`Frozen recording has no matching selected moment: ${recording.messageId}`);
  }
  for (const {entry,cue} of validated) {
    const speech = cue.speech!;
    // Validate the complete authorized speech catalog first. Omitted files are never opened or cached.
    const selectedCue = selectedSpeech.get(entry.messageId);
    if (!selectedCue) continue;
    const expected = frozenByMessage.get(entry.messageId);
    if (frozen && !expected) continue;
    if (expected && (expected.messageId !== entry.messageId || expected.speakerId !== entry.speakerId || expected.textHash !== entry.textHash
      || stableProductionJson(expected.alignment) !== stableProductionJson(entry.alignment))) throw new Error(`Frozen speech reference changed: ${entry.messageId}`);
    const assetId = await assets.cache(
        resolve(dirname(path), entry.file),
        true,
      ),
      asset = assets.table[assetId]!;
    if (asset.mediaType !== "audio")
      throw new Error("Speech attachment must be audio");
    if (expected && (asset.sha256 !== expected.sha256 || Math.abs(asset.durationMs!-expected.durationMs) > 50)) throw new Error(`Frozen recording bytes/duration changed: ${entry.messageId}`);
    selectedCue.timing.recording = { assetId, durationMs: expected?.durationMs ?? asset.durationMs! };
    if (entry.alignment)
      selectedCue.alignment = validateAlignment(
        entry.alignment,
        speech.text,
        asset.durationMs!,
      );
  }
}
