import { describe, expect, it } from "bun:test";
import { GameRunner, type GameStreamEvent } from "../game-runner";
import { TemplateHouseInterviewer } from "../house-interviewer";
import { DEFAULT_CONFIG, Phase, type GameConfig } from "../types";
import { MockAgent } from "./mock-agent";

const TEST_CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  timers: {
    introduction: 0,
    lobby: 0,
    mingle: 0,
    rumor: 0,
    vote: 0,
    power: 0,
    council: 0,
  },
  maxRounds: 1,
  minPlayers: 5,
  maxPlayers: 5,
  mingleSessionsPerRound: 1,
  diaryRoomAfterPhases: [],
  maxDiaryFollowUps: 0,
};

function createAgents() {
  const alice = new MockAgent("alice", "Alice");
  const bob = new MockAgent("bob", "Bob");
  const charlie = new MockAgent("charlie", "Charlie");
  const dana = new MockAgent("dana", "Dana");
  const echo = new MockAgent("echo", "Echo");

  alice.allianceActions.push({
    action: "propose",
    allianceId: "glass-table",
    lineageId: "glass-table-lineage",
    versionId: "glass-table-v1",
    name: "Glass Table",
    memberNames: ["Alice", "Bob"],
    purpose: "Coordinate a simple vote plan, then compare fallout before Council.",
    timebox: null,
    thinking: "mock: propose a two-person named alliance before Vote",
    decisionLog: "mock: test named-alliance formation in a complete round",
  });
  bob.allianceActions.push({
    action: "accept",
    lineageId: "glass-table-lineage",
    versionId: "glass-table-v1",
    thinking: "mock: accept the exact Glass Table version",
    decisionLog: "mock: consent to the same version",
  });

  return [alice, bob, charlie, dana, echo];
}

describe("named alliance complete-round integration", () => {
  it("forms an alliance, huddles before Vote and Council, and preserves post-vote Mingle fallout", async () => {
    const runner = new GameRunner(
      createAgents(),
      TEST_CONFIG,
      new TemplateHouseInterviewer(),
      { gameId: "named-alliance-integration" },
    );
    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    const result = await runner.run();

    const transcriptPhases = new Set(result.transcript.map((entry) => entry.phase));
    expect(transcriptPhases.has(Phase.MINGLE_I)).toBe(true);
    expect(transcriptPhases.has(Phase.PRE_VOTE_HUDDLE)).toBe(true);
    expect(transcriptPhases.has(Phase.VOTE)).toBe(true);
    expect(transcriptPhases.has(Phase.POST_VOTE_MINGLE)).toBe(true);
    expect(transcriptPhases.has(Phase.POWER)).toBe(true);
    expect(transcriptPhases.has(Phase.REVEAL)).toBe(true);
    expect(transcriptPhases.has(Phase.PRE_COUNCIL_HUDDLE)).toBe(true);
    expect(transcriptPhases.has(Phase.COUNCIL)).toBe(true);

    const canonicalTypes = runner.getCanonicalEvents().map((event) => event.type);
    expect(
      runner.getCanonicalEvents().some((event) => event.type === "mingle.rooms_allocated" && event.phase === Phase.MINGLE_I),
    ).toBe(true);
    expect(canonicalTypes).toContain("alliance.proposal_submitted");
    expect(canonicalTypes).toContain("alliance.activated");
    expect(canonicalTypes.filter((type) => type === "alliance.huddle_outcome_recorded").length).toBeGreaterThanOrEqual(2);

    const mingleIRoomSpeechIndex = events.findIndex(
      (event) => event.type === "transcript_entry" && event.entry.phase === Phase.MINGLE_I && event.entry.scope === "mingle",
    );
    const mingleIAllianceActionIndex = events.findIndex(
      (event) => event.type === "agent_turn" && event.phase === Phase.MINGLE_I && event.action === "alliance-action",
    );
    expect(mingleIRoomSpeechIndex).toBeGreaterThanOrEqual(0);
    expect(mingleIAllianceActionIndex).toBeGreaterThan(mingleIRoomSpeechIndex);

    const huddleOutcomes = events.filter(
      (event): event is Extract<GameStreamEvent, { type: "agent_turn" }> =>
        event.type === "agent_turn" && event.action === "alliance-huddle-outcome" && event.round === 1,
    );
    expect(huddleOutcomes.map((event) => event.phase)).toEqual([
      Phase.PRE_VOTE_HUDDLE,
      Phase.PRE_COUNCIL_HUDDLE,
    ]);

    const huddleSpeech = result.transcript.filter((entry) => entry.scope === "huddle" && entry.round === 1);
    expect(huddleSpeech.map((entry) => entry.phase)).toEqual([
      Phase.PRE_VOTE_HUDDLE,
      Phase.PRE_VOTE_HUDDLE,
      Phase.PRE_COUNCIL_HUDDLE,
      Phase.PRE_COUNCIL_HUDDLE,
    ]);

    expect(result.transcript.some((entry) => entry.phase === Phase.VOTE && entry.text.includes("votes:"))).toBe(true);
    expect(result.transcript.some((entry) => entry.phase === Phase.POST_VOTE_MINGLE && entry.scope === "mingle")).toBe(true);
  });
});
