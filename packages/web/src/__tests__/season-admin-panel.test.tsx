import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SeasonAdminPanel, SeasonEvidence, suggestSeasonName } from "../app/admin/season-admin-panel";
import type { ProducerSeasonDiagnostics } from "../lib/api";

describe("season admin panel", () => {
  test("suggests a human season number instead of a date-based display name", () => {
    expect(suggestSeasonName([])).toBe("Season 0");
    expect(suggestSeasonName([{ name: "Season 0" }, { name: "Summer Invitational" }])).toBe("Season 1");
    expect(suggestSeasonName([{ name: "Season 2" }, { name: "Season 7" }])).toBe("Season 8");
  });

  test("starts in a read-only loading state without arbitrary ledger mutation controls", () => {
    const html = renderToStaticMarkup(<SeasonAdminPanel />);
    expect(html).toContain("Loading seasons");
    expect(html).not.toContain("Edit receipt");
    expect(html).not.toContain("Set rating");
    expect(html).not.toContain("Delete evidence");
  });

  test("exposes reproducible producer evidence without ledger mutation controls", () => {
    const diagnostics: ProducerSeasonDiagnostics = {
      schemaVersion: 1,
      seasonId: "season-1",
      season: {
        status: "closing",
      },
      readiness: { assignedGames: 1, nonTerminalGames: 0, unsettledOwnedSeats: 0, canFinalize: true },
      ratings: [],
    ratingEvents: [{
        id: "event-1",
        eventType: "revision_recalibration",
        agentProfileId: "agent-1",
        agentRevisionId: "revision-2",
        beforeMu: 25,
        beforeSigma: 4,
        afterMu: 25,
        afterSigma: 6,
        ratingPolicyVersion: "competition-rating-v1",
        revisionPolicyVersion: "agent-revision-v1",
        evidence: { classification: { magnitude: "material" } },
        createdAt: "2026-07-10T01:00:00.000Z",
      }],
    ratingSnapshots: [],
    receiptEvidence: [{
        receiptId: "receipt-1",
        ratingPolicyVersion: "competition-rating-v1",
        pregameRating: { mu: 25, sigma: 6 },
        postgameRating: { mu: 26, sigma: 5 },
        opponentRatings: [{ mu: 30, sigma: 4 }],
        fieldStrengthEvidence: { bonusRate: 0.12 },
      }],
      revisions: [{
        id: "revision-2",
        agentProfileId: "agent-1",
        ordinal: 2,
        magnitude: "material",
        fingerprint: "hash",
        behaviorSnapshot: { personality: "strategic" },
        effectiveRuntimeSnapshot: { model: "gpt-5-nano" },
        createdAt: "2026-07-10T01:00:00.000Z",
      }],
    };
    const html = renderToStaticMarkup(<SeasonEvidence diagnostics={diagnostics} />);
    expect(html).toContain("Rating transitions");
    expect(html).toContain("Receipt reproduction");
    expect(html).toContain("Revision classifier evidence");
    expect(html).toContain("Can finalize");
    expect(html).not.toContain("Set rating");
    expect(html).not.toContain("Edit receipt");
  });
});
