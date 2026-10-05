import type {WerewolfView, WerewolfPublicEntry, WerewolfAudience} from "./observation";
import type {AcceptedVisualScene} from "../visual-mode";
export interface WerewolfWatchIdentity { id: string; name: string; avatarUrl: string | null; fullBodyReferenceUrl?: string | null; personaKey: string | null; personality: string; backstory: string }
export interface WerewolfWatchMoment {
  cursor: number;
  entry: WerewolfPublicEntry;
  snapshot: Omit<WerewolfView, "entries">;
  chapterId: string;
  sceneId: string;
  mediaKey: string | null;
}
export interface WerewolfWatchIndex { cursor: number; chapterId: string; sceneId: string; label: string }
export interface WerewolfWatchWindow {
  gameId: string; slug: string; status: string; audience: WerewolfAudience; rulesVersion: 7;
  publicationCutoff: string; latestCursor: number; fromCursor: number; throughCursor: number;
  players: WerewolfWatchIdentity[]; moments: WerewolfWatchMoment[]; navigation: WerewolfWatchIndex[];
  /** Compact audience-local scrub index; steps expand a public ballot into its receipts, tally and result. */
  playback: Array<{cursor: number; steps: number}>;
  media: Record<string, AcceptedVisualScene>;
}
export function isWerewolfPlayable(entry: WerewolfPublicEntry): boolean {
  if (entry.kind === "phase") return false;
  if (entry.kind === "speech") return Boolean(entry.text?.trim());
  if (entry.kind === "discussion") return !entry.contribution.unavailable && Boolean(entry.contribution.text?.trim());
  return true;
}
