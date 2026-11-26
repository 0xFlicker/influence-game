import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import sharp from "sharp";
import { parseHouseShareTarget, SHARE_CODE_PATTERN } from "@influence/engine/house-share-target";
import { replayWerewolf } from "@influence/engine/werewolf";
import { getPermissionsForUser } from "../db/rbac.js";
import { schema, type DrizzleDB } from "../db/index.js";
import { houseGameIdentity, houseOwnedGameIds } from "../services/house-game-access.js";
import { readHouseGame, readHouseInspectionResults } from "../services/house-game-inspection.js";
import { isViewerGame, storedGameVisibility } from "../services/game-visibility.js";
import { resolveMatchAccessContext } from "../services/match-access-context.js";
import { loadPayloads } from "../services/payload-storage.js";
import { getPublicPlayerProfile, PUBLIC_PLAYER_NOT_FOUND } from "../services/public-player-profile.js";
import { findPublicPlayersByDisplayName, type PublicPlayerIdentityRef } from "../services/public-player-identity.js";
import { resolveShareLink } from "../services/house-share-links.js";
import { getPublicAgentProfile, readPublicAgentIdentity } from "../services/public-agent-profile.js";
import { readWerewolfEvents } from "../services/werewolf-games.js";
import { readWerewolfThinking } from "../services/werewolf-thinking.js";
import { PrivateTraceReadModel } from "../services/private-trace-read-model.js";
import { PRIVATE_TRACE_EVIDENCE_TYPE, PROVIDER_ATTEMPT_EVIDENCE_TYPE } from "../services/private-trace-writer.js";
import { imageHash, S3GameAssetStorage } from "../services/game-asset-storage.js";
import { readViewerMedia } from "../services/visual-media-viewer.js";
import { readWerewolfCharacter, readWerewolfPresentation } from "../services/werewolf-presentation.js";
import { readVisualProfileImage } from "../services/visual-game-assets.js";
import { getGameMcpRules } from "./rules.js";
import { discordUnavailable, referencePattern, signDiscordRef, verifyDiscordRef, type DiscordGrant } from "./discord-turn.js";

const string = { type: "string", minLength: 1, maxLength: 128 };
const game = { game: string };
const page = { cursor: { type: "string", maxLength: 2048 } };
const gameKind = { type: "string", enum: ["influence", "werewolf"] };
const range = { after: { type: "integer", minimum: 0, maximum: 2147483647 } };
const evidence = { evidence: { type: "string", enum: ["decision", "provider"] } };
function tool(name: string, description: string, properties: object = {}, required: string[] = []) {
  return { name, description, inputSchema: { type: "object", properties, required, additionalProperties: false }, annotations: { readOnlyHint: true } };
}

export const discordReadTools = [
  tool("get_rules", "Read House rules for Influence or Werewolf.", { gameKind }, ["gameKind"]),
  tool("list_games", "List games available in this conversation, most recent first. Use nextAfter to continue.", { gameKind, ...range }),
  tool("read_game", "Read canonical board and replay. Use the returned game ID for follow-ups; Werewolf audience is assigned by the House.", { ...game, ...page }, ["game"]),
  tool("read_results", "Read official settled results for an available completed game.", game, ["game"]),
  tool("read_speech", "Read accepted Influence dialogue, in pages. Werewolf speech is in read_game.", { ...game, ...range }, ["game"]),
  tool("read_thinking", "Read authorized saved gameplay thinking. For Werewolf use a replay position as after (omit it for the beginning).", { ...game, ...range }, ["game"]),
  tool("read_player", "Look up a public House profile by display name, handle, public ID, or first-party profile or share link. Pass the complete link if given. Returns the canonical profile link, record, and public roster.", {
    player: { ...string, maxLength: 2048 },
  }, ["player"]),
  tool("list_agents", "List private agents in an owner or staff DM. Staff can specify a House public user ID.", { player: string }),
  tool("read_agent", "Read a public agent by ID; includes private fields only where authorized in DMs.", { agent: string, revision: string }, ["agent"]),
  tool("read_frozen_roster", "Read frozen public character identity and art for a game.", game, ["game"]),
  tool("read_account", "Read a House account record by handle or public ID in a staff DM.", { player: string }, ["player"]),
  tool("list_scene_images", "Find published replay images at the assigned audience. For Werewolf, after is the optional replay cursor.", { ...game, ...range }, ["game"]),
  tool("list_game_images", "Find existing editorial images for a game.", game, ["game"]),
  tool("inspect_image", "View an authorized image using an imageRef from another House tool. Return that exact imageRef in the reply to attach it.", { imageRef: { type: "string", maxLength: 2048 } }, ["imageRef"]),
  tool("list_game_reasoning", "List stored private reasoning receipts for one game in an authorized staff DM.", { ...game, ...page, ...evidence }, ["game"]),
  tool("read_game_reasoning", "Read stored private reasoning for an exact receipt in an authorized staff DM.", { ...game, manifest: { ...string, maxLength: 160 }, ...range, ...evidence }, ["game", "manifest"]),
];

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function text(value: unknown, max = 3200) {
  return typeof value === "string" ? value.slice(0, max) : null;
}
function ref(value: unknown) {
  if (typeof value !== "string" || !referencePattern.test(value)) return discordUnavailable();
  return value;
}

export async function discordGame(db: DrizzleDB, grant: DiscordGrant, selector: string) {
  const [row] = await db.select().from(schema.games)
    .where(or(eq(schema.games.id, selector), eq(schema.games.slug, selector))).limit(1);
  if (!row || !isViewerGame(row)) return discordUnavailable();
  if (grant.lane === "room" && storedGameVisibility(row.config) !== "public") return discordUnavailable();
  if (grant.lane === "owner" && !(await houseOwnedGameIds(db, grant.userId, false)).has(row.id)) return discordUnavailable();
  if (row.gameKind === "influence") return { row, audience: "public" as const, events: [] };
  const events = await readWerewolfEvents(db, row.id);
  const completed = events.length > 0 && Boolean(replayWerewolf(events).outcome);
  const granted = grant.spoilerGame === row.id || grant.spoilerGame === row.slug;
  const audience = completed || (granted && grant.lane !== "owner") ? "omniscient" as const : "mystery" as const;
  return { row, audience, events, granted };
}

type Art =
  | { kind: "portrait"; agent: string; private: boolean }
  | { kind: "scene"; game: string; asset: string; cursor?: number }
  | { kind: "frozen"; game: string; actor: string }
  | { kind: "game"; game: string; asset: string; revision: number };
function imageRef(art: Art, grant: DiscordGrant, secret: string) {
  return signDiscordRef({ art, message: grant.messageId, connection: grant.connectionId, channel: grant.channelId }, secret, "art");
}

async function frozenRoster(db: DrizzleDB, match: Awaited<ReturnType<typeof discordGame>>) {
  if (!match.row.startedAt) return [];
  if (match.row.gameKind === "werewolf") {
    const start = match.events[0];
    if (start?.type !== "werewolf.started") return [];
    return start.payload.players.map(p => ({
      id: p.id, name: p.name, agentId: p.agentProfileId, revisionId: p.contentRevisionId,
      personaKey: p.personaKey ?? "", image: p.avatarUrl,
    }));
  }
  const rows = await db.select({ id: schema.gamePlayers.id, agentId: schema.gamePlayers.agentProfileId,
    revisionId: schema.gamePlayers.agentRevisionId, persona: schema.gamePlayers.persona }).from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, match.row.id));
  return rows.map(p => {
    const persona = record(JSON.parse(p.persona));
    return { id: p.id, name: text(persona.name, 128) ?? p.id, agentId: p.agentId, revisionId: p.revisionId,
      personaKey: text(persona.personaKey, 128) ?? "", image: text(persona.avatarUrl, 2048) };
  });
}

export async function discordImage(db: DrizzleDB, grant: DiscordGrant, secret: string, token: string) {
  const value = verifyDiscordRef(token, secret, "art") as { art: Art; message: string; connection: string; channel: string };
  if (value.message !== grant.messageId || value.connection !== grant.connectionId || value.channel !== grant.channelId) return discordUnavailable();
  const art = value.art;
  let bytes: Uint8Array;
  if (art.kind === "portrait") {
    const profile = await portrait(db, grant, art.agent, art.private);
    if (!profile?.avatarUrl) return discordUnavailable();
    bytes = await readVisualProfileImage(profile.avatarUrl, { name: profile.name, personaKey: "" }, { db, userId: profile.ownerId });
    const latest = await portrait(db, grant, art.agent, art.private);
    if (latest?.avatarUrl !== profile.avatarUrl || latest.ownerId !== profile.ownerId) return discordUnavailable();
  } else {
    const match = await discordGame(db, grant, art.game);
    if (art.kind === "frozen") {
      const actor = (await frozenRoster(db, match)).find(p => p.id === art.actor);
      if (!actor) return discordUnavailable();
      if (match.row.gameKind === "werewolf") {
        const image = await readWerewolfCharacter(db, art.game, art.actor);
        if (!image) return discordUnavailable();
        bytes = image;
      } else {
        if (!actor.image) return discordUnavailable();
        bytes = await readVisualProfileImage(actor.image, actor, { db });
      }
    } else if (art.kind === "scene") {
      if (!(await scenes(db, grant, match, art.cursor)).some(scene => scene.asset === art.asset)) return discordUnavailable();
      const [image] = await loadPayloads(db.select({ bytes: schema.visualArtifacts.image }).from(schema.visualArtifacts)
        .where(and(eq(schema.visualArtifacts.gameId, art.game), eq(schema.visualArtifacts.id, art.asset))));
      if (!image || !(await scenes(db, grant, match, art.cursor)).some(scene => scene.asset === art.asset)) return discordUnavailable();
      bytes = image.bytes;
    } else {
      if (match.audience === "mystery" || (match.row.gameKind === "werewolf" && grant.lane === "owner")) return discordUnavailable();
      const [asset] = await db.select().from(schema.gameAssets).where(and(eq(schema.gameAssets.id, art.asset),
        eq(schema.gameAssets.gameId, match.row.id), eq(schema.gameAssets.revision, art.revision), isNull(schema.gameAssets.deletedAt)));
      if (!asset) return discordUnavailable();
      bytes = await new S3GameAssetStorage().get(asset.objectKey);
      if (bytes.byteLength !== asset.byteLength || imageHash(bytes) !== asset.sha256) return discordUnavailable();
      const [current] = await db.select({ revision: schema.gameAssets.revision }).from(schema.gameAssets)
        .where(and(eq(schema.gameAssets.id, art.asset), isNull(schema.gameAssets.deletedAt)));
      if (current?.revision !== art.revision) return discordUnavailable();
    }
    await discordGame(db, grant, art.game);
  }
  const png = await sharp(bytes, { limitInputPixels: 32_000_000 }).resize(768, 768, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return { mimeType: "image/png", data: png.toString("base64") };
}

async function portrait(db: DrizzleDB, grant: DiscordGrant, id: string, privateArt: boolean) {
  if (!privateArt) return readPublicAgentIdentity(db, id);
  if (grant.lane === "room") return discordUnavailable();
  const a = schema.agentProfiles;
  const [profile] = await db.select({ avatarUrl: a.avatarUrl, name: a.name, ownerId: a.userId })
    .from(a).innerJoin(schema.users, eq(schema.users.id, a.userId))
    .where(and(eq(a.id, id), isNull(schema.users.deletedAt), grant.lane === "owner" ? eq(a.userId, grant.userId) : undefined));
  return profile;
}

async function scenes(db: DrizzleDB, grant: DiscordGrant, match: Awaited<ReturnType<typeof discordGame>>, cursor?: number) {
  if (!match.row.startedAt) return [];
  if (match.row.gameKind === "werewolf") {
    const audience = grant.lane === "owner" ? "mystery" : match.audience;
    if (audience === "public") return [];
    const { permitted } = await readWerewolfPresentation(db, match.row.id, audience, cursor);
    return [...permitted].map(asset => ({ asset, label: "Werewolf replay scene" }));
  }
  if (grant.lane === "owner") return [];
  const media = await readViewerMedia(db, match.row.id, undefined, { artifactUrl: id => id });
  return media.scenes.flatMap(scene => [{ label: scene.roomId, asset: scene.imageUrl },
    ...(scene.shots?.groups ?? []).map(shot => ({ label: scene.roomId, asset: shot.imageUrl }))]).reverse();
}

async function discordAgent(db: DrizzleDB, grant: DiscordGrant, secret: string, agentId: string, revisionId?: string) {
  const publicProfile = await getPublicAgentProfile(db, agentId);
  const publicArt = await readPublicAgentIdentity(db, agentId);
  const p = schema.agentProfiles;
  const [profile] = grant.lane === "room" ? [] : await db.select({
    id: p.id, name: p.name, backstory: p.backstory, personality: p.personality, strategyStyle: p.strategyStyle,
    werewolfStrategyStyle: p.werewolfStrategyStyle, visualDesign: p.visualDesign, gender: p.gender,
    performanceInstructions: p.performanceInstructions, modelPreference: p.modelPreference, avatarUrl: p.avatarUrl, revisionId: p.currentRevisionId,
  }).from(p).innerJoin(schema.users, eq(schema.users.id, p.userId)).where(and(eq(p.id, agentId), isNull(schema.users.deletedAt), grant.lane === "owner" ? eq(p.userId, grant.userId) : undefined));
  if (revisionId !== undefined && !profile) return discordUnavailable();
  const r = schema.agentRevisions;
  const [revision] = profile ? await loadPayloads(db.select({
    id: r.id, ordinal: r.ordinal, behavior: r.behaviorSnapshot, runtime: r.effectiveRuntimeSnapshot,
  }).from(r).where(and(eq(r.agentProfileId, agentId), eq(r.id, revisionId ?? profile.revisionId ?? "")))) : [];
  const c = schema.agentContentRevisions;
  const [historical] = profile && revisionId && !revision ? await loadPayloads(db.select({ id: c.id, snapshot: c.snapshot })
    .from(c).where(and(eq(c.id, revisionId), eq(c.agentProfileId, agentId)))) : [];
  if (revisionId && !revision && !historical) return discordUnavailable();
  if (!profile && publicProfile.status !== "found") return discordUnavailable();
  const { avatarUrl, ...safeProfile } = profile ?? {};
  const art = avatarUrl || publicArt?.avatarUrl ? imageRef({ kind: "portrait", agent: agentId, private: Boolean(avatarUrl) }, grant, secret) : null;
  const accepted = publicArt ? await db.select({ id: p.contentRevisionId, name: p.name })
    .from(p).where(eq(p.id, agentId)) : [];
  return {
    publicProfile: withoutArt(publicProfile),
    accepted: accepted[0],
    ...(art && { imageRef: art }),
    ...(profile && { profile: safeProfile, revision: withoutArt(revision ?? historical) }),
  };
}

const publicOrigin = "https://thehouse.game";
function profileUrl(identity: PublicPlayerIdentityRef) {
  return publicOrigin + "/profile/" + encodeURIComponent(identity.handle ?? identity.publicId);
}

async function readDiscordPlayer(db: DrizzleDB, grant: DiscordGrant, reference: string) {
  const value = reference.trim();
  let url: URL | undefined;
  try { url = value.startsWith("/") ? new URL(value, publicOrigin) : new URL(value); } catch { /* A name or identifier is also valid. */ }
  let identifier = value.startsWith("@") ? value.slice(1) : value;
  if (url) {
    if (url.origin !== publicOrigin || url.username || url.password) return PUBLIC_PLAYER_NOT_FOUND;
    let path = url.pathname + url.search + url.hash;
    if (url.pathname.startsWith("/s/")) {
      const code = url.pathname.slice(3);
      if (!SHARE_CODE_PATTERN.test(code)) return PUBLIC_PLAYER_NOT_FOUND;
      const resolved = await resolveShareLink(db, code);
      if (!resolved) return PUBLIC_PLAYER_NOT_FOUND;
      path = resolved.path;
    }
    try {
      const target = parseHouseShareTarget(path);
      if (target.kind !== "profile" || !target.identifier) return PUBLIC_PLAYER_NOT_FOUND;
      identifier = target.identifier;
    } catch {
      return PUBLIC_PLAYER_NOT_FOUND;
    }
  }

  let result = await getPublicPlayerProfile(db, identifier);
  if (!url && result.status === "not_found" && value.length <= 128) {
    const matches = await findPublicPlayersByDisplayName(db, value);
    if (matches.length > 1) {
      return { status: "ambiguous", candidates: matches.slice(0, 5).map(identity => ({ ...identity, profileUrl: profileUrl(identity) })) };
    }
    if (matches[0]) result = await getPublicPlayerProfile(db, matches[0].publicId);
  }
  if (result.status !== "found") return result;
  const { recentResults: _recent, ...profile } = result.profile;
  return {
    ...result,
    profile: withoutArt(grant.lane === "owner" ? profile : result.profile),
    profileUrl: profileUrl(result.profile.identity),
  };
}

export async function discordRead(db: DrizzleDB, grant: DiscordGrant, secret: string, name: string, input: Record<string, unknown>) {
  const after = typeof input.after === "number" ? input.after : 0;
  const cursor = typeof input.cursor === "string" ? input.cursor : undefined;
  const kind = input.gameKind === "werewolf" ? "werewolf" as const : "influence" as const;
  if (name === "get_rules") return getGameMcpRules(kind);
  if (name === "read_player") return readDiscordPlayer(db, grant, String(input.player));
  if (name === "read_account") {
    if (grant.lane !== "staff") return discordUnavailable();
    const u = schema.users, identifier = String(input.player);
    const [found] = await db.select({ id: u.id, publicId: u.publicId, name: u.displayName, handle: u.handle, joinedAt: u.createdAt })
      .from(u).where(and(isNull(u.deletedAt), or(sql`${u.publicId}::text = ${identifier}`, eq(u.handle, identifier)))).limit(1);
    if (!found) return discordUnavailable();
    const { id, ...account } = found;
    return { ...account, roles: (await getPermissionsForUser(db, id)).roles };
  }
  if (name === "list_games") {
    const allowed = grant.lane === "owner" ? await houseOwnedGameIds(db, grant.userId, false) : undefined;
    if (allowed?.size === 0) return { games: [], nextAfter: null };
    const g = schema.games;
    const rows = await db.select({ id: g.id, slug: g.slug, gameKind: g.gameKind, status: g.status,
      createdAt: g.createdAt, hiddenAt: g.hiddenAt, config: g.config }).from(g).where(and(
      input.gameKind ? eq(g.gameKind, kind) : undefined,
      isNull(g.hiddenAt), allowed ? inArray(g.id, [...allowed]) : undefined,
    )).orderBy(desc(g.createdAt), desc(g.id));
    const page = rows.filter(row => isViewerGame(row) && (grant.lane !== "room" || storedGameVisibility(row.config) === "public"))
      .slice(after, after + 21);
    return { games: page.slice(0, 20).map(houseGameIdentity), nextAfter: page.length > 20 ? after + 20 : null };
  }
  if (name === "list_agents") {
    if (grant.lane === "room" || (input.player !== undefined && grant.lane !== "staff")) return discordUnavailable();
    const p = schema.agentProfiles;
    return db.select({ id: p.id, name: p.name, revisionId: p.currentRevisionId })
      .from(p).innerJoin(schema.users, eq(schema.users.id, p.userId))
      .where(and(isNull(schema.users.deletedAt), input.player ? sql`${schema.users.publicId}::text = ${ref(input.player)}`
        : grant.lane === "owner" ? eq(p.userId, grant.userId) : undefined)).orderBy(desc(p.updatedAt)).limit(20);
  }
  if (name === "read_agent") return discordAgent(db, grant, secret, ref(input.agent), input.revision === undefined ? undefined : ref(input.revision));

  const match = await discordGame(db, grant, ref(input.game));
  const id = match.row.id;
  if (name === "read_results") return withoutArt(await readHouseInspectionResults(db, id));
  if (name === "read_game") {
    const read = await readHouseGame(db, { gameIdOrSlug: id, audience: grant.lane === "owner" && match.row.gameKind === "werewolf" ? "mystery" : match.audience, cursor, view: "replay", limit: 8 });
    const { trailer: _trailer, links: _links, ...safe } = read;
    if (safe.gameKind === "werewolf") {
      // Frames can contain frozen artwork URLs. Deliver all art through checked references.
      return { ...record(withoutArt(safe)), gameHref: '/games/' + match.row.slug };
    }
    // The spectator dialogue lane includes Mingle and whisper rows. Owner DMs
    // receive only the public dialogue supplied by read_speech.
    if (grant.lane === "owner") return { game: safe.game, gameKind: safe.gameKind, position: safe.position,
      nextCursor: safe.nextCursor, pollCursor: safe.pollCursor, snapshot: safe.snapshot };
    return safe;
  }
  if (name === "read_frozen_roster") return (await frozenRoster(db, match)).map(({ image, personaKey: _personaKey, ...p }) => ({
    ...p, ...((image || match.row.gameKind === "werewolf") && { imageRef: imageRef({ kind: "frozen", game: id, actor: p.id }, grant, secret) }),
  }));
  if (name === "list_scene_images") {
    const cursor = after || undefined;
    return (await scenes(db, grant, match, cursor)).slice(0, 10).map(({ asset, label }) => ({
      label, imageRef: imageRef({ kind: "scene", game: id, asset, cursor }, grant, secret),
    }));
  }
  if (name === "list_game_images") {
    if (match.audience === "mystery" || (match.row.gameKind === "werewolf" && grant.lane === "owner")) return [];
    const a = schema.gameAssets;
    const assets = await db.select({ id: a.id, revision: a.revision, label: a.label, altText: a.altText })
      .from(a).where(and(eq(a.gameId, id), isNull(a.deletedAt))).orderBy(desc(a.updatedAt)).limit(10);
    return assets.map(({ id: asset, revision, label, altText }) => ({
      label, altText, imageRef: imageRef({ kind: "game", game: id, asset, revision }, grant, secret),
    }));
  }
  if (name === "list_game_reasoning" || name === "read_game_reasoning") {
    if (grant.lane !== "staff" || match.audience === "mystery") return discordUnavailable();
    const traces = new PrivateTraceReadModel(db);
    const provider = input.evidence === "provider" || (input.evidence === undefined && match.row.gameKind === "werewolf");
    const evidenceType = provider ? PROVIDER_ATTEMPT_EVIDENCE_TYPE : PRIVATE_TRACE_EVIDENCE_TYPE;
    if (name === "list_game_reasoning") {
      const listed = await traces.listManifests(id, { limit: 10, cursor, cursorBinding: grant.userId, evidenceType });
      if (!listed.ok) return discordUnavailable();
      return { evidence: provider ? "provider" : "decision",
        manifests: listed.manifests.map(m => ({ id: m.id, action: m.action, actor: m.actor })), nextCursor: listed.nextCursor };
    }
    const manifestId = String(input.manifest);
    const options = { gameId: id, accessor: { roles: ["producer"], userId: grant.userId },
      purpose: "discord_staff_game_reasoning", maxBytes: 8 * 1024 * 1024 };
    const read = provider ? await traces.readProviderAttemptContent(manifestId, options) : await traces.readContent(manifestId, options);
    if (!read.ok || read.response.truncated || read.response.manifest.evidenceType !== evidenceType) return discordUnavailable();
    const object = record(JSON.parse(read.response.content));
    const reasoning = provider ? providerReasoning(record(record(object.attempt).rawResponse).body)
      : [text(object.reasoningContext, 100_000), text(object.providerReasoningSummary, 100_000)].filter(Boolean).join("\n");
    return { content: reasoning.slice(after, after + 8000), nextAfter: reasoning.length > after + 8000 ? after + 8000 : null };

  }
  if (name === "read_speech" && match.audience === "public") {
    const t = schema.transcripts;
    const scopes: Array<typeof t.scope._.data> = grant.lane === "owner" ? ["public"] : ["public", "mingle", "huddle", "whisper"];
    const rows = await db.select({ id: t.id, scope: t.scope, round: t.round, phase: t.phase, actor: t.fromPlayerId, speech: t.text })
      .from(t).where(and(eq(t.gameId, id), inArray(t.scope, scopes)))
      .orderBy(sql`${t.entrySequence} ASC NULLS FIRST`, asc(t.timestamp), asc(t.id)).limit(11).offset(after);
    return { entries: rows.slice(0, 10).map(r => ({ ...r, speech: text(r.speech) })), nextAfter: rows.length > 10 ? after + 10 : null };
  }
  if (name !== "read_thinking") return discordUnavailable();
  if (match.row.gameKind === "werewolf") {
    if (match.audience === "mystery" && !(grant.lane === "owner" && match.granted)) return discordUnavailable();
    const owned = grant.lane === "owner"
      ? new Set((await frozenRoster(db, match)).filter(p => p.agentId).map(p => [p.id, p.agentId!] as const))
      : null;
    const profiles = owned ? await db.select({ id: schema.agentProfiles.id }).from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.userId, grant.userId)) : [];
    const ownedProfiles = new Set(profiles.map(p => p.id));
    const all = await readWerewolfThinking(db, id, "omniscient", 0);
    const entries = all.entries.filter(entry => entry.cursor > after && (!owned
      || [...owned].some(([actor, profile]) => actor === entry.actorId && ownedProfiles.has(profile))));
    const page = entries.slice(0, 8);
    return { entries: page.map(r => ({ ...r, thinking: text(r.thinking) })), nextAfter: entries.length > page.length ? page.at(-1)?.cursor : null };
  }

  const access = grant.lane === "owner" ? await resolveMatchAccessContext(db, { subjectUserId: grant.userId, gameIdOrSlug: id }) : null;
  const owned = access?.status === "resolved" ? [...access.context.ownedPlayerIds] : [];
  if (grant.lane === "owner" && !owned.length) return discordUnavailable();
  const t = schema.transcripts;
  const a = schema.gameCognitiveArtifacts;
  const rows = await loadPayloads(db.select({ id: a.id, actor: a.actorPlayerId, action: a.action, round: a.round, value: a.payload })
    .from(a).where(and(eq(a.gameId, id), eq(a.artifactType, "thinking"), eq(a.redactionStatus, "active"), eq(a.visibilityStatus, "active"),
      or(isNull(a.expiresAt), gt(a.expiresAt, new Date().toISOString())), inArray(a.actorRole, ["player", "juror"]),
      grant.lane === "owner" ? inArray(a.actorPlayerId, owned) : undefined)).orderBy(desc(a.createdAt), desc(a.id)).limit(8).offset(after));
  const legacy = match.row.cognitiveArtifactCaptureVersion === 0
    ? await db.select({ id: t.id, actor: t.fromPlayerId, round: t.round, thinking: t.thinking }).from(t)
      .where(and(eq(t.gameId, id), inArray(t.scope, ["public", "mingle", "huddle", "whisper"]),
        sql`${t.thinking} is not null`, grant.lane === "owner" ? inArray(t.fromPlayerId, owned) : undefined))
      .orderBy(desc(t.id)).limit(8).offset(after) : [];
  return { entries: [...rows.map(({ value, ...r }) => ({ ...r, thinking: text(value.thinking) })), ...legacy.map(r => ({ ...r, thinking: text(r.thinking) }))],
    nextAfter: rows.length === 8 || legacy.length === 8 ? after + 8 : null };
}

function withoutArt(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutArt);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(url|href|media|artwork)/i.test(key))
    .map(([key, item]) => [key, withoutArt(item)]));
}

function providerReasoning(body: unknown) {
  const response = record(body);
  const selected: string[] = [];
  const add = (value: unknown) => { if (typeof value === "string" && value.trim()) selected.push(value); };
  if (Array.isArray(response.output)) {
    for (const item of response.output) if (item?.type === "reasoning") {
      for (const field of [item.summary, item.content]) if (Array.isArray(field)) {
        for (const part of field) if (part?.type === "summary_text" || part?.type === "reasoning_text") add(part.text);
      }
    }
  }
  if (Array.isArray(response.content)) {
    for (const item of response.content) if (item?.type === "thinking") add(item.thinking);
  }
  if (Array.isArray(response.choices)) {
    for (const choice of response.choices) {
      const message = record(record(choice).message);
      add(message.reasoning_content);
      add(message.reasoning);
    }
  }
  return selected.join("\n");
}
