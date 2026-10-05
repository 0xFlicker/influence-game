import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { VisualScenePlan } from "@influence/engine/visual-scene-plan";
import { schema, type DrizzleDB } from "../db/index.js";
import type { VisualBoundaryGuard } from "./visual-execution-boundary.js";
import { readVisualArtifact, storeVisualArtifact } from "./visual-scene-store.js";
import { renderDurableVisualImage, localizeDurableVisualScene } from "./visual-render-journal.js";
import { sha256StableJson } from "./stable-hash.js";

/** Shared renderer prerequisite; durable journal reservations prevent duplicate paid dispatches. */
export async function resolveCharacterVariants(db: DrizzleDB, gameId: string, plan: VisualScenePlan, options: {
  signal?: AbortSignal; guard?: VisualBoundaryGuard; sceneId?: string; jobId?: string; onStep?: (step: string) => Promise<void>;
} = {}, providers = { render: renderDurableVisualImage, localize: localizeDurableVisualScene }): Promise<VisualScenePlan> {
  if (!plan.cast.some(member => member.variant && !member.variant.resolved)) return plan;
  const cast = [];
  for (const member of plan.cast) {
    const variant = member.variant;
    if (!variant || variant.resolved) { cast.push(member); continue; }
    const identity = and(eq(schema.visualCharacterVariants.gameId, gameId), eq(schema.visualCharacterVariants.playerId, member.id),
      eq(schema.visualCharacterVariants.sourceArtifactId, variant.sourceArtifactId), eq(schema.visualCharacterVariants.revision, variant.revision), eq(schema.visualCharacterVariants.generation, variant.generation));
    let [saved] = await db.select().from(schema.visualCharacterVariants).where(identity);
    if (!saved) {
      const unresolved = await db.select({ id: schema.visualRenderAttempts.id }).from(schema.visualRenderAttempts)
        .innerJoin(schema.visualRenderOperations, eq(schema.visualRenderAttempts.operationId, schema.visualRenderOperations.id))
        .where(and(eq(schema.visualRenderOperations.gameId, gameId), sql`${schema.visualRenderOperations.operationKey} LIKE 'wolf-form:%'`,
          sql`${schema.visualRenderAttempts.reconciliation} IS NULL AND (${schema.visualRenderAttempts.receipt} IS NULL OR ${schema.visualRenderAttempts.receipt}->>'chargeUncertain' = 'true')`)).limit(1);
      if (unresolved.length) throw new Error("Reconcile the uncertain wolf-form provider attempt before generating another form");
      await options.guard?.();
      await options.onStep?.(`wolf form: ${member.name}`);
      const original = await readVisualArtifact(db, gameId, variant.sourceArtifactId);
      const key = `wolf-form:${sha256StableJson([member.id, variant.sourceArtifactId, variant.revision, variant.generation])}`;
      const common = { gameId, sceneId: options.sceneId, repairJobId: options.jobId, signal: options.signal, beforeDispatch: options.guard };
      const { image } = await providers.render(db, { ...common, operationKey: key, allowFallback: false, request: { width: 1024, height: 1536, references: [original],
        prompt: `Create a full-body werewolf form of this exact character, ${member.name}. Preserve recognizable clothing, colors, accessories, physique and silhouette while giving them a clearly lupine head, ears, fur and paws. Preserve the source rendering style: realistic sources remain realistic; anime, illustration and stylized 3D remain in that style. An existing nonhuman character retains its distinctive visual identity in a lupine interpretation. Exactly one character, neutral front or three-quarter standing pose, entire head, body and feet visible, plain warm grey background. No blood, injuries, text, labels or extra figures.` } });
      const localization = await providers.localize(db, { ...common, operationKey: `${key}:verify`, scene: image,
        apiKey: process.env.OPENAI_API_KEY ?? "", transformation: "werewolf",
        references: [{ image: original, players: [{ id: member.id, name: member.name }] }], onStep: options.onStep });
      if (localization.count !== 1 || localization.verifiedParticipantIds?.length !== 1 || localization.verifiedParticipantIds[0] !== member.id)
        throw new Error(`Wolf form for ${member.name} was not verified as the requested character`);
      const head = localization.anchors.find(anchor => anchor.playerId === member.id && anchor.confidence === "clear")?.head;
      if (!head) throw new Error(`Wolf form for ${member.name} has no verified head position`);
      const artifactId = await storeVisualArtifact(db, gameId, image);
      await db.transaction(async tx => {
        await options.guard?.(tx);
        await tx.insert(schema.visualCharacterVariants).values({ id: randomUUID(), gameId, playerId: member.id,
          sourceArtifactId: variant.sourceArtifactId, artifactId, revision: variant.revision, generation: variant.generation, head }).onConflictDoNothing();
      });
      [saved] = await db.select().from(schema.visualCharacterVariants).where(identity);
    }
    if (!saved) throw new Error(`Wolf form for ${member.name} was not saved`);
    cast.push({ ...member, referenceArtifactId: saved.artifactId, headRectangle: saved.head, variant: { ...variant, resolved: true } });
  }
  return { ...plan, cast };
}
