import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { validHeadRectangle, type HeadRectangle } from "@influence/engine/character-portrait";
import { sha256StableJson } from "./stable-hash.js";

interface Asset { path: string; sha256: string }
interface Entry {
  gameId: string; playerId: string; publishedAt: string; head: HeadRectangle;
  assets: { body: Asset; cutout: Asset; portrait: Asset };
}
export interface LocalCharacterArt {
  revision: string; publishedAt: string; fullBodyUrl: string; portraitUrl: string; head: HeadRectangle;
}

/** Outbound portrait projection; preserve the canonical input and all non-art fields. */
export function applyLocalCharacterPortraits<T extends { id: string }>(players: readonly T[], art: Record<string, LocalCharacterArt>): T[] {
  return players.map(player => art[player.id] ? { ...player, avatarUrl: art[player.id]!.portraitUrl } : player);
}

/** Explicit local editorial data only. Never consulted by execution or contestant context. */
async function entries(): Promise<Entry[]> {
  const path = process.env.INFLUENCE_LOCAL_CHARACTER_ART_MANIFEST;
  if (!path) return [];
  const host = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).hostname : "";
  if (["production", "staging"].includes(process.env.NODE_ENV ?? "") || process.env.INFLUENCE_DEPLOYMENT_ENVIRONMENT
    || !["localhost", "127.0.0.1", "[::1]"].includes(host)) throw new Error("Character art manifest is restricted to an unbound localhost database");
  if (!isAbsolute(path)) throw new Error("Character art manifest requires an absolute path");
  const data = JSON.parse(await readFile(path, "utf8"));
  if (data?.version !== 1 || !Array.isArray(data.entries)) throw new Error("Invalid local character art manifest");
  const identities = new Set<string>();
  for (const entry of data.entries) {
    if (!entry || typeof entry.gameId !== "string" || !entry.gameId || typeof entry.playerId !== "string" || !entry.playerId
      || typeof entry.publishedAt !== "string" || !Number.isFinite(Date.parse(entry.publishedAt))
      || new Date(entry.publishedAt).toISOString() !== entry.publishedAt || !validHeadRectangle(entry.head)) throw new Error("Invalid local character art binding");
    for (const kind of ["body", "cutout", "portrait"] as const) {
      const asset = entry.assets?.[kind];
      if (!asset || typeof asset.path !== "string" || !isAbsolute(asset.path) || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error("Invalid local character art asset");
    }
    const identity = JSON.stringify([entry.gameId, entry.playerId, entry.publishedAt]);
    if (identities.has(identity)) throw new Error("Ambiguous local character art publication");
    identities.add(identity);
  }
  return data.entries;
}
function revision(entry: Entry) {
  // Paths may move; immutable bytes and coordinates define the presentation identity.
  return sha256StableJson({ gameId: entry.gameId, playerId: entry.playerId, publishedAt: entry.publishedAt,
    head: entry.head, assets: Object.fromEntries(Object.entries(entry.assets).map(([kind, asset]) => [kind, asset.sha256])) }).slice(7);
}
export async function localCharacterArt(gameId: string, playerIds: readonly string[], cutoff = new Date().toISOString(), producer = false): Promise<Record<string, LocalCharacterArt>> {
  const selected = new Map<string, Entry>();
  for (const entry of await entries()) {
    if (entry.gameId !== gameId || !playerIds.includes(entry.playerId) || entry.publishedAt > cutoff) continue;
    if (!selected.has(entry.playerId) || selected.get(entry.playerId)!.publishedAt < entry.publishedAt) selected.set(entry.playerId, entry);
  }
  return Object.fromEntries([...selected].map(([id, entry]) => {
    const rev = revision(entry);
    const root = producer ? "/api/admin/production/games" : "/api/games";
    const url = `${root}/${encodeURIComponent(gameId)}/local-character-art/${encodeURIComponent(id)}/${rev}`;
    return [id, { revision: rev, publishedAt: entry.publishedAt, fullBodyUrl: `${url}/cutout`, portraitUrl: `${url}/portrait`, head: entry.head }];
  }));
}
export async function readLocalCharacterArt(gameId: string, playerId: string, rev: string, kind: string) {
  if (!["body", "cutout", "portrait"].includes(kind)) return null;
  const entry = (await entries()).find(entry => entry.gameId === gameId && entry.playerId === playerId && revision(entry) === rev && entry.publishedAt <= new Date().toISOString());
  if (!entry) return null;
  const asset = entry.assets[kind as keyof Entry["assets"]];
  const bytes = await readFile(asset.path);
  if (createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("Local character art integrity check failed");
  const contentType = bytes.toString("ascii", 0, 4) === "RIFF" ? "image/webp" : "image/png";
  return { bytes, contentType, sha256: asset.sha256 };
}
