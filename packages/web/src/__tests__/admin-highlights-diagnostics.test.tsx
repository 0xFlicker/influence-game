import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import {
  AdminHighlightsDiagnosticsContent,
  AdminHighlightsPill,
} from "../app/admin/admin-highlights-diagnostics";
import type {
  AdminGameSummary,
  AdminHouseHighlightsDiagnosticsResponse,
} from "../lib/api";

describe("AdminHighlightsDiagnostics", () => {
  it("renders card selection diagnostics with sources, rejection reasons, and receipts", () => {
    const html = renderToString(
      <AdminHighlightsDiagnosticsContent detail={diagnosticsFixture()} />,
    );

    expect(html).toContain("Why these cards?");
    expect(html).toContain("Selected cards");
    expect(html).toContain("Rejected and unused candidates");
    expect(html).toContain("Receipt inspector");
    expect(html).toContain("Lyra kept taking the room&#x27;s power");
    expect(html).toContain("power_shift");
    expect(html).toContain("selected_for_main_cut");
    expect(html).toContain("Rex was cut from inside the pact");
    expect(html).toContain("betrayal_scene_cap");
    expect(html).toContain("not_in_final_edit");
    expect(html).toContain("round:5:empowered:lyra");
    expect(html).toContain("/games/vast-plum-bay/results#round-5");
  });

  it("only offers the diagnostics pill for completed games", () => {
    const completed = renderToString(
      <AdminHighlightsPill game={adminGame({ status: "completed" })} onClick={() => {}} />,
    );
    const waiting = renderToString(
      <AdminHighlightsPill game={adminGame({ status: "waiting" })} onClick={() => {}} />,
    );

    expect(completed).toContain("Cards");
    expect(completed).toContain("diagnostics");
    expect(waiting).not.toContain("Cards");
  });
});

function diagnosticsFixture(): AdminHouseHighlightsDiagnosticsResponse {
  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: "game-vast-plum-bay",
      slug: "vast-plum-bay",
      status: "completed",
      trackType: "custom",
      playerCount: 10,
      roundCount: 8,
    },
    highlights: {
      schemaVersion: 1,
      state: "main_cut",
      eligibility: {
        status: "eligible",
        reason: null,
        allianceReceiptCount: 12,
      },
      thesis: "This was the game where power hardened, then the jury made every cut count.",
      cut: {
        kind: "main",
        title: "House Cut",
        thesis: "This was the game where power hardened, then the jury made every cut count.",
        shareCaption: "Power hardened, then the jury made every cut count.",
        scenes: [],
      },
      scenes: [
        {
          id: "power-control:power_shift:lyra",
          title: "Lyra kept taking the room's power",
          category: "triumph",
          confidence: "medium",
          involvedAgents: [{ id: "lyra", name: "Lyra" }],
          houseHook: "Lyra turned repeated power votes into a public storyline.",
          setup: "Power votes kept coming back to Lyra.",
          conflict: "Every repeat made the room's control structure harder to ignore.",
          payoff: "Lyra controlled power for 5 consecutive rounds.",
          receipts: [{
            id: "power-control:power_shift:lyra",
            tier: "vote_record",
            label: "Power vote record",
            description: "Lyra controlled power in round 5.",
            factRefs: ["round:5:empowered:lyra"],
          }],
          deepLink: {
            surface: "results",
            label: "Open power record",
            round: 5,
            anchor: "round-5",
          },
          posterDirection: "Power tally card.",
        },
      ],
      noCutReason: null,
      fallbackLinks: [
        { surface: "results", label: "Open results", round: null, anchor: "results" },
      ],
      diagnostics: {
        selectedSceneIds: ["power-control:power_shift:lyra"],
        selectedCandidates: [{
          id: "power-control:power_shift:lyra",
          title: "Lyra kept taking the room's power",
          category: "triumph",
          source: "power_shift",
          confidence: "medium",
          selected: true,
          score: 94,
          receiptCount: 1,
          reasons: ["selected_for_main_cut"],
        }],
        rejectedCandidates: [
          {
            id: "alliance-cut:2:rex",
            title: "Rex was cut from inside the pact",
            category: "betrayal",
            source: "named_alliance_member_voted_to_eliminate",
            confidence: "high",
            selected: false,
            score: 100,
            receiptCount: 2,
            reasons: ["betrayal_scene_cap"],
          },
          {
            id: "vote-cohort:echo-luna",
            title: "Echo and Luna kept finding the same target",
            category: "loyalty",
            source: "shared_vote_outcomes",
            confidence: "medium",
            selected: false,
            score: 84,
            receiptCount: 2,
            reasons: ["not_in_final_edit"],
          },
        ],
        notes: [{
          code: "main_cut_selected",
          severity: "info",
          message: "The cut met the scene threshold.",
        }],
      },
    },
  };
}

function adminGame(overrides: Partial<AdminGameSummary> = {}): AdminGameSummary {
  return {
    id: "game-vast-plum-bay",
    slug: "vast-plum-bay",
    gameNumber: 42,
    status: "completed",
    playerCount: 10,
    currentRound: 8,
    maxRounds: 8,
    currentPhase: "done",
    phaseTimeRemaining: null,
    alivePlayers: 2,
    eliminatedPlayers: 8,
    modelTier: "standard",
    visibility: "public",
    viewerMode: "replay",
    trackType: "custom",
    winner: "Echo",
    winnerPersona: "strategic",
    hidden: false,
    createdAt: "2026-07-04T00:00:00.000Z",
    completedAt: "2026-07-04T01:00:00.000Z",
    ...overrides,
  };
}
