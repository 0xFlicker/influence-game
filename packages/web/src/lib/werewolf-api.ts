import { apiFetch } from "./api";
import type { WerewolfAudience, WerewolfView } from "@influence/engine/werewolf/observation";
import type { WerewolfPreset } from "@influence/engine/werewolf/types";

export interface WerewolfGameSummary { id: string; slug: string; status: string; playerCount: number; createdAt: string }
export interface WerewolfRead { slug: string; status: string; latestCursor: number; view: WerewolfView }
export const listWerewolfGames = () => apiFetch<WerewolfGameSummary[]>("/api/werewolf", { cache: "no-store" });
export const getWerewolf = (slug: string, audience: WerewolfAudience, cursor: number | null, signal?: AbortSignal) =>
  apiFetch<WerewolfRead>(`/api/werewolf/${encodeURIComponent(slug)}?audience=${audience}${cursor === null ? "" : `&cursor=${cursor}`}`, { cache: "no-store", signal });
export const createWerewolf = (preset: WerewolfPreset, agentProfileIds: string[], catalogId: string) =>
  apiFetch<{ id: string; slug: string }>("/api/werewolf", { method: "POST", body: JSON.stringify({ preset, agentProfileIds, providerManifest: [{ catalogId }] }) });
export const stopWerewolf = (id: string) => apiFetch(`/api/werewolf/${encodeURIComponent(id)}/stop`, { method: "POST" });
