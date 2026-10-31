import { expect, test } from "bun:test";
import { CURRENT_INFLUENCE_DECISION_CONTRACT_VERSION, resolveInfluenceDecisionContractVersion, decisionSpeechPolicy, withDecisionSpeech, validateDecisionSpeech } from "../influence-decision-speech";
import { GameState } from "../game-state";
import { TranscriptLogger } from "../transcript-logger";
import { Phase } from "../types";
import { FORMAT_CATALOG, resolveSealedElimRound } from "../formats";

const players = [{ id: "a", name: "Ada" }, { id: "b", name: "Bea" }, { id: "c", name: "Cam" }];
test("drafting margin does not narrow acceptance or permit multibyte overages", () => {
  const tool = withDecisionSpeech({ name: "pick", schema: { type: "object", properties: {}, required: [], additionalProperties: false } }, "format-pick");
  expect(JSON.stringify(tool.schema)).toContain("Aim for 192 UTF-8 bytes or fewer");
  // Existing legal speech above the soft target must remain valid, including replay.
  expect(validateDecisionSpeech("format-pick", { message: "a".repeat(320) })).toBeNull();
  expect(validateDecisionSpeech("format-pick", { message: "🐺".repeat(80) })).toBeNull();
  expect(validateDecisionSpeech("format-pick", { message: "🐺".repeat(81) })).toContain("exceeds 320");
});
test("speech-only decisions do not request thinking; public moves retain it", () => {
  for (const action of ["vote", "empower-revote", "format-pick", "format-tiebreak", "format-two-names-tiebreak", "format-two-names-initial-names", "format-two-names-override", "format-two-names-replacement", "bounce-pointer"]) {
    const tool = withDecisionSpeech({ name: action, schema: { type: "object", properties: { thinking: { type: "string" } }, required: ["thinking"], additionalProperties: false } }, action);
    expect(tool.schema.required).toContain("message");
    expect((tool.schema.required as string[]).includes("thinking")).toBe(decisionSpeechPolicy(action)!.thinking);
  }
});
test("accepted ballots retain speech without entering contestant dialogue or thinking", () => {
  const logger = new TranscriptLogger(new GameState(players));
  logger.emitAgentTurn({ phase: Phase.VOTE, action: "vote", actor: { id: "a", name: "Ada", role: "player" }, visibility: "private", response: { message: "Bea.", empowerTarget: "b" }, thinking: "Private", reasoningContext: "Native private", scope: "system", text: "Receipt" });
  expect(logger.publicMessages).toEqual([]);
  expect(logger.transcript).toHaveLength(1);
  expect(logger.transcript[0]).toMatchObject({ text: "Bea.", scope: "system", dialogueContext: { decisionSpeech: { action: "vote", actorId: "a" } } });
  expect(logger.transcript[0]!.thinking).toBeUndefined();
  expect(logger.transcript[0]!.reasoningContext).toBeUndefined();
  logger.logDecisionSpeech("a", "bounce-pointer", Phase.FORMAT_RESOLVE, { decisionMessage: "Bea, you're safe.", thinking: "Save my ally." });
  expect(logger.publicMessages.map(message => message.text)).toEqual(["Bea, you're safe."]);
  expect(logger.transcript[1]!.thinking).toBe("Save my ally.");
  logger.logDecisionSpeech("a", "format-pick", Phase.FORMAT_PICK, { decisionMessage: "The Short List.", thinking: "Unused" });
  expect(logger.transcript[2]!.thinking).toBeUndefined();
  logger.logDecisionSpeech("a", "bounce-pointer", Phase.FORMAT_RESOLVE, { decisionMessage: "Not model-authored", engineFallback: {} });
  expect(logger.transcript).toHaveLength(3);
});
test("sealed collection runs concurrently, then commits in roster order", async () => {
  const started: string[] = [], committed: string[] = [];
  const releases = new Map<string, () => void>();
  const run = resolveSealedElimRound({ registration: FORMAT_CATALOG.majority_elimination,
    traceAction: "format-majority-elimination-ballot", participants: players,
    collectDecision: async (player, targetId) => {
      started.push(player.id);
      expect(committed).toEqual([]);
      await new Promise<void>(resolve => releases.set(player.id, resolve));
      return { targetId, decision: { message: targetId } };
    },
    recordAcceptedBallot: async ({ ballot }) => { committed.push(ballot.voterId); },
    breakTie: async ids => ({ resolution: { kind: "clear", eliminatedId: ids[0]!, tiedSet: [...ids] }, evidence: null }),
  });
  expect(started).toEqual(["a", "b", "c"]);
  releases.get("c")!(); releases.get("b")!();
  await Promise.resolve();
  expect(committed).toEqual([]);
  releases.get("a")!();
  await run;
  expect(committed).toEqual(["a", "b", "c"]);
});

test("a failed sealed call drains its siblings before the owning turn can exit", async () => {
  const releases = players.map(() => Promise.withResolvers<void>());
  const completed: string[] = [], committed: string[] = [];
  const failure = new Error("Accepted evidence upload failed");
  let exited = false;
  const run = resolveSealedElimRound({ registration: FORMAT_CATALOG.majority_elimination,
    traceAction: "format-majority-elimination-ballot", participants: players,
    collectDecision: async (player, targetId) => {
      await releases[players.indexOf(player)]!.promise;
      if (player.id === "b") throw failure;
      // Represents terminal evidence persistence, which requires the turn's owner.
      expect(exited).toBe(false);
      completed.push(player.id);
      return { targetId, decision: {} };
    },
    recordAcceptedBallot: async ({ ballot }) => { committed.push(ballot.voterId); },
    breakTie: async ids => ({ resolution: { kind: "clear", eliminatedId: ids[0]!, tiedSet: [...ids] }, evidence: null }),
  }).finally(() => { exited = true; });
  const rejected = run.catch(error => error);
  releases[1]!.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(exited).toBe(false);
  releases[2]!.resolve();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(exited).toBe(false);
  releases[0]!.resolve();
  expect(await rejected).toBe(failure);
  expect(completed).toEqual(["c", "a"]);
  expect(committed).toEqual([]);
});

import { MockAgent } from "./mock-agent";
import { GameRunner } from "../game-runner";
import type { PhaseContext } from "../game-runner.types";

class SpeakingAgent extends MockAgent {
  override async getEndgameEliminationVote(...args: Parameters<MockAgent["getEndgameEliminationVote"]>) {
    return { ...await super.getEndgameEliminationVote(...args), thinking: undefined, decisionMessage: "ENDGAME-BALLOT" };
  }
  override async getJuryVote(...args: Parameters<MockAgent["getJuryVote"]>) {
    return { ...await super.getJuryVote(...args), thinking: undefined, decisionMessage: "JURY-BALLOT" };
  }
  override async getVotes(ctx: PhaseContext) {
    expect(ctx.publicMessages.some(message => message.text.includes("BALLOT-LINE"))).toBe(false);
    return { ...await super.getVotes(ctx), thinking: undefined, decisionMessage: "BALLOT-LINE" };
  }
  override async getTwoNamesInitialNames(...args: Parameters<MockAgent["getTwoNamesInitialNames"]>) {
    return { ...await super.getTwoNamesInitialNames(...args), decisionMessage: "I nominate these two." };
  }
  override async getTwoNamesOverride(...args: Parameters<MockAgent["getTwoNamesOverride"]>) {
    return { ...await super.getTwoNamesOverride(...args), decisionMessage: "I decline the veto." };
  }
  override async getTwoNamesBallot(...args: Parameters<MockAgent["getTwoNamesBallot"]>) {
    expect(args[0].publicMessages.some(message => message.text.includes("BALLOT-LINE"))).toBe(false);
    return { ...await super.getTwoNamesBallot(...args), thinking: undefined, decisionMessage: "BALLOT-LINE" };
  }
}
test("a Two Names round records spoken nominations, veto, ballots, and thinking-bearing pleas", async () => {
  const runner = new GameRunner(["A", "B", "C", "D", "E"].map(name => new SpeakingAgent(name, name)),
    { maxRounds: 1, minPlayers: 5, maxPlayers: 12, mingleSessionsPerRound: 1, formatManifest: ["two_names"] },
    undefined, { maxRoundsMode: "exact", random: () => 0 });
  const result = await runner.run();
  const speeches = result.transcript.filter(entry => entry.dialogueContext?.decisionSpeech);
  expect(speeches.filter(entry => entry.dialogueContext?.decisionSpeech?.action === "vote")).toHaveLength(5);
  expect(speeches.filter(entry => entry.dialogueContext?.decisionSpeech?.action === "format-ballot")).toHaveLength(2);
  expect(speeches.find(entry => entry.dialogueContext?.decisionSpeech?.action === "format-two-names-initial-names"))
    .toMatchObject({ scope: "public", text: "I nominate these two.", thinking: expect.any(String) });
  expect(speeches.find(entry => entry.dialogueContext?.decisionSpeech?.action === "format-two-names-override"))
    .toMatchObject({ scope: "public", text: "I decline the veto.", thinking: expect.any(String) });
  expect(result.transcript.filter(entry => entry.scope === "public" && entry.phase === Phase.FORMAT_RESOLVE && !entry.dialogueContext?.decisionSpeech))
    .toEqual(expect.arrayContaining([expect.objectContaining({ thinking: "mock: make a Two Names plea" })]));
  for (const ballot of speeches.filter(entry => entry.scope === "system")) expect(ballot.thinking).toBeUndefined();
});

test("endgame and jury delivery survives the phase event action names", async () => {
  const runner = new GameRunner(["A", "B", "C", "D", "E"].map(name => new SpeakingAgent(name, name)),
    { maxRounds: 20, minPlayers: 5, maxPlayers: 12, mingleSessionsPerRound: 1, formatManifest: ["majority_elimination"] },
    undefined, { random: () => 0 });
  const result = await runner.run();
  const speech = result.transcript.filter(entry => entry.dialogueContext?.decisionSpeech);
  expect(speech.some(entry => entry.text === "ENDGAME-BALLOT" && entry.dialogueContext?.decisionSpeech?.action === "endgame-elimination-vote")).toBe(true);
  expect(speech.some(entry => entry.text === "JURY-BALLOT" && entry.dialogueContext?.decisionSpeech?.action === "jury-vote")).toBe(true);
});
test("ballot speech links to its exact classic receipt", () => {
  const logger = new TranscriptLogger(new GameState(players));
  logger.logSystem("Vote receipt", Phase.VOTE, undefined, undefined, "system_announcement", { voterId: "a", targetId: "b", purpose: "empower" });
  logger.logDecisionSpeech("a", "vote", Phase.VOTE, { decisionMessage: "Bea." }, true);
  expect(logger.transcript[1]!.dialogueContext?.decisionSpeech?.receiptEntrySequence).toBe(logger.transcript[0]!.entrySequence);
  logger.logDecisionSpeech("c", "vote", Phase.VOTE, { decisionMessage: "Ada." }, true);
  expect(logger.transcript[2]!.dialogueContext?.decisionSpeech?.receiptEntrySequence).toBeUndefined();
});


test("new games freeze speech v3 and only unversioned records select historical replay", () => {
  expect(CURRENT_INFLUENCE_DECISION_CONTRACT_VERSION).toBe(3);
  expect(resolveInfluenceDecisionContractVersion(undefined)).toBe(1);
  for (const version of [1, 2, 3] as const) expect(resolveInfluenceDecisionContractVersion(version)).toBe(version);
  for (const value of [null, 0, 4, "2"]) expect(() => resolveInfluenceDecisionContractVersion(value)).toThrow("Unsupported Influence decision contract version");
});

test("new sealed ballots invite one sentence or less without requiring private thinking", () => {
  const tool = withDecisionSpeech({name: "vote", schema: {type: "object", properties: {thinking: {type: "string"}}, required: ["thinking"], additionalProperties: false}}, "vote", 3);
  const contract = JSON.stringify(tool.schema);
  expect(contract).toContain("You are speaking privately to the House. State your vote and briefly explain why, in one sentence or less.");
  expect(contract).not.toContain("No explanation");
  expect(tool.schema.required).toEqual(["message"]);
  expect(validateDecisionSpeech("vote", {message: "A".repeat(200)}, 3)).toBeNull();
  expect(validateDecisionSpeech("vote", {message: "A".repeat(200)}, 2)).toContain("exceeds 120");
  for (const action of ["format-tiebreak", "format-two-names-tiebreak"]) {
    const base = {name: action, schema: {type: "object", properties: {}, required: [], additionalProperties: false}};
    expect(withDecisionSpeech(base, action, 3).schema.required).toEqual(["message", "thinking"]);
    expect(withDecisionSpeech(base, action, 2).schema.required).toEqual(["message"]);
  }
});


test("new root contracts cannot restore with historical decision schemas", async () => {
  const {resolveInfluenceGameDecisionVersion} = await import("../influence-game-schema");
  expect(resolveInfluenceGameDecisionVersion(undefined, undefined)).toBe(1);
  expect(resolveInfluenceGameDecisionVersion(1, 2)).toBe(2);
  expect(resolveInfluenceGameDecisionVersion(2, 3)).toBe(3);
  for (const version of [undefined, 1, 2]) expect(() => resolveInfluenceGameDecisionVersion(2, version)).toThrow("requires decision contract v3");
});


test("historical projections preserve the absent root field and remain restorable", async () => {
  const {GameState} = await import("../game-state");
  const {replayCanonicalEvents} = await import("../game-projection");
  const state = new GameState([{id:"a",name:"A"},{id:"b",name:"B"}], {gameSchemaVersion:2});
  const events = structuredClone(state.getCanonicalEvents());
  expect(replayCanonicalEvents(events).gameSchemaVersion).toBe(2);
  for (const event of events) if (event.type === "game.roster_initialized") delete event.payload.gameSchemaVersion;
  expect(replayCanonicalEvents(events)).not.toHaveProperty("gameSchemaVersion");
  expect(GameState.fromCanonicalEvents(events).gameSchemaVersion).toBe(1);
});
