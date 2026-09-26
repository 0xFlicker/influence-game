import { VISUAL_HOUSE_STYLE, VISUAL_ROOMS } from "@influence/engine/visual-mode";
import { randomUUID } from "node:crypto";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { sha256StableJson } from "./stable-hash.js";
import { VISUAL_LOCALIZATION_VERSION } from "./visual-scene-localization.js";
import type { VisualTransaction } from "./visual-execution-boundary.js";
import { recordVisualOperationEvent } from "./visual-diagnostics.js";

const jobs = schema.visualRepairJobs, versions = schema.visualMediaVersions, publications = schema.visualMediaPublications;
export type MediaControl = { requestId: string; sceneId: string; expectedVersion: number; previewKey?: string; previewHash?: string } & (
  { action: "regenerate" } | { action: "verify"; sourceVersionId: string } | { action: "continue"; sourceJobId?: string } |
  { action: "publish"; versionId: string; expectedPublication: number }
);
class Rejected extends Error { constructor(readonly code: string, message: string) { super(message); } }
const reject = (code: string, message: string): never => { throw new Rejected(code, message); };
const active = (status: string) => ["queued", "rendering", "verifying"].includes(status);

/** A receipt survives retries and all authorized rejections, without touching game execution. */
export async function controlVisualMedia(db: DrizzleDB, gameId: string, operatorId: string, input: MediaControl, options: { oneAtATime?: boolean } = {}): Promise<typeof schema.visualMediaRequests.$inferSelect.receipt> {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('visual-media'), hashtext(${gameId}))`);
    const hash = sha256StableJson(input);
    const [prior] = await tx.select().from(schema.visualMediaRequests).where(and(eq(schema.visualMediaRequests.gameId, gameId), eq(schema.visualMediaRequests.operatorId, operatorId), eq(schema.visualMediaRequests.requestId, input.requestId)));
    if (prior) {
      if (prior.inputHash === hash) return prior.receipt;
      const receipt = { accepted: false, code: "request_conflict", message: "Request ID was already used with different inputs" };
      await recordVisualOperationEvent(tx, gameId, `media-request-conflict:${prior.id}:${hash}`, {
        kind: "failure", outcome: "failed", message: receipt.message,
      }, { kind: "internal", name: receipt.code, message: JSON.stringify({ operatorId, input, receipt }) });
      return receipt;
    }
    let receipt: typeof schema.visualMediaRequests.$inferInsert.receipt;
    try {
      const [scene] = await tx.select().from(schema.visualScenes).where(and(eq(schema.visualScenes.id, input.sceneId), eq(schema.visualScenes.gameId, gameId)));
      if (!scene) return reject("scene_missing", "Scene not found");
      await captureOriginalMediaVersion(tx, scene);
      const history = await tx.select().from(jobs).where(eq(jobs.sceneId, scene.id)).orderBy(desc(jobs.version));
      if ((history[0]?.version ?? 0) !== input.expectedVersion) return reject("stale_version", "Scene versions changed; refresh before trying again");
      if (input.action === "publish") {
        const [version] = await tx.select().from(versions).where(and(eq(versions.id, input.versionId), eq(versions.sceneId, scene.id)));
        if (!version) return reject("unverified", "Choose a verified version");
        const [last] = await tx.select().from(publications).where(eq(publications.sceneId, scene.id)).orderBy(desc(publications.revision)).limit(1);
        if ((last?.revision ?? 0) !== input.expectedPublication) return reject("publication_conflict", "Published version changed; refresh first");
        const id = randomUUID();
        await tx.insert(publications).values({ id, gameId, sceneId: scene.id, versionId: version.id, revision: input.expectedPublication + 1, operatorId, createdAt: new Date().toISOString() });
        receipt = { accepted: true, code: "published", message: "Published for new viewer sessions", publicationId: id };
      } else {
        if (options.oneAtATime) {
          const [pending] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.gameId, gameId), sql`${jobs.status} IN ('queued','rendering','verifying')`)).limit(1);
          if (pending) return reject("game_pending", "An image is already queued or rendering for this game. Wait for it to finish before rendering another.");
        }
        if (history.some(j => active(j.status))) return reject("already_pending", "A repair is already active for this scene");
        const uncertain = await tx.select({ id: schema.visualRenderAttempts.id }).from(schema.visualRenderAttempts)
          .innerJoin(schema.visualRenderOperations, eq(schema.visualRenderAttempts.operationId, schema.visualRenderOperations.id))
          .where(and(eq(schema.visualRenderOperations.sceneId, scene.id), sql`${schema.visualRenderAttempts.reconciliation} IS NULL AND (${schema.visualRenderAttempts.receipt} IS NULL OR ${schema.visualRenderAttempts.receipt}->>'chargeUncertain' = 'true')`));
        if (uncertain.length) return reject("needs_reconciliation", `Reconcile ${uncertain.length} uncertain paid attempt(s) before requesting another render`);
        let renderContext = { style: VISUAL_HOUSE_STYLE, roomName: VISUAL_ROOMS[scene.roomId].name, roomDirection: VISUAL_ROOMS[scene.roomId].direction };
        let plan = scene.plan, sourceImageId: string | null = null, reusePrefix: string | null = null;
        if (input.action === "verify") {
          const [source] = await tx.select().from(versions).where(and(eq(versions.id, input.sourceVersionId), eq(versions.sceneId, scene.id)));
          const failedCandidate = history.find(j => j.id === input.sourceVersionId && j.candidateArtifactId);
          if (!source && !failedCandidate) return reject("source_missing", "Image version not found");
          sourceImageId = source?.imageArtifactId ?? failedCandidate!.candidateArtifactId; plan = source?.plan ?? failedCandidate!.plan;
        }
        if (input.action === "continue") {
          const source = input.sourceJobId ? history.find(j => j.id === input.sourceJobId) : undefined;
          if (input.sourceJobId && (!source || !["failed", "needs_reconciliation"].includes(source.status))) return reject("source_not_failed", "Choose a failed repair");
          if (!source && scene.status !== "failed") return reject("source_not_failed", "Original scene has not failed");
          reusePrefix = source ? `media:${source.id}` : `${scene.id}:render:${scene.renderRevision}`;
          renderContext = source?.renderContext ?? renderContext;
          plan = source?.plan ?? scene.plan; sourceImageId = source?.sourceImageId ?? null;
        }
        const id = randomUUID(), version = input.expectedVersion + 1;
        await tx.insert(jobs).values({ id, gameId, sceneId: scene.id, version, operatorId, mode: input.action, plan, renderContext, sourceImageId, reusePrefix, status: "queued", createdAt: new Date().toISOString() });
        receipt = { accepted: true, code: "queued", message: `Version ${version} queued for rendering`, jobId: id, versionId: id, version };
      }
    } catch (error) {
      if (!(error instanceof Rejected)) throw error;
      receipt = { accepted: false, code: error.code, message: error.message };
    }
    await tx.insert(schema.visualMediaRequests).values({ id: randomUUID(), gameId, operatorId, requestId: input.requestId, inputHash: hash, input, receipt, createdAt: new Date().toISOString() });
    return receipt;
  });
}

/** Preserve the current accepted gameplay version without changing its source record. */
async function captureOriginalMediaVersion(tx: VisualTransaction, scene: typeof schema.visualScenes.$inferSelect) {
  if (scene.status !== "ready" || !scene.imageArtifactId || !scene.annotatedArtifactId) return;
  await tx.insert(versions).values(originalVersion(scene)).onConflictDoNothing();
}
function originalVersion(scene: typeof schema.visualScenes.$inferSelect) {
  return { id: `original:${scene.id}`, gameId: scene.gameId, sceneId: scene.id, jobId: null, version: 0, plan: scene.plan,
    imageArtifactId: scene.imageArtifactId!, annotatedArtifactId: scene.annotatedArtifactId!,
    localization: { count: scene.plan.cast.length, anchors: scene.anchors ?? [], verifiedParticipantIds: scene.plan.cast.map(m => m.id) },
    verificationVersion: "gameplay-record", createdAt: scene.createdAt };
}

export async function readVisualMedia(db: DrizzleDB, gameId: string) {
  const [jobRows, versionRows, publicationRows, requests, originals] = await Promise.all([
    db.select().from(jobs).where(eq(jobs.gameId, gameId)).orderBy(desc(jobs.version)),
    db.select().from(versions).where(eq(versions.gameId, gameId)).orderBy(desc(versions.version)),
    db.select().from(publications).where(eq(publications.gameId, gameId)).orderBy(desc(publications.revision)),
    db.select().from(schema.visualMediaRequests).where(eq(schema.visualMediaRequests.gameId, gameId)).orderBy(desc(schema.visualMediaRequests.createdAt)),
    db.select().from(schema.visualScenes).where(and(eq(schema.visualScenes.gameId, gameId), eq(schema.visualScenes.status, "ready"))),
  ]);
  return { jobs: jobRows, versions: [...versionRows, ...originals.filter(s => s.imageArtifactId && s.annotatedArtifactId && !versionRows.some(v => v.sceneId === s.id && v.version === 0)).map(originalVersion)], publications: publicationRows, requests };
}

export async function mediaAttempts(tx: DrizzleDB | VisualTransaction, prefix: string, gameId: string) {
  return tx.select({ attempt: schema.visualRenderAttempts, operation: schema.visualRenderOperations }).from(schema.visualRenderAttempts)
    .innerJoin(schema.visualRenderOperations, eq(schema.visualRenderAttempts.operationId, schema.visualRenderOperations.id))
    .where(and(eq(schema.visualRenderOperations.gameId, gameId), like(schema.visualRenderOperations.operationKey, `${prefix}:%`)));
}
export { VISUAL_LOCALIZATION_VERSION };
