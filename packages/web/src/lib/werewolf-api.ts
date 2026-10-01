import type { WerewolfPresentation } from "@influence/engine/werewolf/presentation";
import { apiFetch, resolveApiUrl } from "./api";
import type { WerewolfAudience } from "@influence/engine/werewolf/observation";
import type { WerewolfPreset } from "@influence/engine/werewolf/types";

export interface WerewolfGameSummary { id: string; slug: string; status: string; playerCount: number; createdAt: string }
export const listWerewolfGames = () => apiFetch<WerewolfGameSummary[]>("/api/werewolf", { cache: "no-store" });
export const createWerewolf = (preset: WerewolfPreset, agentProfileIds: string[], catalogId: string) =>
  apiFetch<{ id: string; slug: string }>("/api/werewolf", { method: "POST", body: JSON.stringify({ preset, agentProfileIds, providerManifest: [{ catalogId }] }) });
export const stopWerewolf = (id: string) => apiFetch(`/api/werewolf/${encodeURIComponent(id)}/stop`, { method: "POST" });

export async function getWerewolfPresentation(slug: string, audience: WerewolfAudience, cursor: number | null, signal?: AbortSignal, publishedBefore?: string): Promise<WerewolfPresentation> {
  const data = await apiFetch<WerewolfPresentation>(`/api/werewolf/${encodeURIComponent(slug)}/presentation?audience=${audience}${cursor === null ? "" : `&cursor=${cursor}`}${publishedBefore ? `&publishedBefore=${encodeURIComponent(publishedBefore)}` : ""}`, { cache: "no-store", signal });
  const image = (url: string) => url ? resolveApiUrl(url) : url;
  return { ...data, view: { ...data.view, players: data.view.players.map(p => ({ ...p, avatarUrl: p.avatarUrl ? image(p.avatarUrl) : null })) }, scene: data.scene ? { ...data.scene, imageUrl: image(data.scene.imageUrl), ...(data.scene.shots ? { shots: { ...data.scene.shots, groups: data.scene.shots.groups.map(s => ({ ...s, imageUrl: image(s.imageUrl) })), overview: data.scene.shots.overview ? { ...data.scene.shots.overview, imageUrl: image(data.scene.shots.overview.imageUrl) } : null } } : {}) } : null };
}
