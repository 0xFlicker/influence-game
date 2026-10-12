import {validateSpeechManifest, validateAlignment, type SpeechAttachment, type ProductionRecording} from "./speech-contract";
import type {PresentationMoment} from "./presentation";
import type {CachedAsset} from "./assets";

type Binding = {entry: SpeechAttachment; momentId: string; text: string; file?: File};
type Prepared = {metadata: ProductionRecording; asset: CachedAsset};
export interface BrowserSpeechImport {bindings: Map<string, Binding>; prepared: Map<string, Prepared>}
async function hash(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/** Validate every manifest identity before reading any recording. Files stay local to this editor scope. */
export async function importBrowserSpeech(files: readonly File[], source: readonly PresentationMoment[], signal: AbortSignal): Promise<BrowserSpeechImport> {
  const manifests = files.filter(file => file.name.toLowerCase().endsWith(".json"));
  if (manifests.length !== 1) throw new Error("Choose one speech manifest JSON together with its audio files");
  const manifest = manifests[0]!;
  if (manifest.size > 2_000_000) throw new Error("Speech manifest exceeds 2 MB");
  const permitted = source.flatMap(moment => moment.segments.map(cue => ({...cue, momentId: moment.id})));
  const entries = await validateSpeechManifest(JSON.parse(await manifest.text()), permitted, text => hash(new TextEncoder().encode(text).buffer)); signal.throwIfAborted();
  const supplied = new Map<string, File>();
  for (const file of files) {
    if (supplied.has(file.name)) throw new Error(`Duplicate local filename: ${file.name}`);
    supplied.set(file.name, file);
  }
  const bindings = new Map<string, Binding>();
  for (const {entry, cue} of entries) {
    signal.throwIfAborted();
    if (/[\\/]/.test(entry.file) || entry.file === "." || entry.file === "..") throw new Error("Browser speech manifests require plain audio filenames");
    bindings.set(cue.momentId!, {entry, momentId: cue.momentId!, text: cue.speech!.text, file: supplied.get(entry.file)});
  }
  signal.throwIfAborted();
  return {bindings, prepared: new Map()};
}

async function prepare(binding: Binding, signal: AbortSignal): Promise<Prepared> {
  if (!binding.file) throw new Error(`Choose the local audio file for selected speech: ${binding.entry.file}`);
  const sha256 = await hash(await binding.file.arrayBuffer()); signal.throwIfAborted();
  const url = URL.createObjectURL(binding.file), audio = document.createElement("audio");
  try {
    audio.preload = "metadata";
    await new Promise<void>((accept, reject) => {
      const done = (error?: Error) => {clearTimeout(timeout); signal.removeEventListener("abort", aborted); audio.onloadedmetadata = null; audio.onerror = null; if (error) reject(error); else accept();};
      const aborted = () => done(new DOMException("Recording preparation cancelled", "AbortError"));
      const timeout = setTimeout(() => done(new Error(`Recording metadata timed out: ${binding.entry.file}`)), 30_000);
      signal.addEventListener("abort", aborted, {once: true}); audio.onerror = () => done(new Error(`Recording could not load: ${binding.entry.file}`)); audio.onloadedmetadata = () => done(); audio.src = url;
    });
    signal.throwIfAborted();
    const durationMs = audio.duration * 1000;
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > 86_400_000) throw new Error("Recording requires a finite positive duration of at most one day");
    const alignment = binding.entry.alignment ? validateAlignment(binding.entry.alignment, binding.text, durationMs) : undefined;
    return {metadata: {momentId: binding.momentId, messageId: binding.entry.messageId, speakerId: binding.entry.speakerId, textHash: binding.entry.textHash, sha256, durationMs, ...(alignment && {alignment})}, asset: {path: url, sha256, durationMs, mediaType: "audio"}};
  } catch (error) {URL.revokeObjectURL(url); throw error;}
  finally {audio.removeAttribute("src"); audio.load();}
}

/** Preparation touches only playable speech. The shared compiler and Remotion own all scheduling. */
export async function prepareBrowserSpeech(imported: BrowserSpeechImport, source: readonly PresentationMoment[], selectedIds: readonly string[], signal: AbortSignal): Promise<{source: PresentationMoment[]; assets: Record<string, CachedAsset>; recordings: ProductionRecording[]}> {
  const selected = new Set(selectedIds), assets: Record<string, CachedAsset> = {}, recordings: ProductionRecording[] = [];
  for (const id of selected) {
    const binding = imported.bindings.get(id); if (!binding) continue;
    let recording = imported.prepared.get(id);
    if (!recording) {
      recording = await prepare(binding, signal);
      if (signal.aborted) {URL.revokeObjectURL(recording.asset.path); signal.throwIfAborted();}
      imported.prepared.set(id, recording);
    }
    assets[recording.asset.path] = recording.asset; recordings.push(recording.metadata);
  }
  signal.throwIfAborted();
  return {source: source.map(moment => {
    const recording = selected.has(moment.id) ? imported.prepared.get(moment.id) : undefined;
    if (!recording) return moment;
    return {...moment, segments: moment.segments.map(cue => cue.speech?.messageId === recording.metadata.messageId ? {...cue, timing: {...cue.timing, recording: {assetId: recording.asset.path, durationMs: recording.metadata.durationMs}}, ...(recording.metadata.alignment && {alignment: recording.metadata.alignment})} : cue)};
  }), assets, recordings};
}

export function disposeBrowserSpeech(imported: BrowserSpeechImport): void {
  imported.prepared.forEach(recording => URL.revokeObjectURL(recording.asset.path)); imported.prepared.clear();
}
