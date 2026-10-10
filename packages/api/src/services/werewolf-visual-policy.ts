import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { replayWerewolf, werewolfActionPlans } from "@influence/engine/werewolf";
import { werewolfConversationScene, werewolfHuntScene, type WerewolfSceneDescriptor } from "@influence/engine/werewolf/visual-scenes";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import { lockWerewolfOwner, readWerewolfEvents } from "./werewolf-games.js";
import { recordVisualOperationEvent } from "./visual-diagnostics.js";
import { visualFailurePolicy } from "./visual-policy.js";
import { freezeWerewolfReferences } from "./werewolf-production.js";
import { werewolfVariantCast, WEREWOLF_FORM_REVISION } from "./werewolf-scene-plan.js";
import type { VisualTransaction } from "./visual-execution-boundary.js";
export type WerewolfVisualWork = {
  kind: "scene";
  descriptor: WerewolfSceneDescriptor;
} | {
  kind: "form";
  playerId: string;
};
export interface WerewolfVisualPause {
  kind: "werewolf";
  id: string;
  boundarySequence: number;
  reason: string;
  work: WerewolfVisualWork;
}
export class WerewolfVisualBlocked extends Error {
  constructor(readonly gameId: string, readonly ownerEpoch: string, readonly boundarySequence: number, readonly work: WerewolfVisualWork, message: string) { super(message); }
}
export function werewolfVisualPause(config: Record<string, unknown>): WerewolfVisualPause | null {
  const value = config.visualPause as WerewolfVisualPause | undefined;
  return value?.kind === "werewolf" ? value : null;
}
/** Only the current execution owner can suspend this exact accepted event head. */
export async function pauseWerewolfForVisuals(db: DrizzleDB, failure: WerewolfVisualBlocked, signal: AbortSignal) {
  return db.transaction(async (tx) => {
    await lockWerewolfOwner(tx, failure.gameId, failure.ownerEpoch);
    signal.throwIfAborted();
    const events = await readWerewolfEvents(tx, failure.gameId);
    if (events.at(-1)?.sequence !== failure.boundarySequence)
      throw new Error("Werewolf visual boundary changed");
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, failure.gameId));
    const config = JSON.parse(game!.config);
    if (visualFailurePolicy(config) !== "require_visuals")
      return false;
    signal.throwIfAborted();
    const pause: WerewolfVisualPause = { kind: "werewolf", id: randomUUID(), boundarySequence: failure.boundarySequence, reason: failure.message, work: failure.work };
    await tx.update(schema.games).set({ status: "suspended", endedAt: null, config: JSON.stringify({ ...config, visualPause: pause }) }).where(eq(schema.games.id, failure.gameId));
    await tx.update(schema.gameRunOwners).set({ status: "expired", closedAt: new Date().toISOString(), failureReason: "visual_preparation", kernelHealth: "suspended" }).where(and(eq(schema.gameRunOwners.gameId, failure.gameId), eq(schema.gameRunOwners.ownerEpoch, failure.ownerEpoch)));
    await recordVisualOperationEvent(tx, failure.gameId, `visual-pause:${pause.id}`, { kind: "paused", outcome: "paused", boundarySequence: pause.boundarySequence, message: pause.reason });
    return true;
  });
}
/** Reconstruct pending work from canonical scheduling, never trust a producer-supplied cast. */
export async function readWerewolfVisualPause(db: DrizzleDB | VisualTransaction, gameId: string) {
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  const pause = game && werewolfVisualPause(JSON.parse(game.config));
  if (!game || game.gameKind !== "werewolf" || game.status !== "suspended" || !pause)
    return null;
  const events = await readWerewolfEvents(db, gameId), state = replayWerewolf(events);
  if (state.sequence !== pause.boundarySequence)
    throw new Error("Paused visual boundary changed");
  const last = events.at(-1)!;
  const descriptors = werewolfActionPlans(state).flatMap(plan => { const scene = werewolfConversationScene(state, plan.request.action); return scene ? [scene] : []; });
  if (last.type === "werewolf.night_resolved") {
    const hunt = werewolfHuntScene(replayWerewolf(events.slice(0, -1)), last);
    if (hunt)
      descriptors.push(hunt);
  }
  if (pause.work.kind === "scene") {
    const descriptor = descriptors.find(d => JSON.stringify(d) === JSON.stringify(pause.work.kind === "scene" ? pause.work.descriptor : null));
    if (!descriptor)
      throw new Error("Paused scene is not at the canonical frontier");
  }
  else if (!werewolfActionPlans(state).some(p => p.request.action === "attack" && pause.work.kind === "form" && p.request.actorId === pause.work.playerId))
    throw new Error("Paused wolf form is not at the canonical frontier");
  return pause;
}
export async function readPublishedWerewolfRepair(db: DrizzleDB | VisualTransaction, gameId: string, descriptor: WerewolfSceneDescriptor) {
  const rows = await db.select({ version: schema.visualMediaVersions, publication: schema.visualMediaPublications }).from(schema.visualMediaPublications)
    .innerJoin(schema.visualMediaVersions, eq(schema.visualMediaVersions.id, schema.visualMediaPublications.versionId))
    .innerJoin(schema.visualScenes, eq(schema.visualScenes.id, schema.visualMediaPublications.sceneId))
    .where(and(eq(schema.visualMediaPublications.gameId, gameId), eq(schema.visualMediaPublications.audience, "public"), eq(schema.visualScenes.roomId, descriptor.roomId), sql`${schema.visualScenes.boundarySequence} <= ${descriptor.boundarySequence}`))
    .orderBy(desc(schema.visualMediaPublications.createdAt), desc(schema.visualMediaPublications.revision));
  const selected = rows.find(({ version }) => {
    const usable = version.shots
      ? [...(version.shots.overview ? [version.shots.overview] : []), ...version.shots.groups].some(shot => shot.visibleParticipantIds.length > 0)
      : (version.localization.verifiedParticipantIds?.length ?? 0) === descriptor.participantIds.length;
    return usable
      && version.plan.direction?.purpose === `werewolf-${descriptor.purpose}`
      && version.plan.cast.length === descriptor.participantIds.length
      && version.plan.cast.every(member => descriptor.participantIds.includes(member.id))
      && descriptor.wolfIds.every(id => version.plan.cast.some(member => member.id === id && member.variant?.resolved));
  });
  return selected ? { ...selected.version, publicationId: selected.publication.id } : null;
}
export async function resumeWerewolfVisualGame(db: DrizzleDB, gameId: string, operatorId: string) {
  await db.transaction(async (tx) => {
    const [game] = await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    const pause = await readWerewolfVisualPause(tx, gameId);
    if (!game || !pause)
      throw new Error("Game is not paused for visual repair");
    const config = JSON.parse(game.config);
    const repaired = pause.work.kind === "scene" ? await readPublishedWerewolfRepair(tx, gameId, pause.work.descriptor) : null;
    if (visualFailurePolicy(config) === "require_visuals") {
      if (pause.work.kind === "scene") {
        if (!repaired)
          throw new Error("Review and publish the required scene before resuming");
      }
      else {
        const [assets] = await tx.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, gameId));
        const source = assets?.cast.find(member => pause.work.kind === "form" && member.id === pause.work.playerId)?.referenceArtifactId;
        if (!source)
          throw new Error("Frozen wolf reference missing");
        const [form] = await tx.select().from(schema.visualCharacterVariants).where(and(eq(schema.visualCharacterVariants.gameId, gameId), eq(schema.visualCharacterVariants.playerId, pause.work.playerId), eq(schema.visualCharacterVariants.sourceArtifactId, source), eq(schema.visualCharacterVariants.revision, WEREWOLF_FORM_REVISION))).limit(1);
        if (!form)
          throw new Error("Repair the required wolf form before resuming");
      }
    }
    const [active] = await tx.select().from(schema.visualRepairJobs).where(and(eq(schema.visualRepairJobs.gameId, gameId), sql`${schema.visualRepairJobs.status} IN ('queued','rendering','verifying')`));
    if (active)
      throw new Error("Wait for the active repair before resuming");
    const { visualPause: _pause, ...next } = config;
    await tx.update(schema.games).set({ status: "in_progress", endedAt: null, config: JSON.stringify({ ...next, visualRecoveryPublications: [...new Set([...(config.visualRecoveryPublications ?? []), ...(repaired ? [repaired.publicationId] : [])])] }) }).where(eq(schema.games.id, gameId));
    await recordVisualOperationEvent(tx, gameId, `visual-resume:${pause.id}`, { kind: "resumed", outcome: "pending", boundarySequence: pause.boundarySequence, message: `${operatorId} requested resume from the committed visual boundary` });
  });
}
/** Form-only jobs use the existing leased media worker without inventing a meeting scene. */
export async function queueWerewolfFormRepair(db: DrizzleDB, gameId: string, operatorId: string, pauseId: string, requestId: string) {
  const pause = await readWerewolfVisualPause(db, gameId);
  if (!pause || pause.id !== pauseId || pause.work.kind !== "form")
    throw new Error("Wolf-form repair is no longer current");
  const state = replayWerewolf(await readWerewolfEvents(db, gameId));
  const player = state.players.find(p => pause.work.kind === "form" && p.id === pause.work.playerId)!;
  const { cast } = await freezeWerewolfReferences(db, gameId, [player]);
  const plan = planVisualScene({ roomId: "mingle-1", backgroundArtifactId: null, cast: await werewolfVariantCast(db, gameId, [player.id], cast, requestId) });
  return db.transaction(async (tx) => {
    await tx.select().from(schema.games).where(eq(schema.games.id, gameId)).for("update");
    const current = await readWerewolfVisualPause(tx, gameId);
    if (current?.id !== pause.id)
      throw new Error("Wolf-form repair is no longer current");
    const [prior] = await tx.select().from(schema.visualRepairJobs).where(eq(schema.visualRepairJobs.id, requestId));
    if (prior) {
      if (prior.gameId !== gameId || prior.reusePrefix !== pause.id || prior.operatorId !== operatorId)
        throw new Error("Request ID belongs to another repair");
      return { jobId: prior.id, status: prior.status };
    }
    const [active] = await tx.select().from(schema.visualRepairJobs).where(and(eq(schema.visualRepairJobs.gameId, gameId), sql`${schema.visualRepairJobs.status} IN ('queued','rendering','verifying')`));
    if (active)
      throw new Error("A repair is already running for this game");
    await tx.insert(schema.visualRepairJobs).values({ id: requestId, gameId, sceneId: null, reusePrefix: pause.id, version: 1, operatorId, mode: "forms", plan, renderContext: { style: "", roomName: "Wolf form", roomDirection: "" }, status: "queued", createdAt: new Date().toISOString() });
    return { jobId: requestId, status: "queued" };
  });
}
