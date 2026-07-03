import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { CompletedResultsAllianceArcs } from "../app/games/[slug]/components/completed-results-alliance-arcs";

describe("CompletedResultsAllianceArcs", () => {
  it("renders alliance summaries, deterministic consequences, and compact transcript details", () => {
    const html = renderToString(
      <CompletedResultsAllianceArcs
        model={{
          status: "ready",
          reason: null,
          summary: {
            proposalCount: 1,
            allianceCount: 1,
            huddleCount: 1,
            latestHuddleRound: 3,
          },
          cards: [{
            id: "alliance-smoke-vote",
            name: "Smoke Vote Pair",
            status: "archived",
            members: [
              { id: "p1", name: "Marnie" },
              { id: "p2", name: "Jace" },
            ],
            memberNames: ["Marnie", "Jace"],
            purpose: "Trade cover around the first council vote.",
            timebox: "through council",
            proposedRound: 1,
            createdRound: 1,
            updatedRound: 3,
            proposalCount: 1,
            latestProposalStatus: "accepted",
            latestOutcomeSummary: "Plan: Hold the vote line until council.",
            consequences: [{
              type: "alliance_member_cut",
              round: 3,
              description: "Jace helped eliminate alliance member Marnie after sharing Smoke Vote Pair.",
              confidence: "high",
              playerNames: ["Marnie", "Jace"],
            }],
            huddles: [{
              id: "alliance-smoke-vote:3:pre_vote:1",
              allianceId: "alliance-smoke-vote",
              allianceName: "Smoke Vote Pair",
              round: 3,
              window: "pre_vote",
              pass: 1,
              speakerNames: ["Marnie", "Jace"],
              messageCount: 2,
              outcomeSummary: "Ask: Keep the vote line quiet.",
              messages: [
                { fromName: "Marnie", text: "Keep this quiet until council.", timestamp: 10 },
                { fromName: "Jace", text: "I will hold the line.", timestamp: 11 },
              ],
            }],
          }],
        }}
      />,
    );

    expect(html).toContain("Alliance Arcs");
    expect(html).toContain("Smoke Vote Pair");
    expect(html).toContain("Marnie, Jace");
    expect(html).toContain("Jace helped eliminate alliance member Marnie");
    expect(html).toContain("Keep this quiet until council.");
    expect(html).not.toContain("thinking");
    expect(html).not.toContain("loyal");
    expect(html).not.toContain("fake");
  });
});
