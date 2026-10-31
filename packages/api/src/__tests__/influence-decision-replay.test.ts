import { expect, test } from "bun:test";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import {
  InfluenceAgent, Phase, ProviderAcceptedValueIntegrityError, ProviderExecutionCoordinator,
  durableProviderLogicalCallId, durableProviderSemanticCoordinateForSubcall,
  type GameTurnIntentV1, type PhaseContext,
} from "@influence/engine";
import { resolveInfluenceDecisionContractVersion } from "@influence/engine/influence-decision-speech";
import { schema } from "../db/index.js";
import { createApiProviderExecutionHooks } from "../services/provider-call-journal.js";
import { createDurableGameRunnerStore } from "../services/durable-game-runner-store.js";
import { initialGameTranscriptStateValues } from "../services/transcript-capture.js";
import { insertGame, insertOwner } from "./durable-run-test-utils.js";
import { setupTestDB } from "./test-utils.js";

for (const value of [
  { empower: "mira-id", thinking: "Keep my ally in control.", strategyDelta: null },
  { empower: "mira-id", message: "Mira.", strategyDelta: null },
]) test(`replays a persisted v1 decision in its planned slot: ${JSON.stringify(value)}`, async () => {
  const db = await setupTestDB();
  const gameId = await insertGame(db, { status: "in_progress", config: {} });
  const ownerEpoch = await insertOwner(db, gameId, { expiresAt: "2099-01-01T00:00:00.000Z" });
  await db.insert(schema.gameTranscriptStates).values(initialGameTranscriptStateValues(gameId));
  const store = createDurableGameRunnerStore(db, { gameId, ownerEpoch });
  const initialized = await store.initialize({ version: 1, gameId, xstateSnapshot: { value: "vote" },
    cursor: { version: 1, kind: "phase_enter", actor: "vote" }, playerContinuityCapsules: [],
    houseNarrativeContinuity: null, canonicalEvents: [], transcriptEntries: [] });
  const turnId = `${gameId}:turn:1`;
  const subcall = { version: 1 as const, slot: 1,
    logicalCallId: durableProviderLogicalCallId({ gameId, turnId, subcallSlot: 1 }), actorId: "atlas-id", action: "vote", contractId: "agent-empower-vote-v1" };
  const semantic = durableProviderSemanticCoordinateForSubcall(turnId, subcall);
  const intent: GameTurnIntentV1 = { version: 1, gameId, turnId, turnSequence: 1, seed: "replay-fixture",
    baseHeads: initialized.execution.heads, branch: { version: 1, kind: "single_provider", action: "vote" },
    actorIds: ["atlas-id"], targetIds: [], handles: [], participantIds: ["atlas-id"], providerSubcalls: [subcall] };
  await store.planNextTurn(intent);
  const hooks = createApiProviderExecutionHooks(db, { gameId, ownerEpoch });
  const coordinate = { gameId, ownerEpoch, actor: { id: "atlas-id", name: "Atlas", role: "player" as const },
    action: "vote", phase: Phase.VOTE, round: 1, semantic, durableTurn: { turnId, subcallSlot: 1 } };
  // Fixture the historical terminal through the real journal, including its old
  // prepared contract. No provider transport or new schema is used to seed it.
  await new ProviderExecutionCoordinator({ hooks }).startCall(coordinate).execute({
    maxAttempts: 1, preparedRequest: { transport: "chat_completions", providerProfileId: "openai",
      catalogId: "openai:gpt-5-nano", model: "gpt-5-nano", body: { action: "agent-tool.vote.v1" } },
    dispatch: async () => value, validate: accepted => ({ status: "usable", value: accepted }),
  });
  // Reconstruct from the persisted planned turn. Raw debug evidence is not a
  // recovery dependency: deleting its outbox must not prevent accepted replay.
  await db.delete(schema.providerAttemptEvidenceOutbox).where(eq(schema.providerAttemptEvidenceOutbox.gameId, gameId));
  const reconstructed = createDurableGameRunnerStore(db, { gameId, ownerEpoch });
  expect((await reconstructed.planNextTurn(intent)).status).toBe("execute");
  const [game] = await db.select().from(schema.games).where(eq(schema.games.id, gameId));
  const config = JSON.parse(game!.config) as Record<string, unknown>;
  let dispatches = 0;
  const provider = new OpenAI({ apiKey: "fixture", fetch: async () => {
    dispatches += 1;
    throw new Error("Accepted replay must not dispatch");
  } });
  const makeAgent = (version: 1 | 2 | 3) => {
    const agent = new InfluenceAgent("atlas-id", "Atlas", "strategic", provider, "gpt-5-nano", undefined, undefined,
      { decisionContractVersion: version, providerExecutionHooks: createApiProviderExecutionHooks(db, { gameId, ownerEpoch }) });
    agent.onGameStart(gameId, context.alivePlayers);
    agent.setDurableProviderTurnBinding({ turnId, subcallSlot: 1, semanticCoordinate: semantic });
    return agent;
  };
  const context: PhaseContext = { gameId, phase: Phase.VOTE, round: 1, selfId: "atlas-id", selfName: "Atlas",
    alivePlayers: [{ id: "atlas-id", name: "Atlas" }, { id: "mira-id", name: "Mira" }, { id: "vera-id", name: "Vera" }],
    publicMessages: [], mingleMessages: [] };
  const result = await makeAgent(resolveInfluenceDecisionContractVersion(config.decisionContractVersion)).getVotes(context);
  expect(result.empowerTarget).toBe("mira-id");
  expect(result.thinking).toBe("thinking" in value ? value.thinking : undefined);
  expect(result.decisionMessage).toBe("message" in value ? value.message : undefined);
  if (!("message" in value)) await expect(makeAgent(2).getVotes(context)).rejects.toBeInstanceOf(ProviderAcceptedValueIntegrityError);
  expect(dispatches).toBe(0);
  const attempts = await db.select().from(schema.providerCallAttempts).where(eq(schema.providerCallAttempts.gameId, gameId));
  expect(attempts).toHaveLength(1);
  expect(attempts[0]).toMatchObject({ attemptOrdinal: 1, disposition: "accepted", status: "terminal" });
});
