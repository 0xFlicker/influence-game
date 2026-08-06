import { describe, expect, it } from "bun:test";
import { GameState } from "../game-state";
import { Phase } from "../types";

const PLAYERS = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
  { id: "charlie", name: "Charlie" },
  { id: "dana", name: "Dana" },
];

function createStartedGame(): GameState {
  const gs = new GameState(PLAYERS, {
    gameId: "game-named-alliances",
    now: () => 1_700_000_000_000,
  });
  gs.startRound();
  return gs;
}

describe("named alliance state", () => {
  it("activates only when every invited live member accepts the same proposal version", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-abc",
      lineageId: "lineage-abc",
      versionId: "version-1",
      proposerId: "alice",
      name: "Glass Table",
      memberIds: ["alice", "bob", "charlie"],
      purpose: "Coordinate the first expose vote.",
      timebox: "through council",
    });

    expect(gs.getAlliance("alliance-abc")).toBeUndefined();

    gs.recordAllianceResponse({
      lineageId: "lineage-abc",
      versionId: "version-1",
      playerId: "bob",
      response: "accepted",
    });

    expect(gs.getAlliance("alliance-abc")).toBeUndefined();

    gs.recordAllianceResponse({
      lineageId: "lineage-abc",
      versionId: "version-1",
      playerId: "charlie",
      response: "accepted",
    });

    expect(gs.getAlliance("alliance-abc")).toMatchObject({
      id: "alliance-abc",
      name: "Glass Table",
      memberIds: ["alice", "bob", "charlie"],
      status: "active",
    });
  });

  it("does not carry old acceptances onto changed terms", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-reset",
      lineageId: "lineage-reset",
      versionId: "version-1",
      proposerId: "alice",
      name: "Glass Table",
      memberIds: ["alice", "bob", "charlie"],
      purpose: "Coordinate the first expose vote.",
      timebox: "through council",
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-reset",
      versionId: "version-1",
      playerId: "bob",
      response: "accepted",
    });

    gs.recordAllianceCounter({
      lineageId: "lineage-reset",
      versionId: "version-2",
      proposerId: "charlie",
      name: "Glass Table",
      memberIds: ["alice", "bob", "charlie"],
      purpose: "Coordinate empower and expose votes together.",
      timebox: "through vote",
    });

    expect(gs.getAlliance("alliance-reset")).toBeUndefined();

    gs.recordAllianceResponse({
      lineageId: "lineage-reset",
      versionId: "version-2",
      playerId: "bob",
      response: "accepted",
    });

    expect(gs.getAlliance("alliance-reset")).toBeUndefined();

    gs.recordAllianceResponse({
      lineageId: "lineage-reset",
      versionId: "version-2",
      playerId: "alice",
      response: "accepted",
    });

    expect(gs.getAlliance("alliance-reset")).toMatchObject({
      purpose: "Coordinate empower and expose votes together.",
      status: "active",
    });
  });

  it("rejects a third counter while leaving the current proposal version open", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-cap",
      lineageId: "lineage-cap",
      versionId: "version-1",
      proposerId: "alice",
      name: "Cap Test",
      memberIds: ["alice", "bob"],
      purpose: "Initial terms.",
      timebox: null,
    });
    gs.recordAllianceCounter({
      lineageId: "lineage-cap",
      versionId: "version-2",
      proposerId: "bob",
      name: "Cap Test",
      memberIds: ["alice", "bob"],
      purpose: "First counter.",
      timebox: null,
    });
    gs.recordAllianceCounter({
      lineageId: "lineage-cap",
      versionId: "version-3",
      proposerId: "alice",
      name: "Cap Test",
      memberIds: ["alice", "bob"],
      purpose: "Second counter.",
      timebox: null,
    });

    const rejected = gs.recordAllianceCounter({
      lineageId: "lineage-cap",
      versionId: "version-4",
      proposerId: "bob",
      name: "Cap Test",
      memberIds: ["alice", "bob"],
      purpose: "Third counter.",
      timebox: null,
    });

    const lineage = gs.getAllianceProposalLineage("lineage-cap");
    expect(rejected).toBeNull();
    expect(lineage?.currentVersionId).toBe("version-3");
    expect(lineage?.versions.map((version) => version.versionId)).toEqual([
      "version-1",
      "version-2",
      "version-3",
    ]);
  });

  it("rejects counters from players who are not invited to the current version", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-counter-invite",
      lineageId: "lineage-counter-invite",
      versionId: "version-counter-invite",
      proposerId: "alice",
      name: "Counter Invite",
      memberIds: ["alice", "bob"],
      purpose: "Pair terms.",
      timebox: null,
    });

    expect(() => gs.recordAllianceCounter({
      lineageId: "lineage-counter-invite",
      versionId: "version-counter-outsider",
      proposerId: "charlie",
      name: "Counter Outsider",
      memberIds: ["alice", "charlie"],
      purpose: "Charlie tries to hijack the proposal.",
      timebox: null,
    })).toThrow("not invited to the current version");
  });

  it("allows overlapping active alliance membership", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      proposerId: "alice",
      name: "Alice Bob",
      memberIds: ["alice", "bob"],
      purpose: "Pair vote cover.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: "version-ab",
      playerId: "bob",
      response: "accepted",
    });

    gs.recordAllianceProposal({
      allianceId: "alliance-ac",
      lineageId: "lineage-ac",
      versionId: "version-ac",
      proposerId: "alice",
      name: "Alice Charlie",
      memberIds: ["alice", "charlie"],
      purpose: "Second vote lane.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-ac",
      versionId: "version-ac",
      playerId: "charlie",
      response: "accepted",
    });

    const aliceAlliances = gs
      .getAllianceRecords()
      .filter((alliance) => alliance.status === "active" && alliance.memberIds.includes("alice"));

    expect(aliceAlliances.map((alliance) => alliance.id)).toEqual(["alliance-ab", "alliance-ac"]);
  });

  it("rejects duplicate active rosters through counters and amendments", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-ab",
      lineageId: "lineage-ab",
      versionId: "version-ab",
      proposerId: "alice",
      name: "Alice Bob",
      memberIds: ["alice", "bob"],
      purpose: "Pair vote cover.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-ab",
      versionId: "version-ab",
      playerId: "bob",
      response: "accepted",
    });

    gs.recordAllianceProposal({
      allianceId: "alliance-ac",
      lineageId: "lineage-ac",
      versionId: "version-ac",
      proposerId: "alice",
      name: "Alice Charlie",
      memberIds: ["alice", "charlie"],
      purpose: "Second vote lane.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-ac",
      versionId: "version-ac",
      playerId: "charlie",
      response: "accepted",
    });

    gs.recordAllianceProposal({
      allianceId: "alliance-bc-open",
      lineageId: "lineage-bc-open",
      versionId: "version-bc-open",
      proposerId: "bob",
      name: "Bob Charlie",
      memberIds: ["bob", "charlie"],
      purpose: "Open counterable terms.",
      timebox: null,
    });

    expect(() => gs.recordAllianceCounter({
      lineageId: "lineage-bc-open",
      versionId: "version-duplicate-counter",
      proposerId: "bob",
      name: "Alice Bob Duplicate",
      memberIds: ["alice", "bob"],
      purpose: "Duplicate the active Alice/Bob pair.",
      timebox: null,
    })).toThrow("same member roster");

    expect(() => gs.recordAllianceAmendment({
      allianceId: "alliance-ac",
      lineageId: "lineage-duplicate-amend",
      versionId: "version-duplicate-amend",
      proposerId: "alice",
      name: "Alice Bob Duplicate",
      memberIds: ["alice", "bob"],
      purpose: "Duplicate the active Alice/Bob pair.",
      timebox: null,
    })).toThrow("same member roster");
  });

  it("closes universal alliances before they become huddle eligible", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-everyone",
      lineageId: "lineage-everyone",
      versionId: "version-everyone",
      proposerId: "alice",
      name: "Everyone",
      memberIds: ["alice", "bob", "charlie", "dana"],
      purpose: "Pretend the whole house is united.",
      timebox: null,
    });
    for (const playerId of ["bob", "charlie", "dana"]) {
      gs.recordAllianceResponse({
        lineageId: "lineage-everyone",
        versionId: "version-everyone",
        playerId,
        response: "accepted",
      });
    }

    const closedIds = gs.closeUniversalAlliancesBeforeMingle();

    expect(closedIds).toEqual(["alliance-everyone"]);
    expect(gs.getAlliance("alliance-everyone")).toMatchObject({
      status: "closed",
      closedReason: "universal_all_alive_before_mingle",
    });
    expect(gs.getHuddleEligibleAlliances().map((alliance) => alliance.id)).not.toContain("alliance-everyone");
  });

  it("closes alliances whose living members equal all alive players after eliminations", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-historical-everyone",
      lineageId: "lineage-historical-everyone",
      versionId: "version-historical-everyone",
      proposerId: "alice",
      name: "Historical Everyone",
      memberIds: ["alice", "bob", "charlie", "dana"],
      purpose: "Started as the whole house.",
      timebox: null,
    });
    for (const playerId of ["bob", "charlie", "dana"]) {
      gs.recordAllianceResponse({
        lineageId: "lineage-historical-everyone",
        versionId: "version-historical-everyone",
        playerId,
        response: "accepted",
      });
    }

    gs.eliminatePlayer("dana");

    expect(gs.getAlliance("alliance-historical-everyone")).toMatchObject({ status: "active" });
    expect(gs.closeUniversalAlliancesBeforeMingle()).toEqual(["alliance-historical-everyone"]);
    expect(gs.getAlliance("alliance-historical-everyone")).toMatchObject({
      status: "closed",
      closedReason: "universal_all_alive_before_mingle",
    });
  });

  it("treats trial consent as activation with the accepted timebox", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-trial",
      lineageId: "lineage-trial",
      versionId: "version-trial",
      proposerId: "alice",
      name: "Trial Run",
      memberIds: ["alice", "bob"],
      purpose: "Test a one-window pact.",
      timebox: "through the pre-vote huddle",
    });

    gs.recordAllianceResponse({
      lineageId: "lineage-trial",
      versionId: "version-trial",
      playerId: "bob",
      response: "trial",
    });

    expect(gs.getAlliance("alliance-trial")).toMatchObject({
      status: "active",
      timebox: "through the pre-vote huddle",
    });
  });

  it("amends active alliances only after current and newly invited members consent", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-amend",
      lineageId: "lineage-amend-original",
      versionId: "version-amend-original",
      proposerId: "alice",
      name: "Original Pair",
      memberIds: ["alice", "bob"],
      purpose: "Initial pair.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-amend-original",
      versionId: "version-amend-original",
      playerId: "bob",
      response: "accepted",
    });

    gs.recordAllianceAmendment({
      allianceId: "alliance-amend",
      lineageId: "lineage-amend-expanded",
      versionId: "version-amend-expanded",
      proposerId: "alice",
      name: "Expanded Trio",
      memberIds: ["alice", "bob", "charlie"],
      purpose: "Bring Charlie into the vote plan.",
      timebox: "through council",
    });

    expect(gs.getAlliance("alliance-amend")).toMatchObject({
      name: "Original Pair",
      memberIds: ["alice", "bob"],
    });

    gs.recordAllianceResponse({
      lineageId: "lineage-amend-expanded",
      versionId: "version-amend-expanded",
      playerId: "bob",
      response: "accepted",
    });
    expect(gs.getAlliance("alliance-amend")).toMatchObject({ name: "Original Pair" });

    gs.recordAllianceResponse({
      lineageId: "lineage-amend-expanded",
      versionId: "version-amend-expanded",
      playerId: "charlie",
      response: "accepted",
    });

    expect(gs.getAlliance("alliance-amend")).toMatchObject({
      name: "Expanded Trio",
      memberIds: ["alice", "bob", "charlie"],
      purpose: "Bring Charlie into the vote plan.",
      timebox: "through council",
      lineageIds: ["lineage-amend-original", "lineage-amend-expanded"],
    });
    expect(gs.getCanonicalEvents().map((event) => event.type)).toContain("alliance.amendment_resolved");
  });

  it("archives alliances with fewer than two live members after elimination refresh", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-pair",
      lineageId: "lineage-pair",
      versionId: "version-pair",
      proposerId: "alice",
      name: "Pair Deal",
      memberIds: ["alice", "bob"],
      purpose: "Vote together.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-pair",
      versionId: "version-pair",
      playerId: "bob",
      response: "accepted",
    });

    gs.eliminatePlayer("bob");

    expect(gs.getAlliance("alliance-pair")).toMatchObject({
      status: "archived",
      archivedReason: "fewer_than_two_live_members",
    });
  });

  it("replays alliance records from canonical events", () => {
    const gs = createStartedGame();

    gs.recordAllianceProposal({
      allianceId: "alliance-replay",
      lineageId: "lineage-replay",
      versionId: "version-replay",
      proposerId: "alice",
      name: "Replay Deal",
      memberIds: ["alice", "bob"],
      purpose: "Prove canonical rebuild.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-replay",
      versionId: "version-replay",
      playerId: "bob",
      response: "accepted",
    });

    const restored = GameState.fromCanonicalEvents(gs.getCanonicalEvents());

    expect(restored.getAllianceRecords()).toEqual(gs.getAllianceRecords());
    expect(restored.getDomainProjection().alliances).toEqual(gs.getDomainProjection().alliances);
  });

  it("rejects alliance mutation outside the post-format Mingle action window", () => {
    const gs = createStartedGame();

    const illegalPhases = [
      Phase.MINGLE,
      Phase.POST_VOTE_MINGLE,
      Phase.PRE_VOTE_HUDDLE,
      Phase.PRE_COUNCIL_HUDDLE,
      Phase.POWER,
      Phase.COUNCIL,
      Phase.VOTE,
    ];

    for (const [index, phase] of illegalPhases.entries()) {
      expect(() =>
        gs.recordAllianceProposal(
          {
            allianceId: `alliance-illegal-${index}`,
            lineageId: `lineage-illegal-${index}`,
            versionId: `version-illegal-${index}`,
            proposerId: "alice",
            name: "Too Late",
            memberIds: ["alice", "bob"],
            purpose: "Mutate outside the post-format action window.",
            timebox: null,
          },
          { phase },
        ),
      ).toThrow("Alliance mutations are only legal during the post-format Mingle alliance window");
    }
  });

  it("copies session participant snapshot and bounds overlong huddle outcomes at record time", () => {
    const gs = createStartedGame();
    gs.recordAllianceProposal({
      allianceId: "alliance-bound",
      lineageId: "lineage-bound",
      versionId: "version-bound",
      proposerId: "alice",
      name: "Bound Deal",
      memberIds: ["alice", "bob"],
      purpose: "Test compact limits.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-bound",
      versionId: "version-bound",
      playerId: "bob",
      response: "accepted",
    });
    gs.recordAllianceHuddleCompleted({
      id: "session-bound",
      scheduleId: "schedule-bound",
      allianceId: "alliance-bound",
      window: "pre_vote",
      round: gs.round,
      pass: 1,
      speakerIds: ["alice", "bob"],
      completedAt: "2026-07-03T00:00:00.000Z",
    });

    const longPlan = "P".repeat(800);
    const longPromises = Array.from({ length: 12 }, (_, i) => `promise-${i}-${"x".repeat(200)}`);
    gs.recordAllianceHuddleOutcome({
      id: "outcome-bound",
      sessionId: "session-bound",
      allianceId: "alliance-bound",
      window: "pre_vote",
      round: gs.round,
      ask: "A".repeat(400),
      plan: longPlan,
      promises: longPromises,
      dissent: [],
      confidence: "high",
      posture: "coordinating-with-extra-detail-that-should-be-clipped-for-compact-memory",
      leakOrBetrayalClaims: [],
      // Omitted participantPlayerIds — must backfill from session speakers.
      createdAt: "2026-07-03T00:00:01.000Z",
    });

    const outcome = gs.getAllianceHuddleOutcomes()[0];
    expect(outcome?.participantPlayerIds).toEqual(["alice", "bob"]);
    expect(outcome?.ask.length).toBeLessThanOrEqual(200);
    expect(outcome?.plan.length).toBeLessThanOrEqual(400);
    expect(outcome?.posture.length).toBeLessThanOrEqual(80);
    expect(outcome?.promises).toHaveLength(6);
    expect(outcome?.promises.every((item) => item.length <= 160)).toBe(true);
  });

  it("hydrates participant snapshots from matching completed sessions during canonical replay", () => {
    const gs = createStartedGame();
    gs.recordAllianceProposal({
      allianceId: "alliance-hydrate",
      lineageId: "lineage-hydrate",
      versionId: "version-hydrate",
      proposerId: "alice",
      name: "Hydrate Deal",
      memberIds: ["alice", "bob"],
      purpose: "Replay participant snapshot.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-hydrate",
      versionId: "version-hydrate",
      playerId: "bob",
      response: "accepted",
    });
    gs.recordAllianceHuddleCompleted({
      id: "session-hydrate",
      scheduleId: "schedule-hydrate",
      allianceId: "alliance-hydrate",
      window: "pre_vote",
      round: gs.round,
      pass: 1,
      speakerIds: ["alice", "bob"],
      completedAt: "2026-07-03T00:00:00.000Z",
    });
    gs.recordAllianceHuddleOutcome({
      id: "outcome-hydrate",
      sessionId: "session-hydrate",
      allianceId: "alliance-hydrate",
      window: "pre_vote",
      round: gs.round,
      ask: "Hold.",
      plan: "Coordinate.",
      promises: [],
      dissent: [],
      confidence: "medium",
      posture: "guarded",
      leakOrBetrayalClaims: [],
      participantPlayerIds: ["alice", "bob"],
      createdAt: "2026-07-03T00:00:01.000Z",
    });

    const replayed = GameState.fromCanonicalEvents(gs.getCanonicalEvents(), {
      now: () => 1_700_000_000_000,
    });
    expect(replayed.getAllianceHuddleOutcomes()[0]?.participantPlayerIds).toEqual(["alice", "bob"]);

    // Legacy event body without snapshot still recovers from the matching session.
    const events = gs.getCanonicalEvents().map((event) => {
      if (event.type !== "alliance.huddle_outcome_recorded") return event;
      const { participantPlayerIds: _drop, ...outcomeWithoutSnapshot } = event.payload.outcome;
      return {
        ...event,
        payload: {
          ...event.payload,
          outcome: outcomeWithoutSnapshot,
        },
      };
    });
    const legacyReplayed = GameState.fromCanonicalEvents(events, {
      now: () => 1_700_000_000_000,
    });
    expect(legacyReplayed.getAllianceHuddleOutcomes()[0]?.participantPlayerIds).toEqual(["alice", "bob"]);
  });

  it("does not invent participant snapshots without a matching completed session", () => {
    const gs = createStartedGame();
    gs.recordAllianceProposal({
      allianceId: "alliance-orphan",
      lineageId: "lineage-orphan",
      versionId: "version-orphan",
      proposerId: "alice",
      name: "Orphan Deal",
      memberIds: ["alice", "bob"],
      purpose: "No session.",
      timebox: null,
    });
    gs.recordAllianceResponse({
      lineageId: "lineage-orphan",
      versionId: "version-orphan",
      playerId: "bob",
      response: "accepted",
    });
    gs.recordAllianceHuddleOutcome({
      id: "outcome-orphan",
      sessionId: "session-missing",
      allianceId: "alliance-orphan",
      window: "pre_vote",
      round: gs.round,
      ask: "Orphan.",
      plan: "No speakers.",
      promises: [],
      dissent: [],
      confidence: "low",
      posture: "guarded",
      leakOrBetrayalClaims: [],
      createdAt: "2026-07-03T00:00:01.000Z",
    });

    const outcome = gs.getAllianceHuddleOutcomes()[0];
    expect(outcome?.participantPlayerIds).toBeUndefined();
  });
});
