import { expect, test } from "bun:test";
import { InfluenceAgent } from "../agent";
import { LLMHouseInterviewer } from "../house-interviewer";
import { WerewolfModelAgent } from "../werewolf/agent";
import { observeWerewolf } from "../werewolf/observation";
import { startWerewolf, replayWerewolf, werewolfConfig } from "../werewolf/rules";
import type { LlmProviderAdapter, ModelInvocation, ProviderModelOutcome } from "../model-invocation";
import type { LlmProviderRuntime } from "../llm-client";
import { modelCatalogEntryById } from "../model-catalog";
import { classifyProviderError } from "../provider-execution";
import { Phase } from "../types";
import type { PhaseContext } from "../game-runner.types";

const history = 'Mira promised Atlas protection; Atlas disputed her claim. 界😀\n'.repeat(5000);
function provider(decision: unknown) {
  const requests: ModelInvocation[] = [];
  const adapter: LlmProviderAdapter = { id: "fixture", validate: () => ({ compatible: true }), classifyError: classifyProviderError,
    compile: invocation => ({ transport: "fixture.responses", body: invocation }),
    dispatch: async request => {
      const invocation = request.body as ModelInvocation; requests.push(invocation);
      const summary = invocation.result.kind === "structured" && invocation.result.artifact.name === "context_summary";
      if (!summary && JSON.stringify(invocation.messages).length > 50000) throw Object.assign(new Error("context window exceeded"), { code: "context_length_exceeded", status: 400 });
      const base: ProviderModelOutcome = { transport: "fixture.responses", nativeResponse: {}, toolCalls: [] };
      if (summary) return { ...base, text: JSON.stringify({ summary: "Mira promised protection; Atlas disputed it." }) };
      if (invocation.result.kind === "tool") return { ...base, toolCalls: [{ name: invocation.result.artifact.name, arguments: JSON.stringify(decision) }] };
      return { ...base, text: typeof decision === "string" ? decision : JSON.stringify(decision) };
    },
  };
  const model = modelCatalogEntryById("openai:gpt-5.6-luna")!;
  const runtime: LlmProviderRuntime = { adapter, catalogId: model.id, providerProfileId: model.providerProfileId, modelId: model.modelId,
    modelCapabilities: model.capabilities, reasoningPolicy: "low", toolChoiceMode: "named", position: 0, role: "primary" };
  return { runtime, requests, adapter };
}
function phase(): PhaseContext {
  return { gameId: "context-game", selfId: "atlas", selfName: "Atlas", phase: Phase.VOTE, round: 1,
    alivePlayers: [{ id: "atlas", name: "Atlas" }, { id: "mira", name: "Mira" }], publicMessages: [{ from: "Mira", text: history, round: 1, phase: Phase.MINGLE_I }], mingleMessages: [] };
}

test("Influence vote compacts rendered recall without changing current legal action or strategy state", async () => {
  const p = provider({ thinking: "Empower Mira.", empower: "Mira", strategyDelta: null });
  const agent = new InfluenceAgent("atlas", "Atlas", "strategic", p.adapter, p.runtime.modelId, undefined, undefined, { providerManifest: [p.runtime] });
  const context = phase(); agent.onGameStart(context.gameId!, context.alivePlayers);
  const before = agent.getCompactStrategyState();
  const result = await agent.getVotes(context);
  expect(result.empowerTarget).toBe("mira"); expect(agent.getCompactStrategyState()).toEqual(before);
  expect(agent.getContinuityCapsule()!.roundHistory).toEqual([{ round: 1, myVotes: { empower: "Mira" } }]);
  expect(p.requests.some(r => r.result.kind === "structured" && r.result.artifact.name === "context_summary")).toBe(true);
  const final = p.requests.at(-1)!;
  expect(JSON.stringify(final.messages)).toContain("Current Board Contract");
  expect(JSON.stringify(final.messages)).toContain("Mira promised protection");
  expect(final.result).toEqual(p.requests[0]!.result);
});

test("Werewolf compacts actor-visible history while retaining verified role knowledge and request", async () => {
  const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, personality: "Careful", backstory: "", strategy: "", avatarUrl: null }));
  const state = replayWerewolf([startWerewolf("wolf-context", players, werewolfConfig("one_wolf"), "context")]);
  const actorId = players.find(p => state.roles[p.id] === "seer")!.id;
  const observation = observeWerewolf(state, actorId);
  observation.board.entries.push({ kind: "speech", day: 1, actorId: "p0", audience: "public", text: history, cue: null });
  const request = { actorId, action: "vote" as const, legalTargetIds: players.filter(p => p.id !== actorId).map(p => p.id), voteMode: "plurality" as const };
  const p = provider({ targetId: request.legalTargetIds[0], thinking: "A legal vote." });
  const before = structuredClone(observation);
  await new WerewolfModelAgent({ runtimes: [p.runtime] }).decide({ gameId: state.gameId, actionSlot: 1, observation, request });
  const context = JSON.parse(p.requests.at(-1)!.messages[1]!.content!);
  expect(context.request).toEqual(request); expect(context.observation.self).toEqual(before.self);
  expect(context.observation.investigations).toEqual(before.investigations); expect(context.observation.packIds).toEqual([]);
  expect(observation).toEqual(before); expect(context.observation.board.entries).toHaveProperty("derivedContextMemory");
});

test("House interview compacts only the subject's provided history and preserves the interview boundary", async () => {
  const p = provider("Atlas, why did you dispute Mira's promise?");
  const house = new LLMHouseInterviewer(p.adapter, p.runtime.modelId, { providerManifest: [p.runtime] });
  const context = phase(); context.mingleMessages = [{ from: "Mira", text: history }];
  const result = await house.generateQuestion({ agentId: "atlas", agentName: "Atlas", round: 1, precedingPhase: Phase.MINGLE_I, sessionEventSequence: 3, playerKnowledge: context });
  expect(result).toContain("Mira");
  const final = p.requests.at(-1)!;
  expect(JSON.stringify(final.messages)).toContain("derivedContextMemory");
  expect(JSON.stringify(final.messages)).toContain("complete information boundary");
  expect(final.messages[0]).toEqual(p.requests[0]!.messages[0]);
});
