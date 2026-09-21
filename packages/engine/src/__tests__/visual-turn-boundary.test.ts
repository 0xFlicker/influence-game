import { expect, test } from "bun:test";
import { createStagedAgents } from "../durable-game-runner";
import type { DurableGameTurnSnapshotV1, PhaseContext } from "../game-runner.types";
import { Phase } from "../types";
import { MockAgent } from "./mock-agent";

const committed: DurableGameTurnSnapshotV1 = {
  version: 1, canonicalEvents: [], transcriptEntries: [],
  execution: { version: 1, gameId: "game", ownerEpoch: "owner", status: "ready",
    heads: { version: 1, turnSequence: 7, eventSequence: 15, eventHash: null, dialogueSequence: 4, publicationSequence: 8 },
    lastPresentationPhase: Phase.LOBBY, nextPublicationAvailableAt: null, xstateSnapshot: {},
    cursor: { version: 1, kind: "phase_enter", actor: "lobby" }, playerContinuityCapsules: [], houseNarrativeContinuity: null, retry: null },
};
const context: PhaseContext = { gameId: "game", round: 1, phase: Phase.LOBBY, selfId: "p1", selfName: "Arden", alivePlayers: [{ id: "p1", name: "Arden" }], publicMessages: [], mingleMessages: [] };
class RecordingAgent extends MockAgent {
  received: PhaseContext[] = [];
  override async getLobbyMessage(ctx: PhaseContext) { this.received.push(ctx); return { message: "Hello", thinking: "" }; }
}

test("holds agent dispatch until visual preparation finishes and preserves the committed boundary", async () => {
  const agent = new RecordingAgent("p1", "Arden");
  const gate = Promise.withResolvers<void>();
  const wrapped = createStagedAgents(new Map([[agent.id, agent]]), [], [], "turn-8", { committed, prepare: async (input) => {
    expect(input.committedHeads.turnSequence).toBe(7);
    expect(input.turnId).toBe("turn-8");
    expect(input.method).toBe("getLobbyMessage");
    input.context.selfName = "Mutated callback copy";
    await gate.promise;
    return { performanceInstructions: "Quiet delivery" };
  } });
  const response = wrapped.agents.get(agent.id)!.getLobbyMessage(context);
  expect(agent.received).toHaveLength(0);
  gate.resolve();
  await response;
  expect(agent.received[0]?.visual?.performanceInstructions).toBe("Quiet delivery");
  expect(agent.received[0]?.selfName).toBe("Arden");
  expect(context.visual).toBeUndefined();
});

test("a failed scene prevents model dispatch and cross-game context is rejected first", async () => {
  const agent = new RecordingAgent("p1", "Arden");
  let preparations = 0;
  const wrapped = createStagedAgents(new Map([[agent.id, agent]]), [], [], "turn-8", { committed, prepare: async () => {
    preparations += 1; throw new Error("Scene needs recovery");
  } });
  await expect(wrapped.agents.get(agent.id)!.getLobbyMessage(context)).rejects.toThrow("recovery");
  await expect(wrapped.agents.get(agent.id)!.getLobbyMessage({ ...context, gameId: "other" })).rejects.toThrow("boundary");
  expect(preparations).toBe(1);
  expect(agent.received).toHaveLength(0);
});

test("disabled games pass the original nonvisual context directly", async () => {
  const agent = new RecordingAgent("p1", "Arden");
  const wrapped = createStagedAgents(new Map([[agent.id, agent]]), []);
  await wrapped.agents.get(agent.id)!.getLobbyMessage(context);
  expect(agent.received[0]).toBe(context);
  expect(agent.received[0]?.visual).toBeUndefined();
});

test("discarding a scratch turn prevents late scene preparation from dispatching the agent", async () => {
  const agent = new RecordingAgent("p1", "Arden");
  const gate = Promise.withResolvers<void>();
  const wrapped = createStagedAgents(new Map([[agent.id, agent]]), [], [], "turn-8", { committed, prepare: async () => {
    await gate.promise;
    return { performanceInstructions: "Quiet" };
  } });
  const response = wrapped.agents.get(agent.id)!.getLobbyMessage(context);
  wrapped.stop();
  gate.resolve();
  await expect(response).rejects.toThrow("ended during scene preparation");
  expect(agent.received).toHaveLength(0);
});
