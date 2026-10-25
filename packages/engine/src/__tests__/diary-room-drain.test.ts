import { expect, test } from "bun:test";
import { ContextBuilder } from "../context-builder";
import { DiaryRoom } from "../diary-room";
import { GameState } from "../game-state";
import { TemplateHouseInterviewer } from "../house-interviewer";
import { TranscriptLogger } from "../transcript-logger";
import { DEFAULT_CONFIG, Phase } from "../types";
import { MockAgent } from "./mock-agent";

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
