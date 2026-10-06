import { createHash } from "node:crypto";
import type { HouseCutsResponse } from "../house-cuts/publication";
import { walkWerewolfHistory } from "../werewolf/watch";
import type { WerewolfEvent } from "../werewolf/types";
import type { HouseHighlightsTrailerAgent, HouseHighlightsTrailerCueSegment } from "./house-highlights-trailer-manifest";

export const WEREWOLF_TRAILER_POLICY = "werewolf-opening-quotes-v1";
export const WEREWOLF_TRAILER_MUSIC = {
  id: "werewolf-suno-trailer-v1",
  filename: "trailer-v1.wav",
  sha256: "bc6967a8e1ca3769e43ae5b1a5c4f4440e7f0f12ff1036d48cb1b5acd53c01b5",
  durationSeconds: 177.96,
} as const;
const TIMING = "werewolf-teaser-timing-v1";
export interface WerewolfTrailerQuote { id: string; sourceRef: string; speakerId: string; text: string }
export interface WerewolfTrailerManifest {
  schemaVersion: 2;
  kind: "werewolf";
  mediaType: "house_highlights_trailer";
  timingContractVersion: typeof TIMING;
  game: { id: string; slug: string; status: "completed" };
  frameRate: 30;
  width: 1920;
  height: 1080;
  cast: HouseHighlightsTrailerAgent[];
  story: {
    title: string;
    description: string;
    audience: "mystery";
    policyVersion: typeof WEREWOLF_TRAILER_POLICY;
    sourceHash: string;
    publicationVersion: string | null;
    editorialStatus: "ready" | "failed";
    musicAssetId: typeof WEREWOLF_TRAILER_MUSIC.id;
    musicSha256: typeof WEREWOLF_TRAILER_MUSIC.sha256;
    quotes: WerewolfTrailerQuote[];
  };
  cueSheet: {
    schemaVersion: 1;
    timingContractVersion: typeof TIMING;
    frameRate: 30;
    totalFrames: number;
    totalDurationSeconds: number;
    segments: Array<Omit<HouseHighlightsTrailerCueSegment, "kind"> & { kind: "cast_roster" | "quote" | "end_card" }>;
  };
}

/** Only canonical public opening evidence enters the snapshot; never serialize reducer state. */
export function buildWerewolfTrailerManifest(input: {
  events: readonly WerewolfEvent[];
  slug: string;
  cuts: HouseCutsResponse;
  episode?: { title: string; description: string };
}): WerewolfTrailerManifest {
  const eligible = new Map<string, { speakerId: string; text: string }>();
  let last;
  let ballotReached = false;
  for (const frame of walkWerewolfHistory(input.events, "mystery")) {
    last = frame.state;
    const e = frame.entry;
    if (!e) continue;
    if (e.kind === "vote" && e.day === 1) ballotReached = true;
    if (e.kind === "speech" && e.day === 0 && e.audience === "public" && e.text?.trim()) {
      eligible.set(`w:${frame.cursor}`, { speakerId: e.actorId, text: e.text });
    } else if (e.kind === "discussion" && e.day === 1 && !ballotReached && e.contribution.text?.trim()) {
      eligible.set(`w:${frame.cursor}`, { speakerId: e.contribution.actorId, text: e.contribution.text });
    }
  }
  if (!last?.outcome) throw new Error("Werewolf trailer requires a completed canonical game");
  if (input.cuts.game.id !== last.gameId || input.cuts.game.kind !== "werewolf" || input.cuts.audience !== "mystery") throw new Error("Trailer Cut game/audience mismatch");
  if (input.cuts.status !== "ready" && input.cuts.status !== "failed") throw new WerewolfTrailerWaitingError();
  if (input.cuts.status === "ready" && !input.cuts.publication) throw new Error("Ready House Cuts are missing publication");
  if (input.cuts.publication && input.cuts.publication.audience !== "mystery") throw new Error("Trailer publication audience mismatch");
  const cast: HouseHighlightsTrailerAgent[] = last.players.map(p => ({
    id: p.id, name: p.name, initials: p.name.split(/\s+/).slice(0, 2).map(s => s[0]).join(""),
    // Match-frozen normal identity art, never Werewolf form or scene localization art.
    avatarUrl: p.avatarUrl ?? "/avatars/personas/observer.png", placement: null, status: "unknown",
  }));
  const quotes: WerewolfTrailerQuote[] = [];
  const seen = new Set<string>();
  for (const cut of input.cuts.publication?.cuts ?? []) {
    if (!cut.sourceRefs.length || cut.sourceRefs.some(ref => !eligible.has(ref))) continue;
    for (const quote of cut.quotes) {
      // Publications identify quotes by display name; ambiguous attribution is not guessed.
      const matches = cut.sourceRefs.filter(ref => {
        const source = eligible.get(ref)!;
        return cast.find(p => p.id === source.speakerId)?.name === quote.name && source.text.includes(quote.text);
      });
      if (matches.length !== 1 || !quote.text.trim() || quote.text.length > 230 || quote.text.includes("\n")) continue;
      const ref = matches[0]!;
      if (seen.has(ref) || quotes.length >= 3) continue;
      seen.add(ref);
      quotes.push({ id: `quote:${ref}`, sourceRef: ref, speakerId: eligible.get(ref)!.speakerId, text: quote.text });
      break; // One moment per Cut; no quota filler.
    }
  }
  const sourceHash = createHash("sha256").update(JSON.stringify({ gameId: last.gameId, cast, evidence: [...eligible] })).digest("hex");
  const manifest: WerewolfTrailerManifest = {
    schemaVersion: 2, kind: "werewolf", mediaType: "house_highlights_trailer", timingContractVersion: TIMING,
    game: { id: last.gameId, slug: input.slug, status: "completed" }, frameRate: 30, width: 1920, height: 1080, cast,
    story: { title: input.episode?.title ?? input.slug, description: input.episode?.description ?? "A village of familiar faces. Wolves among them. Who will you trust?",
      audience: "mystery", policyVersion: WEREWOLF_TRAILER_POLICY, sourceHash,
      publicationVersion: input.cuts.publication?.version ?? null, editorialStatus: input.cuts.status,
      musicAssetId: WEREWOLF_TRAILER_MUSIC.id, musicSha256: WEREWOLF_TRAILER_MUSIC.sha256, quotes },
    cueSheet: werewolfTrailerCueSheet(quotes),
  };
  const validation = validateWerewolfTrailerManifest(manifest);
  if (!validation.ok) throw new Error(validation.errors.join("; "));
  return manifest;
}

export function werewolfTrailerCueSheet(quotes: readonly WerewolfTrailerQuote[]): WerewolfTrailerManifest["cueSheet"] {
  let cursor = 0;
  const segments: WerewolfTrailerManifest["cueSheet"]["segments"] = [];
  const add = (id: string, kind: typeof segments[number]["kind"], label: string, seconds: number) => {
    const startFrame = cursor; cursor += seconds * 30;
    segments.push({ id, kind, label, startFrame, endFrame: cursor, startSeconds: startFrame / 30, endSeconds: cursor / 30, durationSeconds: seconds });
  };
  add("cast_roster", "cast_roster", "The village", 5);
  for (const quote of quotes) {
    // Allow reading time for the actual quoted text; do not truncate dialogue to fit four seconds.
    add(quote.id, "quote", "At the table", Math.max(4, Math.min(10, Math.ceil(quote.text.split(/\s+/).length / 3) + 1)));
  }
  add("end_card", "end_card", "Who will you trust?", 4);
  return { schemaVersion: 1, timingContractVersion: TIMING, frameRate: 30, totalFrames: cursor, totalDurationSeconds: cursor / 30, segments };
}

/** Exact allowlist, including nested objects: rejected fields cannot leak into captions or metadata. */
export function validateWerewolfTrailerManifest(value: unknown): { ok: boolean; errors: string[] } {
  try {
    const m = object(value, ["schemaVersion","kind","mediaType","timingContractVersion","game","frameRate","width","height","cast","story","cueSheet"]);
    if (m.schemaVersion !== 2 || m.kind !== "werewolf" || m.mediaType !== "house_highlights_trailer" || m.timingContractVersion !== TIMING || m.frameRate !== 30 || m.width !== 1920 || m.height !== 1080) throw new Error("Invalid Werewolf render contract");
    const game = object(m.game, ["id","slug","status"]); text(game.id); text(game.slug);
    if (game.status !== "completed") throw new Error("Trailer game must be completed");
    if (!Array.isArray(m.cast) || m.cast.length < 6 || m.cast.length > 8) throw new Error("Invalid Werewolf cast size");
    const ids = new Set<string>();
    for (const value of m.cast) {
      const p = object(value, ["id","name","initials","avatarUrl","placement","status"]);
      const id = text(p.id); text(p.name); text(p.initials); const url = text(p.avatarUrl);
      if (!url.startsWith("/") && !/^https?:\/\//.test(url)) throw new Error("Unsupported portrait URL");
      if (ids.has(id) || p.placement !== null || p.status !== "unknown") throw new Error("Invalid or spoiler-bearing cast identity");
      ids.add(id);
    }
    const story = object(m.story,["title","description","audience","policyVersion","sourceHash","publicationVersion","editorialStatus","musicAssetId","musicSha256","quotes"]);
    // Copy comes from the saved pregame episode presentation, never postgame outcome prose.
    if (text(story.title).length > 90 || text(story.description).length > 280) throw new Error("Invalid teaser copy");
    if (story.audience !== "mystery" || story.policyVersion !== WEREWOLF_TRAILER_POLICY || story.musicAssetId !== WEREWOLF_TRAILER_MUSIC.id || story.musicSha256 !== WEREWOLF_TRAILER_MUSIC.sha256) throw new Error("Invalid trailer policy or music");
    if (!/^[a-f0-9]{64}$/.test(text(story.sourceHash))) throw new Error("Invalid source hash");
    if (story.publicationVersion !== null) text(story.publicationVersion);
    if (story.editorialStatus !== "ready" && story.editorialStatus !== "failed") throw new Error("Unsettled editorial input");
    if (story.editorialStatus === "ready" && story.publicationVersion === null) throw new Error("Missing publication version");
    if (!Array.isArray(story.quotes) || story.quotes.length > 3) throw new Error("Invalid teaser quotes");
    const refs = new Set<string>();
    const quotes = story.quotes.map(value => {
      const q = object(value,["id","sourceRef","speakerId","text"]);
      const ref = text(q.sourceRef), speakerId = text(q.speakerId), content = text(q.text);
      if (!/^w:[1-9]\d*$/.test(ref) || refs.has(ref) || q.id !== `quote:${ref}` || !ids.has(speakerId) || content.length > 230 || content.includes("\n")) throw new Error("Invalid quote identity or content");
      refs.add(ref); return { id: `quote:${ref}`, sourceRef: ref, speakerId, text: content };
    });
    if (story.publicationVersion === null && quotes.length) throw new Error("Unpublished quotes");
    // Equality against the deterministic cue builder also rejects unknown properties and inconsistent frames.
    const expected = werewolfTrailerCueSheet(quotes);
    if (stable(m.cueSheet) !== stable(expected)) throw new Error("Invalid Werewolf cue sheet");
    return { ok: true, errors: [] };
  } catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }; }
}
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object");
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v,k))) throw new Error("Unexpected or missing trailer fields");
  return v;
}
function text(value: unknown): string { if (typeof value !== "string" || !value.trim()) throw new Error("Expected nonempty string"); return value; }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

export class WerewolfTrailerWaitingError extends Error {
  constructor() { super("Trailer is waiting for House Cuts"); this.name = "WerewolfTrailerWaitingError"; }
}
