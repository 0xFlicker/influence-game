import { describe, expect, it } from "bun:test";
import { GameRunner, type GameStreamEvent } from "../game-runner";
import { DEFAULT_CONFIG, Phase, type GameConfig } from "../types";
import { MockAgent, ScriptedHouseInterviewer } from "./mock-agent";

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
    memberNames: ["Alice", "Bob", "Charlie"],
    purpose: "Coordinate the empower vote, then branch under the locked format.",
    timebox: null,
    thinking: "mock: propose a three-person named alliance before Vote",
    strategyDelta: "mock: test named-alliance formation in a complete round",
  });
  bob.allianceActions.push({
    action: "accept",
    lineageId: "glass-table-lineage",
    versionId: "glass-table-v1",
    thinking: "mock: accept the exact Glass Table version",
    strategyDelta: "mock: consent to the same version",
  });
  charlie.allianceActions.push({
    action: "accept",
    lineageId: "glass-table-lineage",
    versionId: "glass-table-v1",
    thinking: "mock: unselected invitee accepts the exact Glass Table version",
    strategyDelta: "mock: consent to the same version without proposer access",
  });

  return [alice, bob, charlie, dana, echo];
}

describe("named alliance complete-round integration", () => {
  it("preserves alliance artifacts through the complete format-kernel standard round", async () => {
    const agents = createAgents();
    const house = new ScriptedHouseInterviewer([{
      selected: [
        { playerId: "bob", rationale: "Bob is underrepresented." },
        { playerId: "alice", rationale: "Alice can create a sharp opening." },
      ],
      rationale: "Use two scarce proposer opportunities for this five-player cast.",
      thinking: "Private House rationale for Alice and Bob.",
    }]);
    const runner = new GameRunner(
      agents,
      TEST_CONFIG,
      house,
      { gameId: "named-alliance-integration" },
    );
    const events: GameStreamEvent[] = [];
    runner.setStreamListener((event) => events.push(event));

    const result = await runner.run();

    const transcriptPhases = new Set(result.transcript.map((entry) => entry.phase));
    const standardRoundPhases = [
      Phase.LOBBY,
      Phase.VOTE,
      Phase.FORMAT_MENU,
      Phase.FORMAT_PICK,
      Phase.FORMAT_MINGLE,
      Phase.FORMAT_RESOLVE,
    ];
    for (const phase of standardRoundPhases) {
      expect(transcriptPhases.has(phase)).toBe(true);
    }
    const firstPhaseIndexes = standardRoundPhases.map((phase) =>
      result.transcript.findIndex((entry) => entry.phase === phase)
    );
    for (let index = 1; index < firstPhaseIndexes.length; index += 1) {
      expect(firstPhaseIndexes[index]).toBeGreaterThan(firstPhaseIndexes[index - 1]!);
    }
    expect(transcriptPhases.has(Phase.POST_VOTE_MINGLE)).toBe(false);
    expect(transcriptPhases.has(Phase.POWER)).toBe(false);
    expect(transcriptPhases.has(Phase.REVEAL)).toBe(false);
    expect(transcriptPhases.has(Phase.PRE_COUNCIL_HUDDLE)).toBe(false);
    expect(transcriptPhases.has(Phase.COUNCIL)).toBe(false);

    const canonicalTypes = runner.getCanonicalEvents().map((event) => event.type);
    expect(
      runner.getCanonicalEvents().some((event) => event.type === "mingle.rooms_allocated" && event.phase === Phase.FORMAT_MINGLE),
    ).toBe(true);
    expect(canonicalTypes).toContain("alliance.proposal_submitted");
    expect(canonicalTypes).toContain("alliance.activated");
    expect(canonicalTypes).toContain("alliance.huddle_scheduled");
    expect(canonicalTypes).toContain("alliance.huddle_completed");
    expect(canonicalTypes).toContain("alliance.huddle_outcome_recorded");
    expect(house.allianceProposerSelectionContexts).toHaveLength(1);
    expect(house.allianceProposerSelectionContexts[0]?.budget).toBe(2);
    expect(agents[0]!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["proposer"]);
    expect(agents[1]!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual([
      "response",
      "proposer",
    ]);
    expect(agents[2]!.allianceOpportunities.map((opportunity) => opportunity.kind)).toEqual(["response"]);
    expect(agents[3]!.allianceOpportunities).toEqual([]);
    expect(agents[4]!.allianceOpportunities).toEqual([]);

    const proposerSelectionTurns = events.filter(
      (event): event is Extract<GameStreamEvent, { type: "agent_turn" }> =>
        event.type === "agent_turn" && event.action === "alliance-proposer-selection",
    );
    expect(proposerSelectionTurns).toHaveLength(1);
    expect(proposerSelectionTurns[0]).toMatchObject({
      visibility: "private",
      actor: { name: "The House", role: "house" },
      response: {
        budget: 2,
        rationale: "Use two scarce proposer opportunities for this five-player cast.",
      },
    });

    const formatMingleRoomSpeechIndex = events.findIndex(
      (event) => event.type === "transcript_entry" && event.entry.phase === Phase.FORMAT_MINGLE && event.entry.scope === "mingle",
    );
    const formatMingleAllianceActionIndex = events.findIndex(
      (event) => event.type === "agent_turn" && event.phase === Phase.FORMAT_MINGLE && event.action === "alliance-action",
    );
    expect(formatMingleRoomSpeechIndex).toBeGreaterThanOrEqual(0);
    expect(formatMingleAllianceActionIndex).toBeGreaterThan(formatMingleRoomSpeechIndex);

    const huddleOutcomes = events.filter(
      (event): event is Extract<GameStreamEvent, { type: "agent_turn" }> =>
        event.type === "agent_turn" && event.action === "alliance-huddle-outcome" && event.round === 1,
    );
    expect(huddleOutcomes.length).toBeGreaterThanOrEqual(1);
    expect(huddleOutcomes.every((event) => event.phase === Phase.FORMAT_MINGLE)).toBe(true);

    const huddleSpeech = result.transcript.filter((entry) => entry.scope === "huddle" && entry.round === 1);
    expect(huddleSpeech.length).toBeGreaterThanOrEqual(2);
    expect(huddleSpeech.every((entry) => entry.phase === Phase.FORMAT_MINGLE)).toBe(true);

    expect(result.transcript.some((entry) => entry.phase === Phase.VOTE && entry.text.includes("votes:"))).toBe(true);
    expect(result.transcript.some((entry) => entry.phase === Phase.FORMAT_MINGLE && entry.scope === "mingle")).toBe(true);
    expect(
      events.some(
        (event) =>
          event.type === "agent_turn"
          && ["format-pick", "format-ballot", "bounce-pointer", "format-tiebreak"].includes(event.action),
      ),
    ).toBe(true);
  });
});
