import { readVisualOperationEvents } from "./visual-diagnostics.js";
import { visualFailurePolicy } from "./visual-policy.js";
import { and, asc, eq, or } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readVisualRenderAccounting } from "./visual-render-journal.js";
import { previewFinalsRebuild } from "./visual-rebuild-preview.js";

/** Producer-only record: includes private diary cues, never used by the watch feed. */
export async function readVisualProductionExport(db: DrizzleDB, gameIdOrSlug: string) {
  const [game] = await db.select({ id: schema.games.id, config: schema.games.config, status: schema.games.status }).from(schema.games).where(or(eq(schema.games.id, gameIdOrSlug), eq(schema.games.slug, gameIdOrSlug)));
  if (!game) throw new Error("Game not found");
  const [assets, scenes, accounting, cues, events] = await Promise.all([
    db.select().from(schema.visualGameAssets).where(eq(schema.visualGameAssets.gameId, game.id)),
    db.select().from(schema.visualScenes).where(eq(schema.visualScenes.gameId, game.id)).orderBy(asc(schema.visualScenes.boundarySequence)),
    readVisualRenderAccounting(db, game.id),
    db.select({ sequence: schema.gameEvents.sequence, envelope: schema.gameEvents.envelope }).from(schema.gameEvents).where(and(eq(schema.gameEvents.gameId, game.id), eq(schema.gameEvents.eventType, "visual.cue_recorded"))).orderBy(asc(schema.gameEvents.sequence)),
    readVisualOperationEvents(db, game.id),
  ]);
  const config = JSON.parse(game.config) as Record<string, unknown>;
  const metrics = ["openai", "xai"].map((provider) => {
    const attempts = accounting.attempts.filter((attempt) => attempt.provider === provider);
    const elapsed = attempts.flatMap((attempt) => attempt.receipt ? [attempt.receipt.elapsedMs] : []).sort((a, b) => a - b);
    return { provider, attempts: attempts.length, failed: attempts.filter((attempt) => attempt.receipt?.failure).length, uncertain: attempts.filter((attempt) => !attempt.reconciliation && (!attempt.receipt || attempt.receipt.chargeUncertain)).length, knownCostMicrousd: attempts.reduce((sum, attempt) => sum + (attempt.costMicrousd ?? 0), 0), p50Ms: elapsed[Math.max(0, Math.ceil(elapsed.length * .5) - 1)] ?? null, p95Ms: elapsed[Math.max(0, Math.ceil(elapsed.length * .95) - 1)] ?? null };
  });
  let rebuildPreview: Awaited<ReturnType<typeof previewFinalsRebuild>> | null = null;
  let rebuildError: string | null = null;
  const currentFinals = scenes.findLast((scene) => scene.roomId === "finals");
  if (config.visualPause && currentFinals) {
    try { rebuildPreview = await previewFinalsRebuild(db, game.id, currentFinals.id); }
    catch (error) { rebuildError = error instanceof Error ? error.message : "Rebuild preview unavailable"; }
  }
  return { version: 1, gameId: game.id, gameStatus: game.status, policy: visualFailurePolicy(config), pause: config.visualPause ?? null, events, metrics,
    rebuildPreview, rebuildError, contextFailures: events.filter((row) => row.evidence?.context),
    enabled: JSON.parse(game.config).visualMode === true, assets: assets[0] ?? null, scenes, accounting, cues };
}
