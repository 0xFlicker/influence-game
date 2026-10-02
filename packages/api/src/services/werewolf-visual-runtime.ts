import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import { planVisualScene } from "@influence/engine/visual-scene-plan";
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
  render = renderVisualSceneBestEffort) {
  const prepared = new Set<string>();
  return async (state: WerewolfState, request: WerewolfRequest) => {
    if (!["pack_talk", "open_thread", "discuss"].includes(request.action)) return;
    const roomId = request.action === "pack_talk" ? "mingle-1" : "lobby";
    const ids = state.aliveIds.filter(id => roomId === "lobby" || state.roles[id] === "werewolf");
    const key = JSON.stringify([roomId, ids]);
    if (prepared.has(key)) return;
    const check = async (tx: VisualTransaction) => {
      signal.throwIfAborted();
      await lockWerewolfOwner(tx, gameId, ownerEpoch);
      const [head] = await tx.select({ sequence: schema.werewolfEvents.sequence }).from(schema.werewolfEvents)
        .where(eq(schema.werewolfEvents.gameId, gameId)).orderBy(desc(schema.werewolfEvents.sequence)).limit(1);
      if (head?.sequence !== state.sequence) throw new Error("Werewolf visual boundary changed");
    };
    const guard: VisualBoundaryGuard = tx => tx ? check(tx) : db.transaction(check);
    await guard();
    try {
      const previous = await readCurrentVisualScene(db, gameId, roomId);
      const unchanged = previous && previous.plan.cast.length === ids.length && previous.plan.cast.every(p => ids.includes(p.id));
      let scene = previous;
      if (!unchanged) {
        const participants = ids.map(id => ({ id, name: state.players.find(p => p.id === id)!.name }));
        const { cast } = await freezeWerewolfReferences(db, gameId, participants);
        const plan = planVisualScene({ roomId, backgroundArtifactId: null, cast, previous: previous?.plan });
        scene = await prepareVisualScene(db, { gameId, boundarySequence: state.sequence, afterDialogueSequence: state.sequence, plan, assertBoundary: guard });
      }
      if (!scene) throw new Error("Werewolf scene preparation did not produce a plan");
      const accepted = await render(db, scene, guard);
      await guard();
      if (accepted) await db.transaction(async tx => {
        await check(tx);
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
}
