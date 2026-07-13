import { describe, expect, it } from "bun:test";
import type { GameDetail, PublicGameAlliancesResponse } from "../lib/api";
import {
  buildCompletedAllianceArcsModel,
  buildMatchWatchAlliancePanelModel,
} from "../app/games/[slug]/components/match-watch-alliance-model";
import { buildMatchWatchModel } from "../app/games/[slug]/components/match-watch-model";

function game(): GameDetail {
  return {
    id: "game-1",
    slug: "public-game",
    status: "in_progress",
    currentRound: 2,
    maxRounds: 8,
    currentPhase: "MINGLE",
    players: [
      { id: "p1", name: "Marnie", persona: "strategic", status: "alive", shielded: false, avatarUrl: "https://cdn.example/marnie.png" },
      { id: "p2", name: "Jace", persona: "deceptive", status: "alive", shielded: false },
      { id: "p3", name: "Echo", persona: "observer", status: "alive", shielded: false },
      { id: "p4", name: "Sol", persona: "diplomat", status: "alive", shielded: false },
    ],
    modelTier: "standard",
    visibility: "public",
    viewerMode: "live",
    createdAt: "2026-07-03T00:00:00.000Z",
  };
}

function alliances(): PublicGameAlliancesResponse {
  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: "game-1",
      slug: "public-game",
      status: "in_progress",
      createdAt: "2026-07-03T00:00:00.000Z",
    },
    players: [
      { id: "p1", name: "Marnie" },
      { id: "p2", name: "Jace" },
      { id: "p3", name: "Echo" },
      { id: "p4", name: "Sol" },
    ],
    allianceFacts: {
      summary: {
        proposalCount: 3,
        activeAllianceCount: 2,
        closedAllianceCount: 0,
        archivedAllianceCount: 0,
        huddleCount: 2,
        latestHuddleRound: 2,
      },
      proposals: [
        {
          lineageId: "lineage-1",
          allianceId: "a1",
          name: "Mirror Knives",
          status: "accepted",
          proposedRound: 1,
          proposedPhase: "MINGLE_I",
          resolvedRound: 1,
          resolvedPhase: "MINGLE_I",
          memberNames: ["Marnie", "Jace"],
          currentVersionId: "v1",
          currentTerms: {
            name: "Mirror Knives",
            memberIds: ["p1", "p2"],
            memberNames: ["Marnie", "Jace"],
            purpose: "Trade cover while each tests the room.",
            timebox: "through council",
          },
          proposer: { id: "p1", name: "Marnie" },
          responses: [
            { player: { id: "p1", name: "Marnie" }, response: "accepted" },
            { player: { id: "p2", name: "Jace" }, response: "accepted" },
          ],
          finalResult: "accepted",
        },
        {
          lineageId: "lineage-2",
          allianceId: "a2",
          name: "Back Row Pact",
          status: "accepted",
          proposedRound: 1,
          proposedPhase: "MINGLE_I",
          resolvedRound: 1,
          resolvedPhase: "MINGLE_I",
          memberNames: ["Marnie", "Jace", "Echo"],
          currentVersionId: "v1",
          currentTerms: {
            name: "Back Row Pact",
            memberIds: ["p1", "p2", "p3"],
            memberNames: ["Marnie", "Jace", "Echo"],
            purpose: "Layer the pair inside a voting pod.",
            timebox: null,
          },
          proposer: { id: "p3", name: "Echo" },
          responses: [
            { player: { id: "p1", name: "Marnie" }, response: "accepted" },
            { player: { id: "p2", name: "Jace" }, response: "accepted" },
            { player: { id: "p3", name: "Echo" }, response: "accepted" },
          ],
          finalResult: "accepted",
        },
        {
          lineageId: "lineage-3",
          allianceId: "a3",
          name: "The Smoke Test",
          status: "expired",
          proposedRound: 1,
          proposedPhase: "MINGLE_I",
          resolvedRound: 1,
          resolvedPhase: "PRE_VOTE_HUDDLE",
          memberNames: ["Echo", "Sol"],
          currentVersionId: "v1",
          currentTerms: {
            name: "The Smoke Test",
            memberIds: ["p3", "p4"],
            memberNames: ["Echo", "Sol"],
            purpose: "Probe whether the quiet players can coordinate.",
            timebox: null,
          },
          proposer: { id: "p4", name: "Sol" },
          responses: [
            { player: { id: "p3", name: "Echo" }, response: "countered" },
          ],
          finalResult: "expired",
        },
      ],
      alliances: [
        {
          id: "a1",
          name: "Mirror Knives",
          status: "active",
          memberIds: ["p1", "p2"],
          memberNames: ["Marnie", "Jace"],
          purpose: "Trade cover while each tests the room.",
          timebox: "through council",
          createdRound: 1,
          createdPhase: "MINGLE_I",
          updatedRound: 2,
          updatedPhase: "PRE_VOTE_HUDDLE",
          huddleOutcomeCount: 1,
          consequences: [{
            type: "alliance_member_cut",
            round: 2,
            description: "Jace helped eliminate alliance member Marnie after sharing Mirror Knives.",
            confidence: "high",
            playerNames: ["Marnie", "Jace"],
          }],
          latestOutcome: {
            id: "o1",
            round: 2,
            window: "pre_vote",
            ask: "Keep pressure off Marnie.",
            plan: "Vote together unless Echo flips.",
            promises: ["Jace shields Marnie publicly."],
            dissent: [],
            confidence: "medium",
            posture: "coordinated",
            leakOrBetrayalClaims: [],
          },
        },
        {
          id: "a2",
          name: "Back Row Pact",
          status: "active",
          memberIds: ["p1", "p2", "p3"],
          memberNames: ["Marnie", "Jace", "Echo"],
          purpose: "Layer the pair inside a voting pod.",
          timebox: null,
          createdRound: 1,
          createdPhase: "MINGLE_I",
          updatedRound: 1,
          updatedPhase: "MINGLE_I",
          huddleOutcomeCount: 0,
          consequences: [],
        },
      ],
      huddles: [
        {
          allianceId: "a1",
          allianceName: "Mirror Knives",
          round: 2,
          phase: "PRE_VOTE_HUDDLE",
          window: "pre_vote",
          pass: 1,
          speakers: [
            { id: "p1", name: "Marnie" },
            { id: "p2", name: "Jace" },
          ],
          messages: [
            { from: { id: "p1", name: "Marnie" }, text: "Jace, keep the heat on Echo.", timestamp: 200 },
            { from: { id: "p2", name: "Jace" }, text: "I can do that, but do not overplay it.", timestamp: 201 },
          ],
          outcome: {
            id: "o1",
            round: 2,
            window: "pre_vote",
            ask: "Keep pressure off Marnie.",
            plan: "Vote together unless Echo flips.",
            promises: ["Jace shields Marnie publicly."],
            dissent: [],
            confidence: "medium",
            posture: "coordinated",
            leakOrBetrayalClaims: [],
          },
        },
        {
          allianceId: "a2",
          allianceName: "Back Row Pact",
          round: 1,
          phase: "PRE_VOTE_HUDDLE",
          window: "pre_vote",
          pass: 1,
          speakers: [
            { id: "p1", name: "Marnie" },
            { id: "p2", name: "Jace" },
            { id: "p3", name: "Echo" },
          ],
          messages: [
            { from: { id: "p3", name: "Echo" }, text: "Let the pair look louder than the pod.", timestamp: 100 },
          ],
        },
      ],
    },
    availability: {
      status: "available",
      eventLogStatus: "complete",
      transcriptStatus: "available",
      diagnostics: [],
    },
  };
}

describe("match watch alliance model", () => {
  it("builds a selected-player alliance panel with layered alliances and huddle transcripts", () => {
    const watchModel = buildMatchWatchModel({
      game: game(),
      messages: [],
      live: true,
      connStatus: "live",
      selectedPlayerId: "p1",
    });

    const model = buildMatchWatchAlliancePanelModel({
      model: watchModel,
      allianceState: { loadState: "ready", facts: alliances() },
    });

    expect(model.status).toBe("ready");
    expect(model.summary).toEqual({
      proposalCount: 2,
      allianceCount: 2,
      huddleCount: 2,
      latestHuddleRound: 2,
    });
    expect(model.cards.map((card) => card.name)).toEqual(["Mirror Knives", "Back Row Pact"]);
    expect(model.cards[0]?.memberNames).toEqual(["Marnie", "Jace"]);
    expect(model.cards[1]?.memberNames).toEqual(["Marnie", "Jace", "Echo"]);
    expect(model.cards[0]?.latestOutcomeSummary).toContain("Vote together unless Echo flips.");
    expect(model.cards[0]?.consequences).toEqual([]);
    expect(model.cards[0]?.huddles[0]?.messages.map((message) => message.text)).toEqual([
      "Jace, keep the heat on Echo.",
      "I can do that, but do not overplay it.",
    ]);
    expect(JSON.stringify(model)).not.toContain("thinking");
  });

  it("time-slices the replay alliance inspector to the current round", () => {
    const facts = alliances();
    const mirrorKnives = facts.allianceFacts.alliances.find((alliance) => alliance.id === "a1");
    if (mirrorKnives) {
      mirrorKnives.status = "archived";
      mirrorKnives.updatedRound = 2;
    }
    facts.allianceFacts.proposals.push({
      lineageId: "lineage-4",
      allianceId: "a4",
      name: "Final Six Fire Drill",
      status: "accepted",
      proposedRound: 6,
      resolvedRound: 6,
      memberNames: ["Marnie", "Jace"],
      currentVersionId: "v1",
      currentTerms: {
        name: "Final Six Fire Drill",
        memberIds: ["p1", "p2"],
        memberNames: ["Marnie", "Jace"],
        purpose: "A late-game voting cover story.",
        timebox: null,
      },
      proposer: { id: "p2", name: "Jace" },
      responses: [
        { player: { id: "p1", name: "Marnie" }, response: "accepted" },
        { player: { id: "p2", name: "Jace" }, response: "accepted" },
      ],
      finalResult: "accepted",
    });
    facts.allianceFacts.alliances.push({
      id: "a4",
      name: "Final Six Fire Drill",
      status: "active",
      memberIds: ["p1", "p2"],
      memberNames: ["Marnie", "Jace"],
      purpose: "A late-game voting cover story.",
      timebox: null,
      createdRound: 6,
      updatedRound: 6,
      huddleOutcomeCount: 1,
      consequences: [],
      latestOutcome: {
        id: "o4",
        round: 6,
        window: "pre_vote",
        ask: "Hide the final-two promise.",
        plan: "Split public pressure before tribunal.",
        promises: [],
        dissent: [],
        confidence: "medium",
        posture: "coordinated",
        leakOrBetrayalClaims: [],
      },
    });
    facts.allianceFacts.huddles.push({
      allianceId: "a4",
      allianceName: "Final Six Fire Drill",
      round: 6,
      window: "pre_vote",
      pass: 1,
      speakers: [
        { id: "p1", name: "Marnie" },
        { id: "p2", name: "Jace" },
      ],
      messages: [
        { from: { id: "p2", name: "Jace" }, text: "This is final-six information.", timestamp: 600 },
      ],
    });

    const watchModel = buildMatchWatchModel({
      game: game(),
      messages: [],
      live: false,
      connStatus: "replay",
      selectedPlayerId: "p1",
      playbackState: {
        round: 1,
        phase: "PRE_VOTE_HUDDLE",
        players: game().players,
        visibleMessages: [],
      },
    });

    const model = buildMatchWatchAlliancePanelModel({
      model: watchModel,
      allianceState: { loadState: "ready", facts },
    });

    expect(model.status).toBe("ready");
    expect(model.summary).toEqual({
      proposalCount: 2,
      allianceCount: 2,
      huddleCount: 1,
      latestHuddleRound: 1,
    });
    expect(model.cards.map((card) => card.name)).toEqual(["Back Row Pact", "Mirror Knives"]);
    expect(model.cards.find((card) => card.name === "Mirror Knives")).toMatchObject({
      status: "active",
      latestOutcomeSummary: null,
      consequences: [],
      huddles: [],
    });
    expect(JSON.stringify(model)).toContain("Let the pair look louder than the pod.");
    expect(JSON.stringify(model)).not.toContain("Final Six Fire Drill");
    expect(JSON.stringify(model)).not.toContain("Vote together unless Echo flips.");
    expect(JSON.stringify(model)).not.toContain("helped eliminate alliance member Marnie");
    expect(JSON.stringify(model)).not.toContain("final-six information");
  });

  it("keeps expired involved proposals visible for the selected player", () => {
    const watchModel = buildMatchWatchModel({
      game: game(),
      messages: [],
      live: true,
      connStatus: "live",
      selectedPlayerId: "p4",
    });

    const model = buildMatchWatchAlliancePanelModel({
      model: watchModel,
      allianceState: { loadState: "ready", facts: alliances() },
    });

    expect(model.cards).toHaveLength(1);
    expect(model.cards[0]).toMatchObject({
      name: "The Smoke Test",
      status: "expired",
      latestProposalStatus: "expired",
      purpose: "Probe whether the quiet players can coordinate.",
    });
  });

  it("does not reveal same-round proposal expiration before the replay reaches the resolution phase", () => {
    const watchModel = buildMatchWatchModel({
      game: game(),
      messages: [],
      live: false,
      connStatus: "replay",
      selectedPlayerId: "p4",
      playbackState: {
        round: 1,
        phase: "MINGLE_I",
        players: game().players,
        visibleMessages: [],
      },
    });

    const model = buildMatchWatchAlliancePanelModel({
      model: watchModel,
      allianceState: { loadState: "ready", facts: alliances() },
    });

    expect(model.status).toBe("ready");
    expect(model.cards).toHaveLength(1);
    expect(model.cards[0]).toMatchObject({
      name: "The Smoke Test",
      status: "pending",
      latestProposalStatus: "pending",
      proposedRound: 1,
      updatedRound: 1,
    });
    expect(JSON.stringify(model)).not.toContain("expired");
  });

  it("builds completed global alliance arcs without selected-player filtering", () => {
    const model = buildCompletedAllianceArcsModel(
      { loadState: "ready", facts: alliances() },
      game().players,
    );

    expect(model.status).toBe("ready");
    expect(model.summary).toEqual({
      proposalCount: 3,
      allianceCount: 3,
      huddleCount: 2,
      latestHuddleRound: 2,
    });
    expect(model.cards.map((card) => card.name)).toEqual(["Mirror Knives", "Back Row Pact", "The Smoke Test"]);
    expect(model.cards[0]?.members).toMatchObject([
      { id: "p1", name: "Marnie", persona: "strategic", avatarUrl: "https://cdn.example/marnie.png" },
      { id: "p2", name: "Jace", persona: "deceptive" },
    ]);
  });
});
