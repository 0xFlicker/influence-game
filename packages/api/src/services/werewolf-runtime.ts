import { actorProviderManifest, type GameModelRouting } from "@influence/engine";
import { fixtureWerewolfRetrospective, fixtureRetrospectiveCapacity, RetrospectiveExecutionError, ProviderUnavailableError } from "@influence/engine";
import { pauseRetrospectiveExecution } from "./game-retrospective-recovery.js";
import { WerewolfVisualBlocked } from "./werewolf-visual-policy.js";
import { createWerewolfVisualPreparation } from "./werewolf-visual-runtime.js";
import { eq } from "drizzle-orm";
import { createLlmProviderRuntimesFromEnv, resolveProviderManifestFromGameConfig } from "@influence/engine";
import { runWerewolf, replayWerewolf, WerewolfModelAgent, withEvaluationBudget, type WerewolfAgent } from "@influence/engine/werewolf";
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
  const mockAgent: WerewolfAgent = { prepareRetrospectiveCapacity: fixtureRetrospectiveCapacity, getRetrospectiveStatement: fixtureWerewolfRetrospective, async decide({ request, observation }) {
    if ("solo" in request && request.solo) return {kind: "solo_target", targetId: request.legalTargetIds[0]!, text: "I choose this player for tonight.", cue: null};
    if (request.action === "speaking_priority") return { kind: "speaking_priority", priority: 50 };
    if (request.action === "conversation") return { kind: "conversation", text: null, cue: null, recipientId: null, replyToContributionId: null };
    if (request.action === "public_vote" || request.action === "pack_propose") return { kind: "spoken_target", targetId: request.legalTargetIds[0]!, text: "I will follow this choice.", cue: null, thinking: "Fixture choice" };
    if (request.action === "open_thread") return { kind: "opening", text: "Who changed their mind?", cue: null, recipientIds: request.legalRecipientIds.slice(0, 3) };
    if (request.action === "discuss" && observation.turnReminder?.stage === "reply"
      && request.actorId !== observation.turnReminder.respondentIds[0]) return { kind: "speech", cue: null, text: null };
    return request.legalTargetIds.length ? { kind: "target", targetId: request.legalTargetIds[0]!, thinking: "Fixture choice" }
      : { kind: "speech", cue: null, text: "I will compare the claims with today's vote." };
  } };
  const runtimeOptions = { openAIServiceTier: "flex" as const, timeout: 120_000 };
  const contestantRuntimes = new Map(Object.keys((config.modelRouting as GameModelRouting | undefined)?.contestants ?? {}).map(id => [id,
    createLlmProviderRuntimesFromEnv(actorProviderManifest(config, { id, role: "player" }), process.env, runtimeOptions) ?? []]));
  const agent = agentOverride ?? (process.env.INFLUENCE_API_TEST_MOCK_RUNNER === "true" ? mockAgent : new WerewolfModelAgent({
    runtimes: contestantRuntimes.size ? [...new Map([...contestantRuntimes.values()].flat().map(runtime => [runtime.catalogId, runtime])).values()] : createLlmProviderRuntimesFromEnv(resolveProviderManifestFromGameConfig(config), process.env, runtimeOptions) ?? [],
    runtimesForActor: actorId => contestantRuntimes.get(actorId) ?? createLlmProviderRuntimesFromEnv(actorProviderManifest(config, { id: actorId, role: "player" }), process.env, runtimeOptions) ?? [],
    hooks: withEvaluationBudget(createApiProviderExecutionHooks(db, { gameId, ownerEpoch }), process.env), ownerEpoch,
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
  const store = createWerewolfStore(db, gameId, ownerEpoch);
  let recoverVisuals = async () => {};
  if (config.visualMode === true) {
    const prepareTurn = store.prepare!;
    const prepareScene = createWerewolfVisualPreparation(db, gameId, ownerEpoch, controller.signal);
    recoverVisuals = async () => {
      const events = await store.read();
      const last = events.at(-1);
      // A reload after committing night resolution must still prepare its scene.
      if (last?.type === "werewolf.night_resolved")
        await prepareScene.night(replayWerewolf(events.slice(0, -1)), last, replayWerewolf(events));
    };
    const append = store.append;
    store.append = async (event, retrospectiveInput) => {
      const before = event.type === "werewolf.night_resolved" ? replayWerewolf(await store.read()) : null;
      await append(event, retrospectiveInput);
      if (before) await prepareScene.night(before, event, replayWerewolf(await store.read()));
    };
    store.prepare = async (state, request, sequence) => {
      await prepareTurn(state, request, sequence);
      await prepareScene(state, request);
    };
  }
  const promise = recoverVisuals().then(() => runWerewolf(store, agent, controller.signal))
    .then(() => {})
    .catch(async (error) => {
      if (error instanceof RetrospectiveExecutionError && !controller.signal.aborted && !heartbeatFailure) {
        await pauseRetrospectiveExecution(db, gameId, ownerEpoch, error);
        return;
      }
      if (error instanceof WerewolfVisualBlocked) return;
      // A circuit cooldown is recoverable. Release ownership without advancing the
      // frozen turn or suspending the game; the worker can reclaim after health recovery.
      const circuitOpen = error instanceof ProviderUnavailableError && error.outcome.kind === "circuit_open";
      if (!controller.signal.aborted) {
        if (circuitOpen) console.warn(`[werewolf] Waiting for provider health recovery for ${gameId}; frozen turn preserved`);
        else console.error(`[werewolf] Execution failed for ${gameId}`, error);
      }
      try { await releaseWerewolfOwner(db, gameId, ownerEpoch, !circuitOpen && !controller.signal.aborted && !heartbeatFailure); }
      catch (releaseError) { console.error(`[werewolf] Owner release failed for ${gameId}; lease expiry will fence recovery`, releaseError); }
    })
    .finally(() => { clearInterval(heartbeat); active.delete(gameId); });
  active.set(gameId, { controller, promise });
}
