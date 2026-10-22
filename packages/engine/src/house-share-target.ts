import { parseReplayAudience, parseReplayCursor, parseReplaySequenceParam } from "./game-links";
import { parseReplayShare, REPLAY_SHARE_KEYS } from "./replay-share-state";

export const SHARE_CODE_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{10}$/;
export interface HouseShareTarget {
  path: string;
  kind: "game" | "profile" | "page";
  identifier?: string;
  mode?: "replay" | "results" | "highlights";
  sequence?: string;
}

/** Only app-relative public routes. Never accept a redirect URL or an auth token. */
export function parseHouseShareTarget(input: unknown): HouseShareTarget {
  const invalid = () => new Error("Unsupported House share link.");
  if (typeof input !== "string" || input.length > 2048 || !input.startsWith("/") || input.startsWith("//")
    || /[\\\x00-\x20]/.test(input)) throw invalid();
  const url = new URL(input, "https://thehouse.game");
  // Reject normalization tricks (dot segments, encoded separators, duplicate slashes).
  if (url.origin !== "https://thehouse.game" || url.pathname !== input.split(/[?#]/)[0]) throw invalid();
  const parts = url.pathname.split("/").slice(1).map(part => decodeURIComponent(part));
  if (parts.some(part => !/^[a-zA-Z0-9_-]*$/.test(part))) throw invalid();
  const allowed = new Set<string>();
  let target: Omit<HouseShareTarget, "path">;
  const [root, id, mode, sequence] = parts;
  if (root === "games" && id && !["new", "free", "public", "type", "season"].includes(id) && parts.length <= 4) {
    if (mode !== undefined && !["replay", "results", "highlights"].includes(mode)) throw invalid();
    if (sequence !== undefined && (mode !== "replay" || parseReplaySequenceParam(sequence) === undefined)) throw invalid();
    target = { kind: "game", identifier: id, mode: mode as HouseShareTarget["mode"], sequence };
    if (mode === "replay") for (const key of [...REPLAY_SHARE_KEYS, "audience", "cursor"]) allowed.add(key);
    if (mode === "highlights") for (const key of ["scene", "audience"]) allowed.add(key);
  } else if (root === "profile" && id && parts.length === 2) {
    target = { kind: "profile", identifier: id }; allowed.add("game");
  } else if (["/", "/games", "/games/free", "/games/public", "/rules", "/about", "/updates", "/privacy", "/terms", "/get-mcp"].includes(url.pathname)
    || root === "games" && id === "type" && parts.length === 3 && ["influence", "werewolf"].includes(parts[2] ?? "")
    || root === "games" && id === "season" && parts.length === 3 && !!parts[2]
    || root === "updates" && parts.length === 2 && !!id) {
    target = { kind: "page" };
  } else throw invalid();
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw invalid();
  }
  if (target.mode === "replay") {
    parseReplayShare(url.searchParams);
    if (parseReplayAudience(url.searchParams.get("audience") ?? undefined) === "invalid"
      || parseReplayCursor(url.searchParams.get("cursor") ?? undefined) === "invalid"
      || url.searchParams.has("cursor") && !url.searchParams.has("audience")) throw invalid();
    for (const key of ["t", "speed", "volume", "cursor"]) {
      if (url.searchParams.has(key)) url.searchParams.set(key, String(Number(url.searchParams.get(key))));
    }
    if (sequence !== undefined) url.pathname = `/games/${id}/replay/${Number(sequence)}`;
  }
  if (target.mode === "highlights") {
    const audience = url.searchParams.get("audience"), scene = url.searchParams.get("scene");
    if (audience !== null && !["public", "mystery", "omniscient"].includes(audience)
      || scene !== null && (!scene || scene.length > 200 || !/^[a-zA-Z0-9:_-]+$/.test(scene))) throw invalid();
  }
  if (url.searchParams.has("game") && !["all", "influence", "werewolf"].includes(url.searchParams.get("game")!)) throw invalid();
  if (url.hash && (!target.mode || !/^(replay|results|highlights)$/.test(target.mode) || !/^#[a-zA-Z0-9_%:-]{1,200}$/.test(url.hash))) throw invalid();
  url.searchParams.sort();
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (path.length > 2048) throw invalid();
  return { ...target, path };
}
