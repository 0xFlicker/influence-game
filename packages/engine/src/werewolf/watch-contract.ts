import type {WerewolfView, WerewolfPublicEntry, WerewolfAudience} from "./observation";
import type {AcceptedVisualScene} from "../visual-mode";
export interface WerewolfWatchIdentity { id: string; name: string; avatarUrl: string | null; fullBodyReferenceUrl?: string | null; personaKey: string | null; personality: string; backstory: string }
export type WerewolfNightAction =
  | { kind: "protect"; actorId: string; targetId: string }
  | { kind: "investigate"; actorId: string; targetId: string; isWolf: boolean }
  | { kind: "hunt"; wolfIds: string[]; targetId: string };
export interface WerewolfWatchMoment {
  cursor: number;
  entry: WerewolfPublicEntry;
  snapshot: Omit<WerewolfView, "entries">;
  chapterId: string;
  sceneId: string;
  mediaKey: string | null;
  /** Omniscient-only staging before the resolved night outcome. */
  night?: { actions: WerewolfNightAction[]; before: Omit<WerewolfView, "entries"> };
}
export interface WerewolfWatchIndex { cursor: number; chapterId: string; sceneId: string; label: string }
export interface WerewolfWatchWindow {
  gameId: string; slug: string; status: string; audience: WerewolfAudience; rulesVersion: 7;
  publicationCutoff: string; latestCursor: number; fromCursor: number; throughCursor: number;
  players: WerewolfWatchIdentity[]; moments: WerewolfWatchMoment[]; navigation: WerewolfWatchIndex[];
  /** Compact audience-local scrub index; steps expand ballots and permitted night actions before their outcomes. */
  playback: Array<{cursor: number; steps: number}>;
  media: Record<string, AcceptedVisualScene>;
}
export function isWerewolfPlayable(entry: WerewolfPublicEntry): boolean {
  if (entry.kind === "phase") return false;
  if (entry.kind === "speech") return Boolean(entry.text?.trim());
  if (entry.kind === "discussion") return !entry.contribution.unavailable && Boolean(entry.contribution.text?.trim());
  return true;
}
