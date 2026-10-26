import { expect, test } from "bun:test";
import { ContextBuilder } from "../context-builder";
import { DiaryRoom } from "../diary-room";
import { GameState } from "../game-state";
import { TemplateHouseInterviewer } from "../house-interviewer";
import { TranscriptLogger } from "../transcript-logger";
import { DEFAULT_CONFIG, Phase } from "../types";
import { MockAgent } from "./mock-agent";
import { createStagedAgents } from "../durable-game-runner";
import { ProviderExecutionCoordinator, ProviderUnavailableError } from "../provider-execution";

test.each([false, true])("diary failure drains outstanding interviews before owner cleanup (jury=%s)", async jury => {
  const players = ["a", "b", "c", "d"].map(id => ({ id, name: id.toUpperCase() }));
  const state = new GameState(players);
  if (jury) {
    state.eliminatePlayer("a");
    state.eliminatePlayer("b");
    state.setEndgameStage("judgment");
  }
  const logger = new TranscriptLogger(state);
  const builder = new ContextBuilder(state, logger, new Map(), players.length);
  const agents = new Map(players.map(player => [player.id, new MockAgent(player.id, player.name)]));
  const peerStarted = Promise.withResolvers<void>();
  const peerMayFinish = Promise.withResolvers<void>();
  const failure = new Error("Provider terminal evidence write failed");
  let peerFinished = false;
  let ownerReleased = false;
  agents.get("a")!.getDiaryEntry = async () => { throw failure; };
  agents.get("b")!.getDiaryEntry = async () => {
    peerStarted.resolve();
    await peerMayFinish.promise;
    expect(ownerReleased).toBe(false);
    peerFinished = true;
    return { thinking: "I can explain my vote.", message: "I changed my mind." };
  };
  const diary = new DiaryRoom(state, logger, builder, agents, {
    ...DEFAULT_CONFIG, diaryRoomAfterPhases: [Phase.FORMAT_RESOLVE], maxDiaryFollowUps: 0,
  }, new TemplateHouseInterviewer());
  const result = diary.runDiaryRoom(Phase.FORMAT_RESOLVE)
    .then(() => null, error => error)
    .finally(() => { ownerReleased = true; });
  try {
    await peerStarted.promise;
    await Bun.sleep(0);
    expect(ownerReleased).toBe(false);
    expect(peerFinished).toBe(false);
  } finally {
    peerMayFinish.resolve();
  }
  expect(await result).toBe(failure);
  expect(peerFinished).toBe(true);
  expect(ownerReleased).toBe(true);
});

const pendingStages = ["question", "answer", "follow-up question", "follow-up answer"] as const;
for (const jury of [false, true]) test.each([...pendingStages])(`fatal evidence failure fences new calls while draining %s (jury=${jury})`, async stage => {
  const players = ["a", "b", "c", "d"].map(id => ({ id, name: id }));
  const state = new GameState(players);
  if (jury) {
    state.eliminatePlayer("a"); state.eliminatePlayer("b"); state.setEndgameStage("judgment");
  }
  const logger = new TranscriptLogger(state);
  const builder = new ContextBuilder(state, logger, new Map(), players.length);
  const agents = new Map(players.map(player => [player.id, new MockAgent(player.id, player.name)]));
  const peerStarted = Promise.withResolvers<void>();
  const evidenceFailed = Promise.withResolvers<void>();
  const failure = new Error("Terminal evidence write failed");
  let ownerReleased = false, peerSettled = false, answers = 0, followUps = 0;
  const drainPeer = async () => {
    peerStarted.resolve();
    await evidenceFailed.promise;
    await Bun.sleep(0);
    expect(ownerReleased).toBe(false);
    peerSettled = true;
  };
  const coordinator = new ProviderExecutionCoordinator({ hooks: {
    onReserve() {},
    onTerminal() { evidenceFailed.resolve(); throw failure; },
  } });
  agents.get("a")!.getDiaryEntry = async () => {
    await peerStarted.promise;
    return coordinator.startCall({ gameId: "fixture", actor: { id: "a", name: "a", role: "player" }, action: "diary-answer",
      semantic: { version: 1, kind: "diary_exchange", sessionEventSequence: 1, playerId: "a", exchangeOrdinal: 1 },
    }).execute({ maxAttempts: 1, preparedRequest: { transport: "fixture", providerProfileId: "openai", model: "fixture", body: {} },
      dispatch: async () => ({ thinking: "thought", message: "answer" }), validate: value => ({ status: "usable", value }),
    });
  };
  agents.get("b")!.getDiaryEntry = async () => {
    answers++;
    if (stage === "answer" || stage === "follow-up answer" && answers === 2) await drainPeer();
    return { thinking: "thought", message: "answer" };
  };
  const house = new TemplateHouseInterviewer();
  house.generateQuestion = async context => {
    if (context.agentId === "b" && stage === "question") await drainPeer();
    return "Why?";
  };
  house.generateFollowUpOrClose = async context => {
    if (context.agentId !== "b") return { type: "close", message: "Thank you." };
    followUps++;
    if (stage === "follow-up question") await drainPeer();
    return { type: "question", question: "What next?" };
  };
  const staged = createStagedAgents(agents, []);
  const diary = new DiaryRoom(state, logger, builder, staged.agents, {
    ...DEFAULT_CONFIG, diaryRoomAfterPhases: [Phase.FORMAT_RESOLVE], maxDiaryFollowUps: 2,
  }, house, () => { expect(ownerReleased).toBe(false); });
  try {
    await expect(diary.runDiaryRoom(Phase.FORMAT_RESOLVE)).rejects.toBe(failure);
    expect(peerSettled).toBe(true);
    expect(answers).toBe(stage === "question" ? 0 : stage === "follow-up answer" ? 2 : 1);
    expect(followUps).toBe(stage.startsWith("follow-up") ? 1 : 0);
  } finally {
    ownerReleased = true;
    staged.stop();
  }
});

test("rules-legal provider absence does not fence a sibling's follow-up or the next session", async () => {
  const players = ["a", "b"].map(id => ({ id, name: id }));
  const state = new GameState(players);
  const logger = new TranscriptLogger(state);
  const agents = new Map(players.map(player => [player.id, new MockAgent(player.id, player.name)]));
  const builder = new ContextBuilder(state, logger, new Map(), players.length);
  const house = new TemplateHouseInterviewer();
  house.generateFollowUpOrClose = async () => ({ type: "question", question: "Why?" });
  let answers = 0;
  agents.get("a")!.getDiaryEntry = async () => { throw new ProviderUnavailableError("unavailable", "service_error"); };
  agents.get("b")!.getDiaryEntry = async () => { answers++; return { thinking: "thought", message: "answer" }; };
  const diary = new DiaryRoom(state, logger, builder, agents, { ...DEFAULT_CONFIG, maxDiaryFollowUps: 1 }, house);
  await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);
  expect(answers).toBe(2);
  agents.get("a")!.getDiaryEntry = async () => { throw new Error("fatal"); };
  await expect(diary.runDiaryRoom(Phase.FORMAT_RESOLVE)).rejects.toThrow("fatal");
  const beforeRecovery = answers;
  agents.get("a")!.getDiaryEntry = async () => ({ thinking: "thought", message: "recovered" });
  await diary.runDiaryRoom(Phase.FORMAT_RESOLVE);
  expect(answers - beforeRecovery).toBe(2);
});

test.each(["retry", "fallback", "reserved"])("fatal diary failure fences new provider admissions but retains admitted evidence (%s)", async mode => {
  const players = ["a", "b"].map(id => ({ id, name: id }));
  const state = new GameState(players), logger = new TranscriptLogger(state);
  const agents = new Map(players.map(player => [player.id, new MockAgent(player.id, player.name)]));
  const started = Promise.withResolvers<void>(), failed = Promise.withResolvers<void>();
  const failure = new Error("A terminal journal failed");
  let dispatches = 0, saved = 0;
  const a = new ProviderExecutionCoordinator({ hooks: {
    onTerminal() { failed.resolve(); throw failure; },
  } });
  const b = new ProviderExecutionCoordinator({ wait: async () => {}, hooks: {
    async onReserve() {
      if (mode === "reserved") { started.resolve(); await failed.promise; await Bun.sleep(0); }
    },
    onTerminal() { saved++; },
  } });
  const coordinate = (id: string) => ({ gameId: "fixture", actor: { id, name: id, role: "player" as const }, action: "diary-answer",
    semantic: { version: 1 as const, kind: "diary_exchange" as const, sessionEventSequence: 1, playerId: id, exchangeOrdinal: 1 } });
  const request = { transport: "fixture", providerProfileId: "openai" as const, model: "fixture", body: {} };
  agents.get("a")!.getDiaryEntry = async () => {
    await started.promise;
    return a.startCall(coordinate("a")).execute({ maxAttempts: 1, preparedRequest: request,
      dispatch: async () => ({ thinking: "thought", message: "answer" }), validate: value => ({ status: "usable", value }) });
  };
  agents.get("b")!.getDiaryEntry = async () => {
    const result = await b.startCall(coordinate("b")).executeManifest({ entries: ["first", "second"].map(catalogId => ({
      catalogId, maxAttempts: mode === "retry" ? 2 : 1, preparedRequest: { ...request, catalogId },
      dispatch: async () => {
        dispatches++;
        if (mode !== "reserved") {
          started.resolve(); await failed.promise; await Bun.sleep(0);
          throw new TypeError("connection lost");
        }
        return { thinking: "thought", message: "answer" };
      },
      validate: (value: { thinking: string; message: string }) => ({ status: "usable" as const, value }),
    })) });
    return result.value;
  };
  const diary = new DiaryRoom(state, logger, new ContextBuilder(state, logger, new Map(), 2), agents,
    { ...DEFAULT_CONFIG, maxDiaryFollowUps: 0 }, new TemplateHouseInterviewer());
  await expect(diary.runDiaryRoom(Phase.FORMAT_RESOLVE)).rejects.toBe(failure);
  expect(dispatches).toBe(1);
  expect(saved).toBe(1);
  // The session fence must not mutate a shared coordinator or leak into unrelated work.
  expect(await b.startCall(coordinate("unrelated")).execute({ maxAttempts: 1, preparedRequest: request,
    dispatch: async () => "unrelated result", validate: value => ({ status: "usable", value }) })).toBe("unrelated result");
});

test("draining preserves the first fatal error even when an earlier roster entry fails later", async () => {
  const players = ["a", "b"].map(id => ({ id, name: id }));
  const state = new GameState(players), logger = new TranscriptLogger(state);
  const agents = new Map(players.map(player => [player.id, new MockAgent(player.id, player.name)]));
  const failed = Promise.withResolvers<void>();
  const first = new Error("B failed first"), later = new Error("A failed later");
  agents.get("a")!.getDiaryEntry = async () => { await failed.promise; await Bun.sleep(0); throw later; };
  agents.get("b")!.getDiaryEntry = async () => { failed.resolve(); throw first; };
  const diary = new DiaryRoom(state, logger, new ContextBuilder(state, logger, new Map(), 2), agents,
    { ...DEFAULT_CONFIG, maxDiaryFollowUps: 0 }, new TemplateHouseInterviewer());
  await expect(diary.runDiaryRoom(Phase.FORMAT_RESOLVE)).rejects.toBe(first);
});
