import { describe, expect, test } from "bun:test";
import OpenAI from "openai";
import { createProviderAdapter } from "../provider-adapters";
import { modelCatalogEntryById } from "../model-catalog";
import type { LlmProviderRuntime } from "../llm-client";
import { exactStructuredOutputRegistry } from "../structured-output";
import { werewolfDecisionArtifact, WerewolfModelAgent } from "../werewolf/agent";
import { nextWerewolfStep, replayWerewolf, startWerewolf, werewolfConfig, werewolfEvent } from "../werewolf/rules";
import { advanceWerewolf, type WerewolfAgent } from "../werewolf/runner";

const miraId = "7c731c26-a298-4987-b015-07ab4bae27ce";
const leakedSpeech = `I propose attacking Mira (${miraId}). Her careful framing could make her a credible village anchor.`;
const cleanSpeech = "I propose attacking Mira. Her careful framing could make her a credible village anchor.";

describe("Werewolf names-only dialogue", () => {
  test.each(["introduce", "pack_talk", "discuss"] as const)("%s rejects spoken UUIDs in both fresh and journaled model values", action => {
    const artifact = werewolfDecisionArtifact({ actorId: "speaker", action, legalTargetIds: [] });
    for (const text of [leakedSpeech, `Ask ${miraId.toUpperCase()}.`, `Mira: {${miraId}}`]) {
      expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify({ cue: null, text })).status).toBe("invalid");
      expect(exactStructuredOutputRegistry.decodeAcceptedValue(artifact, { kind: "speech", text }).status).toBe("invalid");
    }
    for (const text of [cleanSpeech, null]) {
      expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify({ cue: null, text })).status).toBe("valid");
    }
  });

  test("UUIDs remain legal structured targets", () => {
    const artifact = werewolfDecisionArtifact({ actorId: "speaker", action: "attack", legalTargetIds: [miraId] });
    expect(exactStructuredOutputRegistry.decodeJsonDocument(artifact, JSON.stringify({ targetId: miraId, thinking: "Attack Mira." })).status).toBe("valid");
  });

  test("already committed speech stays readable without a transcript rewrite", () => {
    const players = Array.from({ length: 6 }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`,
      personality: "Careful", backstory: "", strategy: "", avatarUrl: null }));
    const initial = startWerewolf("historical-speech", players, werewolfConfig("one_wolf"), "history-seed");
    const state = replayWerewolf([initial]);
    const step = nextWerewolfStep(state);
    if (step.kind !== "action") throw new Error("Expected introduction");
    const committed = werewolfEvent(state, { type: "werewolf.action_accepted", payload: {
      ...step.request, decision: { kind: "speech", cue: null, text: leakedSpeech }, fallback: null,
    } });
    expect(replayWerewolf([initial, committed]).history.at(-1)).toMatchObject({ kind: "speech", text: leakedSpeech });
  });

  test.each(["repair", "exhaust"] as const)("pack dialogue retries UUID leakage before accepting speech (%s)", async mode => {
    const exhausted = mode === "exhaust";
    const players = Array.from({ length: 8 }, (_, index) => ({
      id: index === 0 ? miraId : `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
      name: index === 0 ? "Mira" : `Player ${index}`, personality: "Careful", backstory: "", strategy: "", avatarUrl: null,
    }));
    const events = [startWerewolf("speech-game", players, werewolfConfig("two_wolves"), "speech-seed")];
    const store = { read: async () => events, append: async (event: (typeof events)[number]) => { events.push(event); } };
    const quiet: WerewolfAgent = { decide: async () => ({ kind: "speech", cue: null, text: null }) };
    let state = replayWerewolf(events);
    while (state.phase !== "pack") state = await advanceWerewolf(store, quiet);
    const step = nextWerewolfStep(state);
    if (step.kind !== "action" || step.request.action !== "pack_talk") throw new Error("Expected pack proposal");
    const before = structuredClone(events);
    let dispatches = 0;
    const client = new OpenAI({ apiKey: "fixture", baseURL: "http://fixture.invalid/v1", maxRetries: 0,
      fetch: async (_url, init) => {
        dispatches++;
        expect(events).toEqual(before);
        const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
        expect(body.messages.find(message => message.role === "system")?.content).toContain("refer to players only by their character names");
        return Response.json({ id: `speech-${dispatches}`, object: "chat.completion", created: 0, model: "glm-5-2",
          choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null,
            tool_calls: [{ id: "proposal", type: "function", function: { name: "werewolf_pack_talk", arguments: JSON.stringify({
              cue: null, text: exhausted || dispatches === 1 ? leakedSpeech : cleanSpeech,
            }) } }],
          } }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } });
      },
    });
    const model = modelCatalogEntryById("katana:glm-5-2")!;
    const runtime: LlmProviderRuntime = { adapter: createProviderAdapter("katana", client), catalogId: model.id,
      providerProfileId: "katana", modelId: model.modelId, modelCapabilities: model.capabilities,
      reasoningPolicy: "medium", toolChoiceMode: "required", position: 0, role: "primary" };
    const accepted = await advanceWerewolf(store, new WerewolfModelAgent({ runtimes: [runtime] }));
    expect(dispatches).toBe(exhausted ? 3 : 2);
    expect(accepted.actions[0]).toMatchObject({ fallback: exhausted ? "provider_unavailable" : null,
      decision: { kind: "speech", cue: null, text: exhausted ? null : cleanSpeech } });
    const speech = accepted.history.filter(entry => entry.kind === "speech");
    expect(speech).toHaveLength(exhausted ? 0 : 1);
    expect(speech.some(entry => entry.text?.includes(miraId))).toBe(false);
  });
});
