import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { MatchWatchAlliancePanel } from "../app/games/[slug]/components/match-watch-alliance-panel";
import type { MatchWatchAlliancePanelModel } from "../app/games/[slug]/components/match-watch-alliance-model";

function panelModel(): MatchWatchAlliancePanelModel {
  return {
    status: "ready",
    selectedPlayerName: "Marnie",
    reason: null,
    summary: {
      proposalCount: 2,
      allianceCount: 2,
      huddleCount: 1,
      latestHuddleRound: 2,
    },
    cards: [
      {
        id: "a1",
        name: "Mirror Knives",
        status: "active",
        members: [
          { id: "p1", name: "Marnie", persona: "strategic", avatarUrl: "/avatars/marnie.png" },
          { id: "p2", name: "Jace", persona: "deceptive", avatarUrl: "/avatars/jace.png" },
        ],
        memberNames: ["Marnie", "Jace"],
        purpose: "Trade cover while each tests the room.",
        timebox: "through council",
        proposedRound: 1,
        createdRound: 1,
        updatedRound: 2,
        proposalCount: 1,
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
            messageCount: 2,
            outcomeSummary: "Ask: Keep pressure off Marnie. Plan: Vote together unless Echo flips.",
            messages: [
              { fromName: "Marnie", text: "Jace, keep the heat on Echo.", timestamp: 200 },
              { fromName: "Jace", text: "I can do that, but do not overplay it.", timestamp: 201 },
            ],
          },
        ],
      },
    ],
  };
}

describe("MatchWatchAlliancePanel", () => {
  it("renders summary before huddle transcript details", () => {
    const html = renderToString(<MatchWatchAlliancePanel allianceModel={panelModel()} />);

    expect(html).toContain("Alliance");
    expect(html).toContain("Alliances");
    expect(html).toContain("Proposals");
    expect(html).toContain("Huddles");
    expect(html).toContain("Mirror Knives");
    expect(html).toContain("Marnie, Jace");
    expect(html).toContain("/avatars/marnie.png");
    expect(html).toContain("/avatars/jace.png");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open=\"\"");
    expect(html).toContain("Trade cover while each tests the room.");
    expect(html).toContain("Jace helped eliminate alliance member Marnie");
    expect(html).toContain("Marnie");
    expect(html).toContain("Jace, keep the heat on Echo.");
    expect(html).not.toContain("thinking");
    expect(html).not.toContain("loyal");
    expect(html).not.toContain("fake");
  });

  it("renders local empty state text", () => {
    const html = renderToString(
      <MatchWatchAlliancePanel
        allianceModel={{
          status: "empty",
          selectedPlayerName: "Echo",
          reason: "Echo has no recorded named alliances yet.",
          summary: { proposalCount: 0, allianceCount: 0, huddleCount: 0, latestHuddleRound: null },
          cards: [],
        }}
      />,
    );

    expect(html).toContain("Echo has no recorded named alliances yet.");
  });
});
