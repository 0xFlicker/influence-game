import { eq } from "drizzle-orm";
import { createLlmProviderRuntimesFromEnv, resolveProviderManifestFromGameConfig } from "@influence/engine";
import { runWerewolf, WerewolfModelAgent, type WerewolfAgent } from "@influence/engine/werewolf";
import { schema, type DrizzleDB } from "../db/index.js";
import { createApiProviderExecutionHooks } from "./provider-call-journal.js";
import { renewGameRunOwner } from "./game-ownership.js";
import { createWerewolfStore, releaseWerewolfOwner } from "./werewolf-games.js";

const active = new Map<string, { controller: AbortController; promise: Promise<void> }>();
export const isWerewolfRunning = (gameId: string) => active.has(gameId);
export const activeWerewolfCount = () => active.size;
export function abortWerewolf(gameId: string) {
  const game = active.get(gameId);
  game?.controller.abort();
  return Boolean(game);
}
export async function abortAllWerewolf() {
  const games = [...active.values()];
  for (const game of games) game.controller.abort();
  await Promise.all(games.map((game) => game.promise));
}

export async function startWerewolfRuntime(db: DrizzleDB, gameId: string, ownerEpoch: string, agentOverride?: WerewolfAgent) {
  if (active.has(gameId)) throw new Error("Werewolf is already running");
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  if (!game || game.gameKind !== "werewolf" || game.status !== "in_progress") throw new Error("Werewolf is not running");
  const controller = new AbortController();
  const config = JSON.parse(game.config) as Record<string, unknown>;
  const mockAgent: WerewolfAgent = { async decide({ request, observation }) {
    if (request.action === "discuss" && observation.board.discussion?.beat === 1) return { kind: "speech", text: null, thinking: "Fixture opening pass" };
    return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture choice" }
      : { kind: "speech", text: "I will compare the claims with today's vote.", thinking: "Fixture speech" };
  } };
  const agent = agentOverride ?? (process.env.INFLUENCE_API_TEST_MOCK_RUNNER === "true" ? mockAgent : new WerewolfModelAgent({
    runtimes: createLlmProviderRuntimesFromEnv(resolveProviderManifestFromGameConfig(config), process.env, { openAIServiceTier: "flex", timeout: 120_000 }) ?? [],
    hooks: createApiProviderExecutionHooks(db, { gameId, ownerEpoch }), ownerEpoch,
  }));
  let heartbeatFailure = false;
  const heartbeat = setInterval(() => {
    void renewGameRunOwner(db, gameId, ownerEpoch).catch((error) => {
      console.error(`[werewolf] Lease renewal failed for ${gameId}`, error);
      heartbeatFailure = true;
      controller.abort();
    });
  }, 30_000);
  heartbeat.unref();
  const promise = runWerewolf(createWerewolfStore(db, gameId, ownerEpoch), agent, controller.signal)
    .then(() => {})
    .catch(async (error) => {
      if (!controller.signal.aborted) console.error(`[werewolf] Execution failed for ${gameId}`, error);
      try { await releaseWerewolfOwner(db, gameId, ownerEpoch, !controller.signal.aborted && !heartbeatFailure); }
      catch (releaseError) { console.error(`[werewolf] Owner release failed for ${gameId}; lease expiry will fence recovery`, releaseError); }
    })
    .finally(() => { clearInterval(heartbeat); active.delete(gameId); });
  active.set(gameId, { controller, promise });
}
