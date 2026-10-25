import {hasLiveAudioTrack} from "./audio-frontier.js";
import { loadPayloads } from "./payload-storage.js";
import { and, eq, inArray, or } from "drizzle-orm";
import { replayWerewolf, werewolfExecutionFinished } from "@influence/engine/werewolf";
import type { WerewolfAudience } from "@influence/engine/werewolf/observation";
import { projectWerewolfProductionProvenance, projectWerewolfProductionWatch } from "@influence/engine/werewolf/watch";
import { assembleProductionCatalog } from "@influence/engine/production-moments";
import { buildWerewolfProductionSources } from "@influence/engine/production-moments/werewolf-source";
import { schema, type DrizzleDB } from "../db/index.js";
import { isViewerGame } from "./game-visibility.js";
import { readWerewolfEvents, WerewolfGameError } from "./werewolf-games.js";
import { applyLocalWerewolfArt, bindWerewolfScene, materializeWerewolfWatch, publishedWerewolfScenes, readWerewolfCharacter } from "./werewolf-presentation.js";
import { localCharacterArt, readLocalCharacterArt } from "./local-character-art.js";
import { readyCutoutsByHash } from "./character-cutouts.js";
import { readPayload } from "./payload-storage.js";
import { werewolfReferenceMetadata } from "./werewolf-production.js";
import { readWerewolfProductionThinking } from "./werewolf-thinking.js";
import { readWerewolfVisualPause } from "./werewolf-visual-policy.js";
import { sha256StableJson } from "./stable-hash.js";
import type { VisualTransaction } from "./visual-execution-boundary.js";

export interface WerewolfProductionSnapshot {
  gameId: string;
  gameKind: "werewolf";
  audience: WerewolfAudience;
  thinking: boolean;
  throughEventSequence: number;
  throughCursor: number;
  publicationCutoff: string;
  availableCharacterAssets: string[];
  sourceHash: string;
}

export interface WerewolfProductionSourceOptions {
  audience: WerewolfAudience;
  thinking: boolean;
  snapshot?: WerewolfProductionSnapshot;
  refreshVisuals?: boolean;
}

export function decodeWerewolfProductionSnapshot(value: unknown): WerewolfProductionSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new WerewolfGameError("Invalid production source snapshot");
  const snapshot = value as Record<string, unknown>;
  const keys = ["gameId", "gameKind", "audience", "thinking", "throughEventSequence", "throughCursor", "publicationCutoff", "availableCharacterAssets", "sourceHash"];
  if (Object.keys(snapshot).some(key => !keys.includes(key)) || Object.keys(snapshot).length !== keys.length
    || typeof snapshot.gameId !== "string" || !snapshot.gameId || snapshot.gameId.length > 200 || snapshot.gameKind !== "werewolf" || (snapshot.audience !== "mystery" && snapshot.audience !== "omniscient") || typeof snapshot.thinking !== "boolean" || (snapshot.audience === "mystery" && snapshot.thinking)
    || typeof snapshot.throughEventSequence !== "number" || !Number.isSafeInteger(snapshot.throughEventSequence) || snapshot.throughEventSequence < 1 || typeof snapshot.throughCursor !== "number" || !Number.isSafeInteger(snapshot.throughCursor) || snapshot.throughCursor < 1
    || typeof snapshot.publicationCutoff !== "string" || !Number.isFinite(Date.parse(snapshot.publicationCutoff)) || new Date(snapshot.publicationCutoff).toISOString() !== snapshot.publicationCutoff
    || Date.parse(snapshot.publicationCutoff) > Date.now() || !Array.isArray(snapshot.availableCharacterAssets) || snapshot.availableCharacterAssets.length > 64 || snapshot.availableCharacterAssets.some(hash => typeof hash !== "string" || !hash || hash.length > 128) || new Set(snapshot.availableCharacterAssets).size !== snapshot.availableCharacterAssets.length
    || typeof snapshot.sourceHash !== "string" || !/^sha256:[a-f0-9]{64}$/.test(snapshot.sourceHash)) throw new WerewolfGameError("Invalid production source snapshot");
  return { gameId: snapshot.gameId, gameKind: snapshot.gameKind, audience: snapshot.audience, thinking: snapshot.thinking, throughEventSequence: snapshot.throughEventSequence, throughCursor: snapshot.throughCursor, publicationCutoff: snapshot.publicationCutoff, availableCharacterAssets: snapshot.availableCharacterAssets as string[], sourceHash: snapshot.sourceHash };
}

function validateOptions(options: WerewolfProductionSourceOptions) {
  if (!options || (options.audience !== "mystery" && options.audience !== "omniscient") || typeof options.thinking !== "boolean") throw new WerewolfGameError("Invalid production audience or thinking option");
  if (options.audience === "mystery" && options.thinking) throw new WerewolfGameError("Thinking is available only in Omniscient mode", 403);
  if ((options.refreshVisuals !== undefined && typeof options.refreshVisuals !== "boolean") || (options.refreshVisuals && !options.snapshot)) throw new WerewolfGameError("Refreshing published visuals requires a fixed source snapshot");
  if (options.snapshot !== undefined) {
    const snapshot = decodeWerewolfProductionSnapshot(options.snapshot);
    if (snapshot.audience !== options.audience || snapshot.thinking !== options.thinking) throw new WerewolfGameError("Production snapshot audience or thinking option changed");
  }
}

/** Complete metadata-only source under the caller's repeatable-read transaction.
 * Routes must authorize the producer separately; a snapshot is never authority.
 * Canonical history is reduced before source paging or editorial selection. */
export async function buildWerewolfProductionSourceSnapshot(tx: DrizzleDB | VisualTransaction, id: string, options: WerewolfProductionSourceOptions, acceptedLivePrefix = false) {
  validateOptions(options);
  // Validate the old pin before requesting newer published visuals. Narrative
  // source history remains exactly the old accepted boundary.
  if (options.refreshVisuals) await buildWerewolfProductionSourceSnapshot(tx, id, { ...options, refreshVisuals: false });
  const [game] = await tx.select().from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
  if (!game || !isViewerGame({ ...game, hiddenAt: null })) throw new WerewolfGameError("Game not found", 404);
  if (!game.startedAt) throw new WerewolfGameError("This game has not started. Open its casting lobby.");
  const pause = game.status === "suspended" ? await readWerewolfVisualPause(tx, game.id) : null;
  if (!acceptedLivePrefix && game.status !== "completed" && !pause && !(game.status === "suspended" && await hasLiveAudioTrack(tx,game.id))) throw new WerewolfGameError("Production preview requires a completed game or a validated visual pause");
  const allEvents = await readWerewolfEvents(tx, game.id);
  const accepted = replayWerewolf(allEvents);
  if (game.status === "completed" && !werewolfExecutionFinished(accepted)) throw new WerewolfGameError("Completed game has no retrospective completion proof");
  if (options.snapshot && options.snapshot.gameId !== game.id) throw new WerewolfGameError("Production snapshot belongs to another game");
  const throughEventSequence = options.snapshot?.throughEventSequence ?? accepted.sequence;
  if (!allEvents.some(event => event.sequence === throughEventSequence)) throw new WerewolfGameError("Production source prefix is unavailable");
  const events = allEvents.filter(event => event.sequence <= throughEventSequence);
  const publicationCutoff = options.refreshVisuals ? new Date().toISOString() : options.snapshot?.publicationCutoff ?? new Date().toISOString();
  const rows = (await publishedWerewolfScenes(tx, game.id, publicationCutoff, true)).filter(row => row.scene.boundarySequence <= throughEventSequence);
  rows.sort((a, b) => b.scene.boundarySequence - a.scene.boundarySequence || b.publication.revision - a.publication.revision || a.scene.id.localeCompare(b.scene.id) || a.publication.id.localeCompare(b.publication.id));
  const projection = projectWerewolfProductionWatch(events, options.audience, (staging, cursor, ids) => {
    const {wolfForms} = bindWerewolfScene(rows, game.id, options.audience, cursor, publicationCutoff, staging);
    return ids.some(id => Boolean(wolfForms[id]));
  });
  if (options.snapshot && options.snapshot.throughCursor !== projection.latestCursor) throw new WerewolfGameError("Production source cursor changed", 409);
  const references = await werewolfReferenceMetadata(tx, game.id, events.find(event => event.type === "werewolf.started")?.payload.players,
    { availableHashes: options.refreshVisuals ? undefined : options.snapshot?.availableCharacterAssets });
  const availableCharacterAssets = [...new Set(references.flatMap(ref => [ref.bodyHash, ref.portraitHash].filter((hash): hash is string => hash !== null)))].sort();
  const readyCutouts = await readyCutoutsByHash(tx, references.flatMap(ref => ref.bodyHash ? [ref.bodyHash] : []), publicationCutoff);
  const cutoutReferences = references.flatMap(ref => {
    const job = ref.bodyHash ? readyCutouts.get(ref.bodyHash) : undefined;
    return job?.image ? [{ playerId: ref.profile.id, sourceHash: job.sourceHash, image: job.image }] : [];
  });
  const provenance = projectWerewolfProductionProvenance(events, options.audience);
  const localArt = await localCharacterArt(game.id, projection.players.map(player => player.id), publicationCutoff, true);
  const thoughts = options.thinking ? (await readWerewolfProductionThinking(tx, game.id, options.audience, projection.latestCursor, { throughEventSequence, includeHidden: true })).entries : [];
  const catalog = assembleProductionCatalog({ gameId: game.id, gameKind: "werewolf", audience: options.audience,
    sources: buildWerewolfProductionSources({ gameId: game.id, audience: options.audience, moments: projection.moments, provenance, thoughts, opening: true }) });
  const artifactIds = [...new Set(rows.flatMap(({ version }) => [version.imageArtifactId, version.annotatedArtifactId, ...version.plan.cast.map(member => member.referenceArtifactId),
    ...(version.shots ? [...version.shots.groups, ...(version.shots.overview ? [version.shots.overview] : [])].flatMap(shot => [shot.imageArtifactId, shot.annotatedArtifactId]) : [])]))];
  const artifacts = artifactIds.length ? await tx.select({ id: schema.visualArtifacts.id, contentHash: schema.visualArtifacts.contentHash }).from(schema.visualArtifacts)
    .where(and(eq(schema.visualArtifacts.gameId, game.id), inArray(schema.visualArtifacts.id, artifactIds))) : [];
  artifacts.sort((a, b) => a.id.localeCompare(b.id));
  if (artifacts.length !== artifactIds.length) throw new WerewolfGameError("Published production imagery is unavailable", 409);
  const sourceHash = sha256StableJson({ gameId: game.id, audience: options.audience, thinking: options.thinking, throughEventSequence, publicationCutoff,
    events, thoughts, catalog, references, ...(cutoutReferences.length ? { cutoutReferences } : {}), ...(Object.keys(localArt).length ? { localArt } : {}), publications: rows.map(({ scene, publication, version }) => ({ scene: { id: scene.id, roomId: scene.roomId, boundarySequence: scene.boundarySequence }, publication, version })), artifacts });
  if (options.snapshot && !options.refreshVisuals && options.snapshot.sourceHash !== sourceHash) throw new WerewolfGameError("Production source snapshot changed; refresh the source", 409);
  const snapshot: WerewolfProductionSnapshot = { gameId: game.id, gameKind: "werewolf", audience: options.audience, thinking: options.thinking, throughEventSequence, throughCursor: projection.latestCursor, publicationCutoff, availableCharacterAssets, sourceHash };
  const window = applyLocalWerewolfArt(materializeWerewolfWatch(projection, { id: game.id, slug: game.slug, status: game.status, visualPaused: Boolean(pause) }, options.audience, publicationCutoff, rows, references, snapshot), localArt);
  const permittedMedia = new Set<string>();
  for (const moment of projection.moments) for (const assetId of bindWerewolfScene(rows, game.id, options.audience, moment.cursor, publicationCutoff, moment.staging).permitted) permittedMedia.add(assetId);
  const [episode] = await tx.select({ title: schema.gameEpisodePresentations.title, description: schema.gameEpisodePresentations.description }).from(schema.gameEpisodePresentations).where(eq(schema.gameEpisodePresentations.gameId, game.id));
  return { snapshot, status: game.status, title: episode?.title ?? "Werewolf", description: episode?.description ?? null, window, provenance, thoughts, catalog, permittedMedia, cutoutReferences, localArt };
}

/** Source pages carry no thought copy or scene imagery outside their window. */
export async function readWerewolfProductionSource(db: DrizzleDB, id: string, options: WerewolfProductionSourceOptions & { fromCursor?: number; limit?: number }) {
  const fromCursor = options.fromCursor ?? 1, limit = options.limit ?? 64;
  if (!Number.isSafeInteger(fromCursor) || fromCursor < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 64) throw new WerewolfGameError("Invalid production source window");
  return db.transaction(async tx => {
    const source = await buildWerewolfProductionSourceSnapshot(tx, id, options);
    if (fromCursor > source.snapshot.throughCursor + 1) throw new WerewolfGameError("Production source window is unavailable");
    const moments = source.window.moments.filter(moment => moment.cursor >= fromCursor && moment.cursor < fromCursor + limit);
    const throughCursor = moments.at(-1)?.cursor ?? Math.min(source.snapshot.throughCursor, fromCursor - 1);
    const inPage = (cursor: number) => cursor >= fromCursor && cursor <= throughCursor;
    const mediaKeys = new Set(moments.flatMap(moment => moment.mediaKey ? [moment.mediaKey] : []));
    const media = Object.fromEntries(Object.entries(source.window.media).filter(([key]) => mediaKeys.has(key)));
    return { snapshot: source.snapshot, status: source.status, title: source.title, description: source.description,
      window: { ...source.window, fromCursor, throughCursor, moments, media }, provenance: source.provenance.filter(row => inPage(row.cursor)), thoughts: source.thoughts.filter(thought => inPage(thought.cursor)),
      catalog: { ...source.catalog, moments: source.catalog.moments.filter(moment => moment.source.kind === "opening" ? fromCursor === 1 : inPage(moment.order.anchor)) },
      nextCursor: throughCursor < source.snapshot.throughCursor ? throughCursor + 1 : null };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Internal complete metadata catalog for annotation CAS and frozen selection. */
export async function readWerewolfProductionCatalog(tx: DrizzleDB | VisualTransaction, id: string, options: WerewolfProductionSourceOptions) {
  const source = await buildWerewolfProductionSourceSnapshot(tx, id, options);
  return { snapshot: source.snapshot, catalog: source.catalog };
}

/** Exact pinned published imagery. Producer authorization remains route-owned. */
export async function readWerewolfProductionMedia(db: DrizzleDB, id: string, assetId: string, options: { snapshot: WerewolfProductionSnapshot }) {
  return db.transaction(async tx => {
    const snapshot = options.snapshot;
    const source = await buildWerewolfProductionSourceSnapshot(tx, id, { audience: snapshot?.audience, thinking: snapshot?.thinking, snapshot });
    if (!source.permittedMedia.has(assetId)) throw new WerewolfGameError("Image is not available in this production source", 404);
    const [image] = await loadPayloads(tx.select({ bytes: schema.visualArtifacts.image }).from(schema.visualArtifacts).where(and(eq(schema.visualArtifacts.id, assetId), eq(schema.visualArtifacts.gameId, source.snapshot.gameId))));
    if (!image) throw new WerewolfGameError("Image not found", 404);
    return { bytes: new Uint8Array(image.bytes), contentType: "image/png" };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

/** Frozen character bytes use the same producer pin, including hidden games. */
export async function readWerewolfProductionCharacter(db: DrizzleDB, id: string, playerId: string, options: { snapshot: WerewolfProductionSnapshot; image?: "portrait" | "body" }) {
  return db.transaction(async tx => {
    const snapshot = options.snapshot;
    const source = await buildWerewolfProductionSourceSnapshot(tx, id, { audience: snapshot?.audience, thinking: snapshot?.thinking, snapshot });
    if (!source.window.players.some(player => player.id === playerId)) throw new WerewolfGameError("Character is not available in this production source", 404);
    const replacement = source.localArt[playerId];
    if (replacement) {
      const asset = await readLocalCharacterArt(source.snapshot.gameId, playerId, replacement.revision, options.image === "body" ? "cutout" : "portrait");
      if (!asset) throw new WerewolfGameError("Pinned local character art unavailable", 404);
      return { bytes: new Uint8Array(asset.bytes), contentType: asset.contentType };
    }
    const cutout = options.image === "body" ? source.cutoutReferences.find(ref => ref.playerId === playerId) : undefined;
    const bytes = cutout ? await readPayload(cutout.image) : await readWerewolfCharacter(tx, source.snapshot.gameId, playerId, options.image, source.snapshot.availableCharacterAssets);
    if (!bytes) throw new WerewolfGameError("Frozen character reference unavailable", 404);
    const contentType = bytes[0] === 0xff ? "image/jpeg" : bytes.toString("ascii", 0, 4) === "RIFF" ? "image/webp" : "image/png";
    return { bytes: new Uint8Array(bytes), contentType };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
