import { expect, test } from "bun:test";
import { decisionSpeechPolicy, withDecisionSpeech } from "../influence-decision-speech";
import { GameState } from "../game-state";
import { TranscriptLogger } from "../transcript-logger";
import { Phase } from "../types";
import { FORMAT_CATALOG, resolveSealedElimRound } from "../formats";

const players = [{ id: "a", name: "Ada" }, { id: "b", name: "Bea" }, { id: "c", name: "Cam" }];
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
