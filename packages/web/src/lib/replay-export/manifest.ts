import { assertNoPrivateFields } from "./source";
import type { ExportCue } from "./cues";
import type { CompiledTiming, TimingProfile } from "./timing";
import type { AudioSchedule } from "./audio";
import type { CachedAsset } from "./assets";
export interface ReplayManifest {
  pages?: Record<string, string[]>;
  layouts?: Record<
    string,
    import("../../components/watch/bubble-typography").BubbleTypography
  >;
  schema: "house.replay-export";
  version: 1;
  game: {
    id: string;
    slug: string;
    kind: "influence" | "werewolf";
    audience?: "mystery" | "omniscient";
  };
  width: number;
  height: number;
  fps: number;
  reducedMotion: boolean;
  thinking: boolean;
  profile: TimingProfile;
  cues: ExportCue[];
  timeline: CompiledTiming[];
  assets: Record<string, CachedAsset>;
  staticFiles: Record<string, string>;
  boundary: {
    eventSequence?: number;
    transcriptCount?: number;
    cursor?: number;
    publicationCutoff?: string;
    publications?: Record<string, number>;
  };
  audio: AudioSchedule;
  range: { fromFrame: number; untilFrame: number };
  revision: string;
  dirty: boolean;
}
export function cueIndexAt(
  timeline: readonly CompiledTiming[],
  timeMs: number,
): number {
  let low = 0,
    high = timeline.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (timeline[mid]!.startMs <= timeMs) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Loaded local bundles are data, never arbitrary paths or network instructions. */
export function validateManifest(value: ReplayManifest): void {
  if (
    !value ||
    value.schema !== "house.replay-export" ||
    value.version !== 1 ||
    !Array.isArray(value.cues) ||
    !value.cues.length ||
    value.cues.length !== value.timeline?.length ||
    !value.staticFiles ||
    !value.assets
  )
    throw new Error("Invalid replay bundle");
  if (
    ![value.width, value.height].every(
      (n) => Number.isSafeInteger(n) && n >= 128 && n <= 7680 && n % 2 === 0,
    ) ||
    !Number.isSafeInteger(value.fps) ||
    value.fps < 1 ||
    value.fps > 120
  )
    throw new Error("Invalid bundle dimensions/FPS");
  if (value.game.audience === "mystery") {
    if (value.thinking) throw new Error("Mystery cannot enable thinking");
    assertNoPrivateFields(value.cues.map((cue) => cue.picture));
  }
  const keys = new Set<string>();
  let boundary = 0;
  for (const [index, cue] of value.cues.entries()) {
    const time = value.timeline[index]!;
    if (
      keys.has(cue.timing.key) ||
      time.key !== cue.timing.key ||
      time.startMs !== boundary ||
      !Number.isFinite(time.endMs) ||
      time.endMs <= time.startMs ||
      time.startFrame !== Math.ceil((time.startMs * value.fps) / 1000) ||
      time.endFrame !== Math.ceil((time.endMs * value.fps) / 1000) ||
      !time.segments.length
    )
      throw new Error("Invalid or discontinuous bundle timeline");
    keys.add(time.key);
    boundary = time.endMs;
    if (cue.picture.kind !== value.game.kind && !(value.game.kind === "werewolf" && cue.picture.kind === "werewolf-opening"))
      throw new Error("Mixed game kinds in bundle");
    if (value.game.audience === "mystery" && cue.picture.kind === "werewolf") {
      const moment = cue.picture.cue.moment;
      if (
        cue.timing.thinking ||
        moment.night ||
        Object.keys(moment.wolfForms ?? {}).length ||
        moment.transformWolfIds?.length ||
        moment.entry.kind === "pack_vote" ||
        (moment.entry.kind === "speech" && moment.entry.audience === "pack")
      )
        throw new Error("Mystery bundle contains private evidence");
    }
  }
  if (
    !Number.isFinite(value.audio?.durationMs) ||
    value.audio.durationMs < boundary
  )
    throw new Error("Invalid bundle duration");
  for (const clip of value.audio.clips)
    if (
      !value.assets[clip.asset] ||
      ![
        clip.startMs,
        clip.endMs,
        clip.offsetMs,
        clip.gain,
        clip.fadeInMs,
        clip.fadeOutMs,
      ].every(Number.isFinite) ||
      clip.startMs < 0 ||
      clip.endMs <= clip.startMs ||
      clip.endMs > value.audio.durationMs ||
      clip.offsetMs < 0 ||
      clip.gain < 0 ||
      clip.gain > 1
    )
      throw new Error("Invalid bundle audio clip");
  const walk = (item: unknown, key = "", parent = "") => {
    if (
      typeof item === "string" &&
      (/url$|^src$/i.test(key) ||
        /wolfForms|portraits|fullBodyReferences/.test(parent)) &&
      item &&
      !item.startsWith("assets/")
    )
      throw new Error("Bundle contains an unfrozen media URL");
    if (Array.isArray(item)) item.forEach((child) => walk(child, key, parent));
    else if (item && typeof item === "object")
      for (const [name, child] of Object.entries(item)) walk(child, name, key);
  };
  walk(value.cues);
}
