import type { GameSummary } from "@/lib/api";
import type { WerewolfGameSummary } from "@/lib/werewolf-api";

export type PagedGameItem = { kind: "influence"; game: GameSummary } | { kind: "werewolf"; game: WerewolfGameSummary };
export type PagedGamesPage = { items: PagedGameItem[]; nextCursor: string | null };

export function decodePagedGamesPage(value: unknown): PagedGamesPage {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid library response");
  const data = value as { items?: unknown; nextCursor?: unknown };
  if (!Array.isArray(data.items) || data.items.length > 20 || !(data.nextCursor === null || (typeof data.nextCursor === "string" && data.nextCursor.length > 0 && data.nextCursor.length <= 8192 && /^[A-Za-z0-9_-]+$/.test(data.nextCursor)))) throw new Error("Invalid library response");
  for (const item of data.items) {
    if (!item || typeof item !== "object" || !["influence", "werewolf"].includes(item.kind) || !item.game || typeof item.game.id !== "string" || !item.game.id) throw new Error("Invalid library response");
  }
  return { items: data.items as PagedGameItem[], nextCursor: data.nextCursor };
}
