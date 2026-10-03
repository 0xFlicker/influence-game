import { parseGameVisibility } from "@influence/engine/game-visibility";
import { enabledGameKinds } from "@influence/engine/game-availability";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { DEFAULT_MODEL_CATALOG_ID, getHousePersonaDetails, normalizeProviderManifest, pickAgentNames, HOUSE_PERSONA_KEYS, resolveModelSelection } from "@influence/engine";
import type { ProviderLogicalCallCoordinate } from "@influence/engine";
import { applyWerewolfEvent, resolveWerewolfStrategy, werewolfActionPlans, observeWerewolf, projectWerewolfView, replayWerewolf, startWerewolf, werewolfConfig, WEREWOLF_PRESETS } from "@influence/engine/werewolf";
import type { WerewolfAudience, WerewolfEvent, WerewolfPlayer, WerewolfPreset, WerewolfStore, WerewolfVoteProgress } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { checkGameStartAdmissionInTransaction, checkRecoveryAdmissionInTransaction } from "./deployment-admission.js";
import { hasEligibleAgentContent } from "./agent-content-eligibility.js";
import { decodeContentSnapshot } from "./agent-content-submissions.js";
import { generateUniqueSlug } from "../lib/slug.js";
import { sha256StableJson } from "./stable-hash.js";

type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
export class WerewolfGameError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409 | 503 = 409) { super(message); }
}

export async function readWerewolfEvents(db: Pick<DrizzleDB, "select">, gameId: string): Promise<WerewolfEvent[]> {
  const rows = await db.select().from(schema.werewolfEvents).where(eq(schema.werewolfEvents.gameId, gameId)).orderBy(asc(schema.werewolfEvents.sequence));
  for (const row of rows) {
    if (row.event.gameId !== row.gameId || row.event.sequence !== row.sequence) throw new Error("Corrupt Werewolf event envelope");
  }
  return rows.map((row) => row.event);
}

export function validateWerewolfModels(input?: unknown) {
  let providerManifest;
  try { providerManifest = normalizeProviderManifest(input ?? [{ catalogId: DEFAULT_MODEL_CATALOG_ID }]); }
  catch (error) { throw new WerewolfGameError(error instanceof Error ? error.message : "Invalid provider manifest", 400); }
  for (const selection of providerManifest) {
    if (resolveModelSelection(selection).model.evaluationStatus !== "game-ready") throw new WerewolfGameError("Model is not available", 400);
  }
  return providerManifest;
}

export function normalizeWerewolfCasting(input: { personaPool?: unknown; fillStrategy?: unknown }) {
  const all = HOUSE_PERSONA_KEYS;
  const pool = input.personaPool ?? all;
  if (!Array.isArray(pool) || pool.length < 2 || pool.some(key => !all.includes(key)) || new Set(pool).size !== pool.length) throw new WerewolfGameError("Choose at least two distinct archetypes", 400);
  const fillStrategy = input.fillStrategy ?? "balanced";
  if (fillStrategy !== "balanced" && fillStrategy !== "random") throw new WerewolfGameError("Choose balanced or random casting", 400);
  return { personaPool: pool as typeof all, fillStrategy };
}

export async function freezeWerewolfRoster(tx: Tx, seats: Array<{ id: string; agentProfileId: string }>, count: number, casting = normalizeWerewolfCasting({})): Promise<WerewolfPlayer[]> {
  if (seats.length > count) throw new WerewolfGameError("The village exceeds its seat limit.");
  const profiles = seats.length ? await tx.select().from(schema.agentProfiles)
    .where(inArray(schema.agentProfiles.id, seats.map(seat => seat.agentProfileId))).orderBy(asc(schema.agentProfiles.id)).for("update") : [];
  if (profiles.length !== seats.length) throw new WerewolfGameError("A cast member is no longer available. Remove them before starting.");
  const players: WerewolfPlayer[] = [];
    for (const seat of seats) {
      const profile = profiles.find((p) => p.id === seat.agentProfileId)!;
      if (!hasEligibleAgentContent(profile)) throw new WerewolfGameError("A selected character is archived or awaiting review", 409);
      const [revision] = profile.contentRevisionId ? await tx.select().from(schema.agentContentRevisions).where(eq(schema.agentContentRevisions.id, profile.contentRevisionId)) : [];
      if (profile.contentRevisionId && !revision) throw new Error("Missing approved character revision");
      const character = revision ? decodeContentSnapshot(revision.snapshot, profile) : profile;
      players.push({ id: seat.id, agentProfileId: profile.id, contentRevisionId: profile.contentRevisionId,
        name: character.name, personality: character.personality, backstory: character.backstory ?? "",
        strategy: resolveWerewolfStrategy(character.werewolfStrategyStyle, character.personaKey), avatarUrl: character.avatarUrl, personaKey: character.personaKey });
    }
    if (new Set(players.map(player => player.name.trim().toLowerCase())).size !== players.length) throw new WerewolfGameError("Two cast members now share a name. Rename or remove one before starting.");
    const fill = count - players.length;
    const names = pickAgentNames(fill, players.map((p) => p.name));
    const archetypes: typeof casting.personaPool = [];
    let remaining = casting.personaPool.filter(key => !players.some(player => player.personaKey === key));
    for (let i = 0; i < fill; i++) {
      if (!remaining.length) remaining = [...casting.personaPool];
      const pool = casting.fillStrategy === "random" ? casting.personaPool : remaining;
      const selected = pool[Math.floor(Math.random() * pool.length)]!;
      archetypes.push(selected); remaining = remaining.filter(key => key !== selected);
    }
    for (let i = 0; i < fill; i++) {
      const identity = getHousePersonaDetails(archetypes[i]!);
      players.push({ id: randomUUID(), name: names[i]!, personality: identity.personalityBlurb, backstory: "", strategy: resolveWerewolfStrategy(null, archetypes[i]!), avatarUrl: null, personaKey: archetypes[i]! });
    }
  return players;
}

/** Starting is one transaction: freeze character + selected game strategy, roles, and model policy. */
export async function createWerewolfGame(db: DrizzleDB, userId: string, input: {
  visibility?: unknown; preset: WerewolfPreset; agentProfileIds: string[]; providerManifest?: unknown; maxDays?: number;
}) {
  let visibility;
  try { visibility = parseGameVisibility(input.visibility); } catch { throw new WerewolfGameError("Game visibility must be public or unlisted", 400); }
  if (!enabledGameKinds().includes("werewolf")) throw new WerewolfGameError("Werewolf creation is unavailable.", 403);
  if (!Object.hasOwn(WEREWOLF_PRESETS, input.preset)) throw new WerewolfGameError("Choose one_wolf or two_wolves", 400);
  const count = WEREWOLF_PRESETS[input.preset].players;
  if (!Array.isArray(input.agentProfileIds) || input.agentProfileIds.some((id) => typeof id !== "string")
    || new Set(input.agentProfileIds).size !== input.agentProfileIds.length || input.agentProfileIds.length > count) {
    throw new WerewolfGameError("Choose distinct owned characters within the seat limit", 400);
  }
  const providerManifest = validateWerewolfModels(input.providerManifest);
  const gameId = randomUUID();
  const slug = await generateUniqueSlug(async (candidate) => (await db.select({ id: schema.games.id }).from(schema.games).where(eq(schema.games.slug, candidate))).length > 0);
  await db.transaction(async (tx) => {
    const admission = await checkGameStartAdmissionInTransaction(tx);
    if (!admission.ok) throw new WerewolfGameError(admission.error, 503);
    const profiles = input.agentProfileIds.length ? await tx.select().from(schema.agentProfiles)
      .where(and(inArray(schema.agentProfiles.id, input.agentProfileIds), eq(schema.agentProfiles.userId, userId))).orderBy(asc(schema.agentProfiles.id)).for("update") : [];
    if (profiles.length !== input.agentProfileIds.length) throw new WerewolfGameError("A selected character is unavailable", 403);
    const players = await freezeWerewolfRoster(tx, input.agentProfileIds.map(agentProfileId => ({ id: randomUUID(), agentProfileId })), count);
    const rules = werewolfConfig(input.preset, input.maxDays ?? 10);
    const initial = startWerewolf(gameId, players, rules, randomUUID());
    await tx.insert(schema.games).values({ id: gameId, slug, gameKind: "werewolf", gameKernel: null,
      createdById: userId, status: "in_progress", trackType: "custom", minPlayers: count, maxPlayers: count,
      startedAt: new Date().toISOString(), config: JSON.stringify({ providerManifest, serviceTier: "flex", visibility, rulesVersion: rules.rulesVersion, preset: input.preset }) });
    await tx.insert(schema.werewolfEvents).values({ gameId, sequence: initial.sequence, event: initial });
  });
  return { id: gameId, slug };
}

export async function claimWerewolfGame(db: DrizzleDB, gameId: string, processId?: string) {
  return db.transaction(async (tx) => {
    const admission = await checkRecoveryAdmissionInTransaction(tx);
    if (!admission.ok) return { ok: false as const, error: admission.error };
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    if (!game || game.gameKind !== "werewolf" || game.status !== "in_progress") return { ok: false as const, error: "Game is not running" };
    const [owner] = await tx.select().from(schema.gameRunOwners).where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.status, "active"))).for("update");
    const now = new Date();
    if (owner && (!owner.expiresAt || new Date(owner.expiresAt) > now)) return { ok: false as const, error: "A worker already owns this game" };
    let state;
    try {
      state = replayWerewolf(await readWerewolfEvents(tx, gameId));
      if (state.outcome) throw new Error("Completed Werewolf has an active catalog status");
    } catch (error) {
      await tx.update(schema.games).set({ status: "suspended" }).where(eq(schema.games.id, gameId));
      if (owner) await tx.update(schema.gameRunOwners).set({ status: "revoked", revokedAt: now.toISOString(), failureReason: "werewolf_log_invalid" }).where(eq(schema.gameRunOwners.id, owner.id));
      console.error(`[werewolf] Cannot recover ${gameId}`, error);
      return { ok: false as const, error: "Werewolf event history needs repair" };
    }
    if (owner) await tx.update(schema.gameRunOwners).set({ status: "expired", closedAt: now.toISOString() }).where(eq(schema.gameRunOwners.id, owner.id));
    const ownerEpoch = randomUUID();
    await tx.insert(schema.gameRunOwners).values({ id: randomUUID(), gameId, ownerEpoch, processId: processId ?? String(process.pid),
      expiresAt: new Date(now.getTime() + 600_000).toISOString(), lastPersistedEventSequence: state.sequence });
    return { ok: true as const, claim: { ownerEpoch, executionState: null } };
  });
}

export async function lockWerewolfOwner(tx: Tx, gameId: string, ownerEpoch: string) {
  const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
  const [owner] = await tx.select().from(schema.gameRunOwners).where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.ownerEpoch, ownerEpoch))).for("update");
  if (!game || game.gameKind !== "werewolf" || game.status !== "in_progress" || !owner || owner.status !== "active"
    || !owner.expiresAt || new Date(owner.expiresAt).getTime() <= Date.now()) throw new Error("Werewolf owner is stale");
  return owner;
}

export function createWerewolfStore(db: DrizzleDB, gameId: string, ownerEpoch: string): WerewolfStore {
  return {
    read: () => readWerewolfEvents(db, gameId),
    prepare: (state, request, sequence = state.sequence + 1) => db.transaction(async (tx) => {
      await lockWerewolfOwner(tx, gameId, ownerEpoch);
      const committed = replayWerewolf(await readWerewolfEvents(tx, gameId));
      const plan = werewolfActionPlans(committed).find((entry) => entry.sequence === sequence);
      if (state.sequence !== committed.sequence || !plan || sha256StableJson(plan.request) !== sha256StableJson(request)) throw new Error("Werewolf action frontier changed");
      const observationHash = sha256StableJson(observeWerewolf(committed, request.actorId));
      const [prior] = await tx.select().from(schema.werewolfTurns).where(and(eq(schema.werewolfTurns.gameId, gameId), eq(schema.werewolfTurns.sequence, sequence)));
      if (prior) {
        if (prior.observationHash !== observationHash || sha256StableJson(prior.request) !== sha256StableJson(request)) throw new Error("Werewolf planned observation changed");
      } else await tx.insert(schema.werewolfTurns).values({ gameId, sequence, request, observationHash });
    }),
    append: (event) => db.transaction(async (tx) => {
      const owner = await lockWerewolfOwner(tx, gameId, ownerEpoch);
      const state = replayWerewolf(await readWerewolfEvents(tx, gameId));
      const next = applyWerewolfEvent(state, event);
      if (event.type === "werewolf.action_accepted") {
        const [turn] = await tx.select().from(schema.werewolfTurns).where(and(eq(schema.werewolfTurns.gameId, gameId), eq(schema.werewolfTurns.sequence, event.sequence)));
        const { decision: _decision, fallback: _fallback, ...request } = event.payload;
        if (!turn || sha256StableJson(turn.request) !== sha256StableJson(request)
          || turn.observationHash !== sha256StableJson(observeWerewolf(state, event.payload.actorId))) throw new Error("Werewolf action was not planned");
      }
      await tx.insert(schema.werewolfEvents).values({ gameId, sequence: event.sequence, event });
      await tx.update(schema.gameRunOwners).set({ lastPersistedEventSequence: event.sequence,
        ...(next.outcome ? { status: "closed" as const, closedAt: new Date().toISOString() } : {}) }).where(eq(schema.gameRunOwners.id, owner.id));
      if (next.outcome) await tx.update(schema.games).set({ status: "completed", endedAt: new Date().toISOString() }).where(eq(schema.games.id, gameId));
    }),
  };
}

/** Called within the shared provider journal's owner-fenced transaction. */
export async function assertWerewolfProviderTurn(tx: Tx, gameId: string, coordinate: ProviderLogicalCallCoordinate) {
  if (coordinate.semantic.kind !== "werewolf_action") return;
  const sequence = coordinate.semantic.eventSequence;
  const [game] = await tx.select({ gameKind: schema.games.gameKind, status: schema.games.status }).from(schema.games).where(eq(schema.games.id, gameId));
  if (game?.gameKind !== "werewolf" || game.status !== "in_progress") throw new Error("Werewolf is not running");
  const [turn] = await tx.select().from(schema.werewolfTurns).where(and(eq(schema.werewolfTurns.gameId, gameId), eq(schema.werewolfTurns.sequence, sequence)));
  const state = replayWerewolf(await readWerewolfEvents(tx, gameId));
  const plan = werewolfActionPlans(state).find((entry) => entry.sequence === sequence);
  if (!turn || !plan
    || sha256StableJson(plan.request) !== sha256StableJson(turn.request)
    || turn.request.actorId !== coordinate.actor.id || coordinate.actor.role !== "player"
    || coordinate.actor.name !== state.players.find((player) => player.id === turn.request.actorId)?.name
    || coordinate.round !== state.day || coordinate.phase !== undefined || coordinate.action !== `werewolf.${turn.request.action}`
    || turn.observationHash !== sha256StableJson(observeWerewolf(state, turn.request.actorId))) throw new Error("Werewolf provider action does not match its frozen plan");
}

export async function releaseWerewolfOwner(db: DrizzleDB, gameId: string, ownerEpoch: string, failed = false) {
  await db.transaction(async (tx) => {
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    const owners = await tx.update(schema.gameRunOwners).set({ status: "expired", closedAt: new Date().toISOString(), failureReason: failed ? "werewolf_execution_failed" : "process_shutdown" })
      .where(and(eq(schema.gameRunOwners.gameId, gameId), eq(schema.gameRunOwners.ownerEpoch, ownerEpoch), eq(schema.gameRunOwners.status, "active"))).returning();
    if (failed && owners.length && game?.status === "in_progress") await tx.update(schema.games).set({ status: "suspended" }).where(eq(schema.games.id, gameId));
  });
}

/** Counts only durable accepted decisions, without loading choices or private reasoning.
 * Keep this beside the spectator view, never inside a contestant observation or replay. */
export async function readWerewolfLiveView(db: DrizzleDB, gameId: string, audience: WerewolfAudience, running: boolean) {
  const state = replayWerewolf(await readWerewolfEvents(db, gameId));
  const view = projectWerewolfView(state, audience);
  let voteProgress: WerewolfVoteProgress | null = null;
  if (running && state.phase === "vote" && !state.resolved && state.discussion) {
    const pending = new Set(werewolfActionPlans(state).map(plan => plan.sequence));
    const accepted = await db.select({ semantic: schema.providerLogicalCalls.semanticCoordinate })
      .from(schema.providerLogicalCalls).where(and(eq(schema.providerLogicalCalls.gameId, gameId),
        eq(schema.providerLogicalCalls.action, "werewolf.vote"), eq(schema.providerLogicalCalls.round, state.day),
        isNotNull(schema.providerLogicalCalls.acceptedAttemptId)));
    const ready = new Set(accepted.flatMap(({ semantic }) => semantic && typeof semantic === "object"
      && "kind" in semantic && semantic.kind === "werewolf_action" && "eventSequence" in semantic
      && typeof semantic.eventSequence === "number" && pending.has(semantic.eventSequence) ? [semantic.eventSequence] : []));
    const total = state.aliveIds.length;
    voteProgress = { kind: "day_vote", day: state.day, thread: state.discussion.threadIndex,
      total, ready: state.actions.filter(action => action.action === "vote").length + ready.size,
      voteMode: state.discussion.ended ? "plurality" : "majority",
      requiredVotes: state.discussion.ended ? null : Math.floor(total / 2) + 1 };
  }
  return { view, voteProgress };
}

/** Replay positions are public-entry counts, never private event sequences. */
export async function readWerewolfView(db: DrizzleDB, gameId: string, audience: WerewolfAudience, cursor?: number) {
  const events = await readWerewolfEvents(db, gameId);
  if (!events.length) throw new WerewolfGameError("Werewolf game not found", 404);
  if (cursor === undefined) return projectWerewolfView(replayWerewolf(events), audience);
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new WerewolfGameError("Invalid replay position", 400);
  let state = replayWerewolf([events[0]!]);
  let view = projectWerewolfView(state, audience);
  if (cursor < view.cursor) return view;
  for (const event of events.slice(1)) {
    state = applyWerewolfEvent(state, event);
    const next = projectWerewolfView(state, audience);
    if (next.cursor > cursor) return view;
    view = next;
  }
  return view;
}
