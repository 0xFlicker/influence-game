import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { GameRunner, InfluenceAgent, InMemoryMemoryStore, resolveProviderManifestFromGameConfig, createLlmProviderRuntimesFromEnv,
  contextSourceHash, ContextSourceConflictError, durableProviderLogicalCallId, type DurableGameTurnStore, type ModelInvocation,
  type ProviderExecutionHooks, type Personality, type DurableGameTurnSnapshotV1, type GameTurnIntentV1, type ProviderAttemptRecord } from "../../../packages/engine/src/index.ts";
import { hashCanonicalJson } from "../../../packages/prompt-lab-protocol/src/index.ts";
import { buildEngineConfigFromGameRecord } from "../../../packages/api/src/services/game-lifecycle.ts";
import { isUserSelectableAgentArchetype } from "../../../packages/api/src/services/agent-archetypes.ts";

/** Offline incident reproducer. Reads a private fixture; never connects to production or a provider. */
interface RecoveryFixture {
  game: { id: string; slug: string; config: string; minPlayers: number; maxPlayers: number };
  players: Array<{ id: string; persona: string; agentConfig: string; agentProfileId: string | null }>;
  snapshot: DurableGameTurnSnapshotV1;
  planned: { turnSequence: number; intent: GameTurnIntentV1 };
  evidence: { logicalCallId: string; attempt: ProviderAttemptRecord };
  evidenceManifest: { id: string; sha256: string; byteLength: number };
}

const fixturePath = process.argv[2];
if (!fixturePath) throw new Error("Explicit private fixture path required");
const fixtureBytes = readFileSync(fixturePath);
const saved = JSON.parse(fixtureBytes.toString("utf8")) as RecoveryFixture;
const expectedConflict = process.argv.includes("--expect-conflict");
const original = saved.evidence.attempt;
const savedContext = original.context;
const savedCatalogId = original.preparedRequest.catalogId;
assert.ok(savedContext, "Saved attempt must contain a frozen context identity");
assert.ok(savedCatalogId, "Saved attempt must name its catalog entry");
const expectedHash = savedContext.sourceHash;
assert.equal(saved.game.id, saved.snapshot.execution.gameId);
assert.equal(saved.planned.intent.turnSequence, saved.snapshot.execution.heads.turnSequence + 1);
const snapshotHash = hashCanonicalJson(saved.snapshot);
let networkCalls = 0;
globalThis.fetch = Object.assign(
  async () => { networkCalls++; throw new Error("Network disabled for recovery proof"); },
  { preconnect: () => { networkCalls++; throw new Error("Network disabled for recovery proof"); } },
);
const config = JSON.parse(saved.game.config);
assert.equal(config.visualMode, false, "This probe requires a nonvisual saved call");
const selection = resolveProviderManifestFromGameConfig(config);
const runtimes = createLlmProviderRuntimesFromEnv(selection, { OPENAI_API_KEY: "offline-proof", API_KAT_IMGNAI_KEY: "offline-proof", API_KAT_IMGNAI_SECRET: "offline-proof" }, { openAIServiceTier: "flex" });
assert.ok(runtimes, "All frozen providers must resolve with dummy credentials");
let captured: ModelInvocation | undefined;
let nativeRequestMatches = false;
let contextAttemptsRead = false;
let terminalWrites = 0;
let turnCommits = 0;
const stopped = new Error("Recovery proof stopped after compilation, before dispatch");
for (const runtime of runtimes) {
  const actual = runtime.adapter;
  runtime.adapter = {
    id: actual.id,
    validate(invocation, descriptor) {
      captured = invocation;
      return actual.validate(invocation, descriptor);
    },
    compile(invocation, descriptor) {
      captured = invocation;
      const request = actual.compile(invocation, descriptor);
      assert.equal(contextSourceHash(invocation), expectedHash);
      assert.equal(request.transport, original.preparedRequest.transport);
      assert.deepEqual(request.body, original.preparedRequest.body);
      nativeRequestMatches = true;
      throw stopped;
    },
    dispatch: async () => { networkCalls++; throw new Error("Provider dispatch disabled"); },
    classifyError: (error, signal) => actual.classifyError(error, signal),
  };
}
const hooks: ProviderExecutionHooks = {
  onReadLengthFeedback(coordinate) {
    assert.ok(coordinate.gameId, "Expected the saved game identity");
    assert.ok(coordinate.durableTurn, "Expected the saved durable provider slot");
    assert.equal(durableProviderLogicalCallId({ gameId: coordinate.gameId, ...coordinate.durableTurn }), saved.evidence.logicalCallId);
    return undefined;
  },
  onReadAccepted: () => undefined,
  onReadContextAttempts: async () => {
    contextAttemptsRead = true;
    return [{ catalogId: savedCatalogId, sourceHash: expectedHash, revision: savedContext.revision, outcome: original.outcome.kind }];
  },
  onAllocateAttemptOrdinal: () => original.attemptOrdinal + 1,
  onReserve: () => { throw new Error("Proof must stop before reservation"); },
  onTerminal: () => { terminalWrites++; throw new Error("Proof must never write terminal evidence"); },
};
const primary = runtimes[0]!;
const agents = saved.players.map((player: { id: string; persona: string; agentConfig: string; agentProfileId: string | null }) => {
  const persona = JSON.parse(player.persona) as { name: string; personaKey?: string; personality?: string; strategyHints?: string; backstory?: string };
  const cfg = JSON.parse(player.agentConfig) as { model?: string; temperature?: number };
  const key = persona.personaKey ?? persona.personality;
  const personality: Personality = isUserSelectableAgentArchetype(key) ? key as Personality : "strategic";
  return new InfluenceAgent(player.id, persona.name, personality, primary.adapter, cfg.model ?? selection[0]!.modelId,
    persona.backstory, new InMemoryMemoryStore(), {
      providerProfileId: selection[0]!.providerProfile.id, catalogId: selection[0]!.catalogId,
      modelCapabilities: selection[0]!.model.capabilities, reasoningPolicy: selection[0]!.reasoningPolicy,
      ...(primary.openAIReasoningSummary && { openAIReasoningSummary: primary.openAIReasoningSummary }),
      ...(player.agentProfileId && persona.personality && { personalityPrompt: persona.personality }),
      ...(player.agentProfileId && persona.strategyHints && { strategyInstructions: persona.strategyHints }),
      ...(cfg.temperature !== undefined && { temperature: cfg.temperature }),
      providerManifest: runtimes, providerExecutionHooks: hooks,
    });
});
const store: DurableGameTurnStore = {
  load: async gameId => { assert.equal(gameId, saved.game.id); return structuredClone(saved.snapshot); },
  initialize: async () => { throw new Error("Existing game must not initialize"); },
  planNextTurn: async intent => {
    assert.deepEqual(intent, saved.planned.intent);
    return { version: 1, status: "execute", intent: structuredClone(saved.planned.intent) };
  },
  commitTurn: async () => { turnCommits++; throw new Error("Proof must not commit a turn"); },
  readRetrospectiveSource: async () => { throw new Error("Not at retrospective"); },
};
const runner = new GameRunner(agents, buildEngineConfigFromGameRecord(config, saved.game.minPlayers, saved.game.maxPlayers), undefined,
  { gameId: saved.game.id, durableTurnStore: store });
let failure: unknown;
try { await runner.run(); } catch (error) { failure = error; }
assert.ok(captured, "Runner must reach the original pending provider call");
const actualHash = contextSourceHash(captured);
assert.ok(contextAttemptsRead, "Must exercise the saved context guard");
if (expectedConflict) {
  assert.ok(failure instanceof ContextSourceConflictError);
  assert.notEqual(actualHash, expectedHash);
  assert.equal(nativeRequestMatches, false);
} else {
  assert.equal(failure, stopped);
  assert.equal(actualHash, expectedHash);
  assert.equal(nativeRequestMatches, true);
}
assert.equal(networkCalls, 0);
assert.equal(terminalWrites, 0);
assert.equal(turnCommits, 0);
assert.equal(hashCanonicalJson(saved.snapshot), snapshotHash);
const result = { mode: expectedConflict ? "production-serialization" : "patched-serialization", gameSlug: saved.game.slug,
  fixtureSha256: createHash("sha256").update(fixtureBytes).digest("hex"), evidenceManifest: saved.evidenceManifest,
  committedHeads: saved.snapshot.execution.heads, pendingTurn: saved.planned.turnSequence, logicalCallId: saved.evidence.logicalCallId,
  expectedContextHash: expectedHash, actualContextHash: actualHash, contextMatches: actualHash === expectedHash,
  guardReadSavedAttempt: contextAttemptsRead, nativeRequestMatches, contextSpanCount: captured.contextSpans?.length,
  networkCalls, terminalWrites, turnCommits, savedSnapshotUnchanged: true };
console.log(JSON.stringify(result, null, 2));
