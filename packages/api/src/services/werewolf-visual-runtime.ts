import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { werewolfConversationScene, werewolfHuntScene, werewolfSceneSignature, type WerewolfSceneDescriptor } from "@influence/engine/werewolf/visual-scenes";
import type { WerewolfEvent } from "@influence/engine/werewolf";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
import { planWerewolfScene, werewolfVariantCast } from "./werewolf-scene-plan.js";
import { resolveCharacterVariants } from "./visual-character-variants.js";
import type { WerewolfState, WerewolfRequest } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { lockWerewolfOwner } from "./werewolf-games.js";
import { freezeWerewolfReferences, WEREWOLF_AUTO_PUBLISHER } from "./werewolf-production.js";
import { prepareVisualScene, readCurrentVisualScene } from "./visual-scene-store.js";
import { renderVisualSceneBestEffort } from "./visual-best-effort.js";
import { captureOriginalMediaVersion } from "./visual-media-repair.js";
import { recordVisualOperationEvent, visualFailureEvidence } from "./visual-diagnostics.js";
import type { VisualBoundaryGuard, VisualTransaction } from "./visual-execution-boundary.js";


/** Reuse the House renderer and its paid-attempt journal at a Werewolf-owned event boundary. */
export function createWerewolfVisualPreparation(db: DrizzleDB, gameId: string, ownerEpoch: string, signal: AbortSignal,
  render = renderVisualSceneBestEffort, resolveVariants = resolveCharacterVariants) {
  const prepared = new Set<string>();
  const boundary = (state: WerewolfState): VisualBoundaryGuard => {
    const check = async (tx: VisualTransaction) => {
      signal.throwIfAborted();
      await lockWerewolfOwner(tx, gameId, ownerEpoch);
      const [head] = await tx.select({ sequence: schema.werewolfEvents.sequence }).from(schema.werewolfEvents)
        .where(eq(schema.werewolfEvents.gameId, gameId)).orderBy(desc(schema.werewolfEvents.sequence)).limit(1);
      if (head?.sequence !== state.sequence) throw new Error("Werewolf visual boundary changed");
    };
    return tx => tx ? check(tx) : db.transaction(check);
  };
  const prepare = async (state: WerewolfState, descriptor: WerewolfSceneDescriptor) => {
    const { roomId, participantIds: ids } = descriptor;
    const key = werewolfSceneSignature(descriptor);
    if (prepared.has(key)) return;
    const guard = boundary(state);
    await guard();
    try {
      const previous = await readCurrentVisualScene(db, gameId, roomId);
      const unchanged = previous && previous.plan.direction?.purpose === `werewolf-${descriptor.purpose}`
        && previous.plan.cast.length === ids.length && previous.plan.cast.every(p => ids.includes(p.id));
      let scene = previous;
      if (!unchanged) {
        const participants = ids.map(id => ({ id, name: state.players.find(p => p.id === id)!.name }));
        const { cast } = await freezeWerewolfReferences(db, gameId, participants);
        const unresolved = await planWerewolfScene(db, gameId, descriptor, cast);
        const plan = await resolveVariants(db, gameId, unresolved, { signal, guard });
        scene = await prepareVisualScene(db, { gameId, boundarySequence: descriptor.boundarySequence, afterDialogueSequence: descriptor.boundarySequence, plan, assertBoundary: guard });
      }
      if (!scene) throw new Error("Werewolf scene preparation did not produce a plan");
      const accepted = await render(db, scene, guard);
      await guard();
      if (accepted) await db.transaction(async tx => {
        await guard(tx);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('visual-media'), hashtext(${gameId}))`);
        await captureOriginalMediaVersion(tx, accepted);
        const [published] = await tx.select({ id: schema.visualMediaPublications.id }).from(schema.visualMediaPublications).where(eq(schema.visualMediaPublications.sceneId, accepted.id));
        if (!published) await tx.insert(schema.visualMediaPublications).values({ id: randomUUID(), gameId, sceneId: accepted.id,
          versionId: `original:${accepted.id}`, revision: 1, audience: "public", operatorId: WEREWOLF_AUTO_PUBLISHER, createdAt: new Date().toISOString() });
      });
      prepared.add(key);
    } catch (error) {
      // Cancellation, stop and owner loss must never become a successful fallback.
      await guard();
      await recordVisualOperationEvent(db, gameId, `werewolf-visual:${state.sequence}:${roomId}:fallback`,
        { boundarySequence: state.sequence, kind: "presentation", outcome: "portraits", message: "Scene preparation failed. Continuing with frozen character art." }, visualFailureEvidence(error, "internal"));
      prepared.add(key);
    }
  };
  const prepareTurn = async (state: WerewolfState, request: WerewolfRequest) => {
    const descriptor = werewolfConversationScene(state, request.action);
    if (descriptor) await prepare(state, descriptor);
    // A lone wolf never holds a meeting, but still needs a reusable form even
    // when the eventual night has no target. No fake scene is recorded here.
    if (request.action === "attack" && state.aliveIds.filter(id => state.roles[id] === "werewolf").length === 1) {
      const key = `form:${request.actorId}`;
      if (prepared.has(key)) return;
      const guard = boundary(state);
      try {
        await guard();
        const player = state.players.find(player => player.id === request.actorId)!;
        const original = await freezeWerewolfReferences(db, gameId, [{ id: player.id, name: player.name }]);
        const cast = await werewolfVariantCast(db, gameId, [player.id], original.cast);
        await resolveVariants(db, gameId, planVisualScene({ roomId: "mingle-1", backgroundArtifactId: null, cast }), { signal, guard });
      } catch (error) {
        await guard();
        await recordVisualOperationEvent(db, gameId, `werewolf-form:${state.sequence}:fallback`,
          { boundarySequence: state.sequence, kind: "presentation", outcome: "portraits", message: "Wolf form preparation failed. Continuing with frozen character art." }, visualFailureEvidence(error, "internal"));
      }
      prepared.add(key);
    }
  };
  prepareTurn.night = async (before: WerewolfState, event: WerewolfEvent, committed: WerewolfState) => {
    const descriptor = werewolfHuntScene(before, event);
    if (descriptor) await prepare(committed, descriptor);
  };
  return prepareTurn;
}
