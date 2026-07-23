import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { MatchWatchAlliancePanel } from "../app/games/[slug]/components/match-watch-alliance-panel";
import type { MatchWatchAlliancePanelModel } from "../app/games/[slug]/components/match-watch-alliance-model";
import type { GamePlayer } from "../lib/api";

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
  it("keeps member previews separate from alliance expansion", () => {
    const players: GamePlayer[] = [{
      id: "p1",
      name: "Marnie",
      persona: "strategic",
      personaKey: "strategic",
      status: "alive",
      shielded: false,
      avatarUrl: "/avatars/marnie-historical.png",
      currentAgent: {
        name: "Marnie After Rename",
        avatarUrl: "/avatars/marnie-current.png",
        role: { key: "aggressive", label: "Aggressor" },
        competition: {
          gamesPlayed: 5,
          wins: 2,
          winRate: 0.4,
        },
      },
    }];
    const html = renderToString(
      <MatchWatchAlliancePanel
        allianceModel={panelModel()}
        players={players}
      />,
    );

    expect(html).toContain('aria-label="View Marnie portrait and stats"');
    expect(html).toContain("/avatars/marnie-current.png");
    expect(html).not.toContain("Marnie After Rename");
    expect(html).not.toContain("-space-x");
    expect(html).not.toMatch(/<summary(?:(?!<\/summary>)[\s\S])*<button/);
  });

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
    expect(html).toContain("space-y-2 rounded-md border border-white/10 bg-black/20");
    expect(html.indexOf('aria-label="Mirror Knives members"')).toBeLessThan(html.indexOf("<details"));
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
