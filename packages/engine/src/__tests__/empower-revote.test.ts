import { describe, expect, it } from "bun:test";
import { createActor } from "xstate";
import { createPhaseMachine } from "../phase-machine";
import { GameState } from "../game-state";
import { TranscriptLogger } from "../transcript-logger";
import { ContextBuilder } from "../context-builder";
import { DiaryRoom } from "../diary-room";
import { TemplateHouseInterviewer } from "../house-interviewer";
import { DEFAULT_CONFIG } from "../types";
import type { PhaseRunnerContext } from "../phases/phase-runner-context";
import { resolveEmpowerRevote, runVotePhase, tallyEmpowerVote } from "../phases/vote";
import { projectViewerDecisionEvent } from "../viewer-decision-events";
import { MockAgent } from "./mock-agent";
import { resolveEmpowerRevoteVersion } from "../empower-revote-rules";

function context(gameState: GameState): PhaseRunnerContext {
  const logger = new TranscriptLogger(gameState);
  const agents: PhaseRunnerContext["agents"] = new Map();
  const mingleInbox: PhaseRunnerContext["mingleInbox"] = new Map();
  const contextBuilder = new ContextBuilder(gameState, logger, mingleInbox, gameState.getAlivePlayers().length);
  const houseInterviewer = new TemplateHouseInterviewer();
  return {
    gameState, logger, agents, mingleInbox, contextBuilder, houseInterviewer,
    config: DEFAULT_CONFIG,
    diaryRoom: new DiaryRoom(gameState, logger, contextBuilder, agents, DEFAULT_CONFIG, houseInterviewer),
    formatKernelState: { offeredFormats: null, selectedFormat: null, pressure: null, lastSelectedFormat: null },
    eliminationOrder: [],
  };
}

describe("Empower revote", () => {
  it.each([1, 2] as const)("uses frozen version %s in the non-durable runner", async (version) => {
    const ballots: Record<string, string> = { arden: "rowan", marnie: "rowan", milo: "arden", rowan: "marnie", larry: "arden" };
    const state = new GameState(Object.keys(ballots).map(id => ({ id, name: id })), { empowerRevoteVersion: version });
    state.startRound();
    const ctx = context(state);
    ctx.random = () => {
      if (version === 2) throw new Error("Unique winner must not use the wheel");
      return 0.99;
    };
    for (const [id, target] of Object.entries(ballots)) {
      const agent = new MockAgent(id, id);
      agent.getVotes = async () => ({ empowerTarget: target });
      agent.getEmpowerRevote = async () => ({ empowerTarget: target });
      ctx.agents.set(id, agent);
    }
    const actor = createActor(createPhaseMachine(), {
      input: { gameId: state.gameId, playerIds: Object.keys(ballots), maxRounds: 5 },
    });
    await runVotePhase(ctx, actor);
    expect(state.empoweredId).toBe(version === 1 ? "rowan" : "arden");
    expect(state.getCanonicalEvents().findLast(event => event.type === "vote.empowered_set")?.payload)
      .toEqual(version === 1 ? { empowered: "rowan", method: "wheel" } : { empowered: "arden", method: "revote" });
  });

  it.each([false, true])("keeps v1 through recovery and subsequent rounds (unversioned history: %s)", async (unversioned) => {
    const state = new GameState(["arden", "marnie", "milo", "rowan", "larry"].map(id => ({ id, name: id })), { empowerRevoteVersion: 1 });
    const events = structuredClone([...state.getCanonicalEvents()]);
    for (const event of events) {
      if (event.type === "game.roster_initialized" && unversioned) delete event.payload.empowerRevoteVersion;
    }
    const resumed = GameState.fromCanonicalEvents(events);
    expect(resumed.empowerRevoteVersion).toBe(1);
    expect(resumed.getCanonicalEvents()).toEqual(events);
    for (let round = 0; round < 2; round++) {
      resumed.startRound();
      for (const [voter, target] of Object.entries({ arden: "rowan", marnie: "rowan", milo: "arden", rowan: "marnie", larry: "arden" })) resumed.recordVote(voter, target);
      await tallyEmpowerVote(context(resumed));
      resumed.recordEmpowerReVote("marnie", "rowan");
      resumed.recordEmpowerReVote("milo", "arden");
      resumed.recordEmpowerReVote("larry", "arden");
      const recovered = GameState.fromCanonicalEvents(resumed.getCanonicalEvents());
      expect(await resolveEmpowerRevote(context(recovered), ["arden", "rowan"], () => 0.99)).toBe("rowan");
      expect(recovered.getCanonicalEvents().at(-1)?.payload).toEqual({ empowered: "rowan", method: "wheel" });
    }
  });

  it("freezes v2 for new games and rejects unknown persisted versions", () => {
    const state = new GameState([{ id: "a", name: "A" }]);
    expect(state.getCanonicalEvents()[0]?.payload).toMatchObject({ empowerRevoteVersion: 2 });
    expect(GameState.fromCanonicalEvents(state.getCanonicalEvents()).empowerRevoteVersion).toBe(2);
    expect(resolveEmpowerRevoteVersion(undefined)).toBe(1);
    expect(() => resolveEmpowerRevoteVersion(3)).toThrow("Unsupported empower revote version");
  });

  it.each([false, true])("counts only new ballots, including after recovery (%s)", async (recover) => {
    const state = new GameState(["arden", "marnie", "milo", "rowan", "larry"].map(id => ({ id, name: id })));
    // Earlier rounds' accepted revotes must not contribute either.
    state.startRound();
    state.recordEmpowerReVote("marnie", "rowan");
    state.recordEmpowerReVote("milo", "rowan");
    state.startRound();
    const ctx = context(state);
    state.recordVote("arden", "rowan");
    state.recordVote("marnie", "rowan");
    state.recordVote("milo", "arden");
    state.recordVote("rowan", "marnie");
    state.recordVote("larry", "arden");
    expect((await tallyEmpowerVote(ctx)).tied).toEqual(["arden", "rowan"]);
    state.recordEmpowerReVote("marnie", "rowan");
    const resumed = recover ? context(GameState.fromCanonicalEvents(state.getCanonicalEvents())) : ctx;
    resumed.gameState.recordEmpowerReVote("milo", "arden");
    resumed.gameState.recordEmpowerReVote("larry", "arden");
    const before = structuredClone([...resumed.gameState.getCanonicalEvents()]);
    const winner = await resolveEmpowerRevote(resumed, ["arden", "rowan"], () => { throw new Error("Unique winner must not use the wheel"); });
    expect(winner).toBe("arden");
    expect(resumed.gameState.getCanonicalEvents().slice(0, -1)).toEqual(before);
    const accepted = resumed.gameState.getCanonicalEvents().at(-1)!;
    if (accepted.type !== "vote.empowered_set") throw new Error("Expected accepted Empower outcome");
    expect(accepted).toMatchObject({ type: "vote.empowered_set", payload: { empowered: "arden", method: "revote" } });
    expect(projectViewerDecisionEvent(accepted)?.payload).toEqual(accepted.payload);
  });

  it.each([false, true])("uses the wheel only for a new-ballot tie (no revoters: %s)", async (noRevoters) => {
    const ids = noRevoters ? ["a", "b"] : ["a", "b", "c", "d"];
    const state = new GameState(ids.map(id => ({ id, name: id })));
    state.startRound();
    state.recordVote("a", "b");
    state.recordVote("b", "a");
    if (!noRevoters) {
      state.recordVote("c", "a");
      state.recordVote("d", "b");
    }
    const ctx = context(state);
    await tallyEmpowerVote(ctx);
    if (!noRevoters) {
      state.recordEmpowerReVote("c", "a");
      state.recordEmpowerReVote("d", "b");
    }
    expect(await resolveEmpowerRevote(ctx, ["a", "b"], () => 0.99)).toBe("b");
    expect(state.getCanonicalEvents().at(-1)?.payload).toEqual({ empowered: "b", method: "wheel" });
  });
});
