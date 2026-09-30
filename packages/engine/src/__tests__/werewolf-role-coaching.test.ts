import { expect, test } from "bun:test";
import OpenAI from "openai";
import { createProviderAdapter } from "../provider-adapters";
import { modelCatalogEntryById } from "../model-catalog";
import type { LlmProviderRuntime } from "../llm-client";
import { WerewolfModelAgent } from "../werewolf/agent";
import { observeWerewolf, projectWerewolfView } from "../werewolf/observation";
import { replayWerewolf, startWerewolf, werewolfConfig, WEREWOLF_RULES } from "../werewolf/rules";
import { werewolfRoleCoaching } from "../werewolf/strategy";

test.each(["seer", "doctor", "villager", "werewolf"] as const)("%s receives only its own coaching without changing knowledge or the decision contract", async role => {
  const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, personality: "Bold",
    backstory: "An actor", strategy: "OWNER_STRATEGY_UNCHANGED", avatarUrl: null }));
  const state = replayWerewolf([startWerewolf("coaching-test", players, werewolfConfig("two_wolves"), "coaching-test")]);
  const actorId = players.find(player => state.roles[player.id] === role)!.id;
  const observation = observeWerewolf(state, actorId);
  const before = structuredClone(observation);
  const actions = role === "doctor" ? ["introduce", "protect"] as const
    : role === "seer" ? ["introduce", "investigate"] as const : ["introduce", "vote"] as const;
  let calls = 0;
  const client = new OpenAI({ apiKey: "fixture", baseURL: "http://fixture.invalid/v1", maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const context = JSON.parse(body.messages.at(-1).content);
      expect(body.messages[0].role).toBe("system");
      expect(body.messages[0].content).toContain(WEREWOLF_RULES);
      expect(body.messages[0].content).toContain("Roles remain secret until game end.");
      expect(body.messages[0].content).toContain("There are no daytime investigations.");
      const completedNights = before.board.entries.filter(entry => entry.kind === "night").length;
      expect(context.seerTiming).toMatchObject({ completedNights, maximumPossibleResults: completedNights });
      expect(context.observation.self.strategy).toBe("OWNER_STRATEGY_UNCHANGED");
      expect(context.observation.investigations).toEqual(before.investigations);
      expect(context.observation.previousProtection).toEqual(before.previousProtection);
      expect(context.observation.board).toEqual(before.board);
      expect(Object.keys(context).at(-1)).toBe("turnReminder");
      expect(context.contributionGuidance ?? "").not.toContain("You do not need to contribute to every thread.");
      if (role !== "werewolf") expect(context.roleCoaching).toBe(werewolfRoleCoaching(role));
      else expect(Object.hasOwn(context, "roleCoaching")).toBe(false);
      const action = actions[calls++]!;
      expect(context.request.action).toBe(action);
      const decision = action === "introduce" ? { text: "I will listen first.", cue: null }
        : { targetId: context.request.legalTargetIds[0], thinking: "A private role decision." };
      return Response.json({ id: `coaching-${calls}`, object: "chat.completion", created: 0, model: "glm-5-2",
        choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
          tool_calls: [{ id: "decision", type: "function", function: { name: `werewolf_${action}`, arguments: JSON.stringify(decision) } }],
        } }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } });
    } });
  const model = modelCatalogEntryById("katana:glm-5-2")!;
  const runtime: LlmProviderRuntime = { adapter: createProviderAdapter("katana", client), catalogId: model.id,
    providerProfileId: "katana", modelId: model.modelId, modelCapabilities: model.capabilities,
    reasoningPolicy: "medium", toolChoiceMode: "required", position: 0, role: "primary" };
  const agent = new WerewolfModelAgent({ runtimes: [runtime] });
  for (const action of actions) {
    const targetIds = action === "introduce" ? [] : players.filter(player => player.id !== actorId).map(player => player.id);
    const decision = await agent.decide({ gameId: state.gameId, actionSlot: calls + 1, observation,
      request: { actorId, ...(action === "vote" ? { action, voteMode: "majority" as const } : { action }), legalTargetIds: targetIds } });
    expect(decision.kind).toBe(action === "introduce" ? "speech" : "target");
  }
  expect(calls).toBe(actions.length);
  expect(observation).toEqual(before);
  for (const audience of ["mystery", "omniscient"] as const) {
    const view = JSON.stringify(projectWerewolfView(state, audience));
    expect(view).not.toContain("roleCoaching");
    expect(view).not.toContain("OWNER_STRATEGY_UNCHANGED");
  }
});

test.each([
  { phase: "introduction", day: 0, nights: 0 },
  { phase: "night", day: 1, nights: 0 },
  { phase: "day", day: 1, nights: 1 },
  { phase: "vote", day: 1, nights: 1 },
  { phase: "night", day: 2, nights: 1 },
  { phase: "day", day: 2, nights: 2 },
] as const)("Seer timing uses completed nights during $phase $day, not the phase day or number of replies", async ({ phase, day, nights }) => {
  const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, personality: "Bold", backstory: "", strategy: "", avatarUrl: null }));
  const state = replayWerewolf([startWerewolf("timing-test", players, werewolfConfig("two_wolves"), "timing-test")]);
  const actorId = players.find(player => state.roles[player.id] === "villager")!.id;
  const observation = observeWerewolf(state, actorId);
  // Model-input fixture: the public night count stays the same through every
  // daytime contribution and the next unresolved night; no private ledger needed.
  observation.board.phase = phase;
  observation.board.day = day;
  observation.board.entries = Array.from({ length: nights }, (_, i) => ({ kind: "night", day: i + 1, killedId: null }));
  observation.board.entries.push(...Array.from({ length: 12 }, () => ({ kind: "speech" as const, day,
    actorId, audience: "public" as const, text: "Can you investigate again?", cue: null })));
  const client = new OpenAI({ apiKey: "fixture", baseURL: "http://fixture.invalid/v1", maxRetries: 0,
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const context = JSON.parse(body.messages.at(-1).content);
      expect(context.seerTiming).toMatchObject({ completedNights: nights, maximumPossibleResults: nights });
      expect(context.seerTiming.reminder).toContain(`at most ${nights} completed investigation result(s)`);
      expect(context.observation.investigations).toEqual([]);
      expect(Object.keys(context).at(-1)).toBe("turnReminder");
      return Response.json({ id: "timing", object: "chat.completion", created: 0, model: "glm-5-2",
        choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
          tool_calls: [{ id: "decision", type: "function", function: { name: "werewolf_introduce", arguments: JSON.stringify({ text: null, cue: null }) } }],
        } }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } });
    } });
  const model = modelCatalogEntryById("katana:glm-5-2")!;
  const runtime: LlmProviderRuntime = { adapter: createProviderAdapter("katana", client), catalogId: model.id,
    providerProfileId: "katana", modelId: model.modelId, modelCapabilities: model.capabilities,
    reasoningPolicy: "medium", toolChoiceMode: "required", position: 0, role: "primary" };
  await new WerewolfModelAgent({ runtimes: [runtime] }).decide({ gameId: state.gameId, actionSlot: 1, observation,
    request: { actorId, action: "introduce", legalTargetIds: [] } });
});
