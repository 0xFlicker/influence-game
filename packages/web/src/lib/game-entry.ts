import { apiFetch } from "./api";
import { gamePathSegment } from "./game-links";

export interface GameEntryIdentity { id: string; slug: string; gameKind: "influence" | "werewolf" }
export function getGameEntry(key: string, signal?: AbortSignal): Promise<GameEntryIdentity> {
  return apiFetch(`/api/game-entries/${gamePathSegment(key)}`, { signal });
}
