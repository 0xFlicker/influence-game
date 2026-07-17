import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { CompletedResultsVoteMatrix } from "../app/games/[slug]/components/completed-results-vote-matrix";
import { CompletedResultsAgentCard } from "../app/games/[slug]/components/completed-results-agent-card";
import { CompletedResultsAllianceArcs } from "../app/games/[slug]/components/completed-results-alliance-arcs";
import { CompletedGameEntry } from "../app/games/[slug]/components/completed-game-entry";
import { CompletedResultsSeasonSummary } from "../app/games/[slug]/components/completed-results-review";

describe("completed results review components", () => {
  it("renders championship point receipts only in the results review", () => {
    const html = renderToString(
      <CompletedResultsSeasonSummary
        seasonId="season-0"
        receipts={[{
          gameId: "game-1",
          gameSlug: "cold-navy-horn",
          agentId: "sable",
          agentName: "Sable",
          owner: {
            publicId: "21f431c0-73c7-49f1-801c-2118523e5dda",
            handle: "architect-two",
            displayName: "Architect Two",
          },
          ownerName: "Architect Two",
          lobbySize: 8,
          placement: 5,
          basePoints: 20,
          fieldBonus: 0,
          totalPoints: 20,
          seasonTotalPoints: 44,
          eligibilityStatus: "eligible",
          eligibilityReason: null,
          accountRatingDelta: -16,
          earnedAt: "2026-07-11T00:00:00.000Z",
        }, {
          gameId: "game-1",
          gameSlug: "cold-navy-horn",
          agentId: "atlas",
          agentName: "Atlas",
          owner: {
            publicId: "4b104ba0-285b-4268-a291-39dc637173d8",
            handle: "architect",
            displayName: "Architect",
          },
          ownerName: "Architect",
          lobbySize: 8,
          placement: 1,
          basePoints: 100,
          fieldBonus: 12,
          totalPoints: 112,
          seasonTotalPoints: 120,
          eligibilityStatus: "eligible",
          eligibilityReason: null,
          accountRatingDelta: 18,
          earnedAt: "2026-07-11T00:00:00.000Z",
        }]}
      />,
    );

    expect(html).toContain("Rated season game");
    expect(html).toContain("132 points awarded");
    expect(html).toContain("Championship point receipts");
    expect(html).toContain("Place 1 of 8");
    expect(html).toContain("Points earned");
    expect(html).toContain("Season total");
    expect(html).toContain("Includes +12 strong-field bonus");
    expect(html).not.toContain(">Base<");
    expect(html).not.toContain(">Field<");
    expect(html.indexOf("Atlas")).toBeLessThan(html.indexOf("Sable"));
  });

  it("renders vote matrix cells and keeps formal alliance wording absent", () => {
    const html = renderToString(
      <CompletedResultsVoteMatrix
        columns={[
          { id: "r1:empower", label: "Round 1 empower", shortLabel: "R1 E+", round: 1, kind: "empower" },
          { id: "r1:expose", label: "Round 1 expose", shortLabel: "R1 X", round: 1, kind: "expose" },
        ]}
        rows={[
          {
            player: { id: "alice", name: "Alice" },
            cells: [
              { targetId: "bob", targetName: "Bob", groupKey: "r1:empower:bob", colorClass: "bg-cyan-400/15 text-cyan-100 border-cyan-300/20" },
              { targetId: "cara", targetName: "Cara", groupKey: "r1:expose:cara", colorClass: "bg-emerald-400/15 text-emerald-100 border-emerald-300/20" },
            ],
          },
        ]}
      />,
    );

    expect(html).toContain("Alice");
    expect(html).toContain("Bob");
    expect(html).toContain("Cara");
    expect(html.toLowerCase()).not.toContain("alliance");
  });

  it("renders agent facts without transient thinking snippets", () => {
    const html = renderToString(
      <CompletedResultsAgentCard
        card={{
          player: { id: "alice", name: "Alice", placement: 1, status: "winner" },
          placementLabel: "1st",
          votesCast: 3,
          votesReceived: 4,
          tags: ["Winner", "Won final vote 2-0", "Reached final"],
        }}
      />,
    );

    expect(html).toContain("Alice");
    expect(html).toContain("1st");
    expect(html).toContain("3");
    expect(html).toContain("cast");
    expect(html).toContain("4");
    expect(html).toContain("received");
    expect(html).toContain("Winner");
    expect(html).toContain("Won final vote 2-0");
    expect(html).toContain("Reached final");
    expect(html).not.toContain("Decision Log");
    expect(html).not.toContain("Thinking");
    expect(html).not.toContain("Alice owned the jury story.");
  });

  it("keeps the game-time results name while using the current agent portrait", () => {
    const html = renderToString(
      <CompletedResultsAgentCard
        card={{
          player: { id: "alice", name: "Alice", placement: 1, status: "winner" },
          placementLabel: "1st",
          votesCast: 3,
          votesReceived: 4,
          tags: ["Winner"],
        }}
        player={{
          id: "alice",
          name: "Alice",
          persona: "deceptive",
          personaKey: "deceptive",
          status: "alive",
          shielded: false,
          avatarUrl: "https://cdn.example.test/alice-historical.png",
          currentAgent: {
            name: "Alice Prime",
            avatarUrl: "https://cdn.example.test/alice-current.png",
            role: { key: "strategic", label: "Strategic" },
            competition: { gamesPlayed: 5, wins: 2, winRate: 0.4 },
          },
        }}
      />,
    );

    expect(html).toContain('aria-label="View Alice portrait and stats"');
    expect(html).toContain('src="https://cdn.example.test/alice-current.png"');
    expect(html).not.toContain('aria-label="View Alice Prime portrait and stats"');
  });

  it("renders completed alliance arcs as public summary plus compact transcript details", () => {
    const html = renderToString(
      <CompletedResultsAllianceArcs
        model={{
          status: "ready",
          reason: null,
          summary: {
            proposalCount: 2,
            allianceCount: 1,
            huddleCount: 1,
            latestHuddleRound: 2,
          },
          cards: [
            {
              id: "a1",
              name: "Mirror Knives",
              status: "active",
              members: [
                { id: "p1", name: "Marnie" },
                { id: "p2", name: "Jace" },
              ],
              memberNames: ["Marnie", "Jace"],
              purpose: "Trade cover while each tests the room.",
              timebox: null,
              proposedRound: 1,
              createdRound: 1,
              updatedRound: 2,
              proposalCount: 2,
              latestProposalStatus: "accepted",
              latestOutcomeSummary: "Plan: Vote together unless Echo flips.",
              consequences: [{
                type: "alliance_member_cut",
                round: 2,
                description: "Jace helped eliminate alliance member Marnie after sharing Mirror Knives.",
                confidence: "high",
                playerNames: ["Marnie", "Jace"],
              }],
              huddles: [
                {
                  id: "a1:2:pre_vote:1",
                  allianceId: "a1",
                  allianceName: "Mirror Knives",
                  round: 2,
                  window: "pre_vote",
                  pass: 1,
                  speakerNames: ["Marnie", "Jace"],
                  messageCount: 3,
                  outcomeSummary: "Ask: Keep pressure off Marnie.",
                  messages: [
                    { fromName: "Marnie", text: "Hold Echo at arm's length.", timestamp: 1 },
                    { fromName: "Jace", text: "I can sell that.", timestamp: 2 },
                    { fromName: "Marnie", text: "Then we compare notes after council.", timestamp: 3 },
                  ],
                },
              ],
            },
          ],
        }}
      />,
    );

    expect(html).toContain("Alliance Arcs");
    expect(html).toContain("id=\"alliance-arcs\"");
    expect(html).toContain("id=\"alliance-a1\"");
    expect(html).toContain("Public record");
    expect(html).toContain("Mirror Knives");
    expect(html).toContain("Trade cover while each tests the room.");
    expect(html).toContain("Jace helped eliminate alliance member Marnie");
    expect(html).toContain("Hold Echo at arm&#x27;s length.");
    expect(html).toContain("more messages in this huddle.");
    expect(html).not.toContain("Thinking");
    expect(html).not.toContain("loyal");
    expect(html).not.toContain("fake");
  });

  it("offers House Highlights alongside replay and results for completed games", () => {
    const html = renderToString(
      <CompletedGameEntry gameId="edge smoke/dusk" hasReplay />,
    );

    expect(html).toContain("Completed game");
    expect(html).toContain("edge smoke/dusk");
    expect(html).toContain("House Highlights");
    expect(html).toContain("/games/edge%20smoke%2Fdusk/highlights");
    expect(html).toContain("/games/edge%20smoke%2Fdusk/replay");
    expect(html).toContain("/games/edge%20smoke%2Fdusk/results");
  });
});
