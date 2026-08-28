import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { OwnerLearningReview, OwnerLearningResolution } from "../lib/api";
import { OwnerLearningReviewView } from "../app/dashboard/agents/[id]/review/owner-learning-review";

describe("owner learning review", () => {
  test("shows immediate accepted facts beside honest persisted stages", () => {
    const html = renderReview(reviewFixture());
    const visibleText = html.replace(/<[^>]*>/g, " ");

    expect(html).toContain('aria-label="Accepted action timeline"');
    expect(html).toContain("Accepted actions, votes, powers, and results—not generated analysis.");
    expect(html).toContain("Backed Mira");
    expect(html).toContain("The council eliminated the agent");
    expect(html).toContain("Game records loaded");
    expect(html).toContain("Decisions mapped");
    expect(html).toContain("Repeated patterns compared");
    expect(html).toContain("Focused update drafted");
    expect(html).toContain("Progress is saved");
    expect(html).not.toContain("Review moments");
    expect(html).not.toContain("dialogue:line-7");
    expect(html).not.toContain("moment-1");
    expect(visibleText).not.toContain("%");
    expect(visibleText).not.toMatch(/\bETA\b/i);
    expect(visibleText).not.toMatch(/\bminutes?\b/i);
  });

  test("shows accepted format ballots instead of a missing expose placeholder", () => {
    const review = reviewFixture();
    const canonicalFacts = review.evidence.games[0]!.canonicalFacts as {
      actionsByAgent: Record<string, unknown>;
    };
    canonicalFacts.actionsByAgent = {
      votesCastByRound: [{
        round: 1,
        empowerTarget: { name: "Mira" },
        exposeTarget: null,
      }],
      formatBallotsCastByRound: [{
        round: 1,
        formatId: "save_or_eliminate",
        target: { name: "Rune" },
        polarity: "save",
      }],
      councilVotesCast: [],
      powersUsed: [],
    };

    const html = renderReview(review);

    expect(html).toContain("Voted to save Rune");
    expect(html).not.toContain("No expose target recorded");
  });

  test("renders format-only ballots and every useful format action label", () => {
    const cases = [
      ["save_or_eliminate", "save", "Voted to save Rune"],
      ["save_or_eliminate", "eliminate", "Voted to exit Rune"],
      ["vote_bomb", null, "The Short List vote against Rune"],
      ["majority_elimination", null, "Highest Count vote against Rune"],
      ["safety_bounce", null, "Safety Bounce vote against Rune"],
    ] as const;

    for (const [formatId, polarity, label] of cases) {
      const review = reviewFixture();
      const canonicalFacts = review.evidence.games[0]!.canonicalFacts as {
        actionsByAgent: Record<string, unknown>;
      };
      canonicalFacts.actionsByAgent = {
        votesCastByRound: [],
        formatBallotsCastByRound: [{
          round: 1,
          formatId,
          target: { name: "Rune" },
          polarity,
        }],
        councilVotesCast: [],
        powersUsed: [],
      };

      expect(renderReview(review)).toContain(label);
    }
  });

  test("leaves old frozen evidence blank instead of inventing an expose or format action", () => {
    const review = reviewFixture();
    const canonicalFacts = review.evidence.games[0]!.canonicalFacts as {
      actionsByAgent: Record<string, unknown>;
    };
    canonicalFacts.actionsByAgent = {
      votesCastByRound: [{
        round: 1,
        empowerTarget: { name: "Mira" },
        exposeTarget: null,
      }],
      councilVotesCast: [],
      powersUsed: [],
    };

    const html = renderReview(review);
    expect(html).toContain("Backed Mira");
    expect(html).not.toContain("No expose target recorded");
    expect(html).not.toContain("Empower-only ballot");
  });

  test("renders generated text as escaped prose without exposing evidence coordinates", () => {
    const html = renderReview(readyReview({
      diagnosis: '<img src=x onerror="alert(1)"> Hold longer.',
      recommendations: [{
        id: "rec-1",
        title: "Delay <script>alert(1)</script>",
        disposition: "change",
        confidence: "high",
        rationale: "The first vote exposed the coalition.",
        keepGuidance: "Keep naming a concrete ally.",
        evidenceRefs: [{
          kind: "dialogue",
          gameId: "game-1",
          coordinate: "moment-1",
          sourceHash: "hash-1",
          sourceVersion: "capture-v1",
        }],
      }],
      proposal: {
        field: "strategyStyle",
        before: "Commit early.",
        after: "Wait for reciprocal support before committing.",
      },
    }));

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("Delay &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("Keep naming a concrete ally");
    expect(html).toContain("Seen across 1 game");
    expect(html).not.toContain("dialogue · moment-1");
    expect(html).not.toContain("moment-1");
    expect(html).toContain("− Commit early.");
    expect(html).toContain("+ Wait for reciprocal support before committing.");
    expect(html).toContain("Edit changes myself");
    expect(html).toContain("Keep current strategy");
    expect(html).toContain("Apply strategy update");
  });

  test("keeps the exact diff anchored after apply and replaces mutation controls with next actions", () => {
    const html = renderReview({
      ...readyReview(),
      resolution: "applied",
      application: {
        sourceRecommendationIds: ["rec-1"],
        priorRevisionId: "prior-rev-1",
        resultingRevisionId: "next-rev-2",
        priorStrategyStyle: "Commit early.",
        resultingStrategyStyle: "Wait for reciprocal support.",
        mutationReceipt: {},
        appliedAt: "2026-08-04T12:02:00.000Z",
      },
    });

    expect(html).toContain('data-state="applied"');
    expect(html).toContain("Strategy update applied");
    expect(html).toContain("− Commit early.");
    expect(html).toContain("+ Wait for reciprocal support.");
    expect(html).toContain("Revision next-rev-2 is active. Future games use it.");
    expect(html).toContain('href="/games/free"');
    expect(html).toContain("Enter Influence Queue");
    expect(html).toContain('href="/dashboard/agents/agent-1"');
    expect(html).toContain("View agent");
    expect(html).not.toContain("Apply strategy update");
    expect(html).not.toContain("Edit changes myself");
    expect(html).not.toContain("Keep current strategy");
  });

  test("keeps internal evidence coordinates out of owner-facing recommendations", () => {
    const html = renderReview(readyReview());

    expect(html).toContain("Seen across 1 game");
    expect(html).not.toContain("Stable coordinates for evidence links");
    expect(html).not.toContain("dialogue:line-7");
    expect(html).not.toContain("moment-1");
  });

  test("presents a long diagnosis as report copy instead of a page heading", () => {
    const html = renderReview(readyReview());

    expect(html).toContain('<h2 id="olm-verdict-title">What changed in the room</h2>');
    expect(html).toContain('<p class="olm-verdict-copy">Atlas committed before support became reciprocal.</p>');
    expect(html).not.toContain('<h2 id="olm-verdict-title">Atlas committed');
  });

  test("labels all health-check proof forms without collapsing observation into guidance", () => {
    const recommendations = [
      proofRecommendation("observed", "observed_pattern"),
      proofRecommendation("guidance", "prompt_guidance_defect"),
      proofRecommendation("combined", "combined"),
    ];
    const html = renderReview(readyReview({
      analysisTrack: "strategy_health_check",
      strategyHealthClassification: "guidance_gap",
      recommendations,
    }, "strategy_health_check"));

    expect(html).toContain("Strategy health check");
    expect(html).toContain("Seen across 1 game");
    expect(html).toContain("Found in your strategy guidance");
    expect(html).toContain("Seen in play and guidance");
    expect(html).toContain("Observed evidence");
    expect(html).toContain("Strategic interpretation");
    expect(html).toContain("Proposed guidance");
  });

  test("keeps no-change terminal and failure recovery distinct", () => {
    const noChange = renderReview({
      ...readyReview({
        diagnosis: "The standing guidance fits the selected evidence.",
        recommendations: [],
        noChange: { rationale: "The early exits do not prove a strategy defect." },
      }),
      analysisStatus: "no_change",
      resolution: "no_change",
      proposalFingerprint: null,
    });
    const retryable = renderReview({
      ...reviewFixture(),
      analysisStatus: "failed",
      safeFailureCode: "provider_timeout",
      retryable: true,
      logicalCallCount: 2,
    });
    const turnFourRetryable = renderReview({
      ...reviewFixture(),
      analysisStatus: "failed",
      safeFailureCode: "provider_timeout",
      retryable: true,
      logicalCallCount: 4,
    });
    const exhausted = renderReview({
      ...reviewFixture(),
      analysisStatus: "failed",
      safeFailureCode: "logical_call_budget_exhausted",
      retryable: false,
      logicalCallCount: 4,
    });

    expect(noChange).toContain("No strategy update recommended");
    expect(noChange).toContain("early exits do not prove a strategy defect");
    expect(noChange).not.toContain("Apply strategy update");
    expect(retryable).toContain("The game facts are safe");
    expect(retryable).toContain("Retry analysis");
    expect(retryable).toContain("Close review");
    expect(retryable).toContain("reuses saved progress and does not use another review credit");
    expect(retryable).not.toContain("rolling allowance");
    expect(retryable).not.toContain("Cancel");
    expect(turnFourRetryable).toContain("Retry analysis");
    expect(exhausted).not.toContain("Retry analysis");
    expect(exhausted).toContain("Close review");
  });

  test("keeps every terminal resolution legible", () => {
    const expectations: Array<[Exclude<OwnerLearningResolution, null>, string]> = [
      ["applied", "Strategy update applied"],
      ["manual_update", "Manual update completed"],
      ["declined", "Current strategy kept"],
      ["no_change", "No change recommended"],
      ["failed", "Failed review resolved"],
      ["superseded", "Review superseded"],
    ];
    for (const [resolution, label] of expectations) {
      const html = renderReview({ ...readyReview(), resolution });
      expect(html).toContain(label);
    }
  });

  test("keeps MCP contextual and returns setup to the persisted review", () => {
    const unconnected = renderReview(readyReview());
    const connected = renderReview(readyReview(), { mcpConnectionState: "connected" });

    expect(unconnected).toContain("Take this review deeper with your own AI");
    expect(unconnected).toContain("returnTo=%2Fdashboard%2Fagents%2Fagent-1%2Freview%2Freview-1");
    expect(unconnected).toContain("list open learning reviews");
    expect(connected).toContain("MCP connected");
    expect(connected).toContain("Interrogate this review with your own AI");
  });

  test("retains mobile order, 44px controls, and reduced-motion meaning", () => {
    const css = readFileSync(
      join(import.meta.dir, "../app/dashboard/agents/[id]/review/owner-learning-review.css"),
      "utf8",
    );
    expect(css).toContain("@media (max-width: 620px)");
    expect(css).toContain("min-height: 44px");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation: none !important");
    expect(css).toContain("overflow-x: clip");
  });
});

function renderReview(
  review: OwnerLearningReview,
  overrides: Partial<Parameters<typeof OwnerLearningReviewView>[0]> = {},
): string {
  return renderToStaticMarkup(
    <OwnerLearningReviewView
      review={review}
      agent={null}
      activeGameId="game-1"
      pendingAction={null}
      notice={null}
      mcpConnectionState="not_connected"
      onSelectGame={() => undefined}
      onRetry={() => undefined}
      onApply={() => undefined}
      onResolve={() => undefined}
      {...overrides}
    />,
  );
}

function reviewFixture(): OwnerLearningReview {
  return {
    id: "review-1",
    agentProfileId: "agent-1",
    reviewedRevisionId: "revision-atlas-01",
    selectedGameIds: ["game-1"],
    analysisTrack: "evidence_rich",
    analysisStatus: "running",
    stage: "investigating_moments",
    capacitySubstatus: null,
    resolution: null,
    result: null,
    proposalFingerprint: null,
    safeFailureCode: null,
    retryable: true,
    ownerRetriesRemaining: 1,
    logicalCallCount: 1,
    diveCount: 1,
    applyDisposition: "not_ready",
    evidence: {
      games: [{
        gameId: "game-1",
        position: 0,
        canonicalFacts: {
          game: { id: "game-1", slug: "daily-free-104", roundCount: 3, playerCount: 6 },
          reviewedPlayer: { placement: 5, status: "eliminated", eliminatedRound: 2, readableSummary: "Eliminated in round two after reaching council." },
          actionsByAgent: { votesCastByRound: [{ round: 1, empowerTarget: { name: "Mira" }, exposeTarget: { name: "Rune" } }], councilVotesCast: [], powersUsed: [] },
          actionsAgainstAgent: { empowerVotesReceivedByRound: [], exposeVotesReceivedByRound: [{ round: 1, votes: 2 }], councilVotesReceived: [], timesNominated: [{ round: 2, eliminated: true }], shieldsReceived: [] },
        },
        candidateMoments: [{
          id: "moment-1",
          gameId: "game-1",
          anchorKind: "dialogue",
          sourceCoordinate: "dialogue:line-7",
          sourceHash: "hash-1",
          round: 1,
          phase: "mingle",
        }],
        sourceCaptureVersion: "capture-v1",
        sourceHash: "source-1",
      }],
    },
    application: null,
    createdAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:01:00.000Z",
    resolvedAt: null,
  };
}

function readyReview(
  resultOverrides: Partial<NonNullable<OwnerLearningReview["result"]>> = {},
  analysisTrack: OwnerLearningReview["analysisTrack"] = "evidence_rich",
): OwnerLearningReview {
  return {
    ...reviewFixture(),
    analysisTrack,
    analysisStatus: "ready",
    stage: "complete",
    result: {
      diagnosis: "Atlas committed before support became reciprocal.",
      analysisTrack: analysisTrack === "awaiting_evidence" ? "evidence_rich" : analysisTrack,
      recommendations: [proofRecommendation("rec-1", "observed_pattern")],
      proposal: { field: "strategyStyle", before: "Commit early.", after: "Wait for reciprocal support." },
      ...resultOverrides,
    },
    proposalFingerprint: "sha256:proposal",
    applyDisposition: "awaiting_owner",
  };
}

function proofRecommendation(id: string, kind: "observed_pattern" | "prompt_guidance_defect" | "combined") {
  return {
    id,
    title: `Recommendation ${id}`,
    disposition: "change" as const,
    confidence: "high" as const,
    rationale: "Wait for reciprocal support.",
    evidenceRefs: [{
      kind: "dialogue" as const,
      gameId: "game-1",
      coordinate: "moment-1",
      sourceHash: "hash-1",
      sourceVersion: "capture-v1",
    }],
    proof: {
      kind,
      observedEvidence: "The first pledge was not reciprocated.",
      strategicInterpretation: "The commitment arrived before support was verified.",
      proposedGuidance: "Wait for reciprocal support.",
      exactGuidanceTarget: "opening commitment timing",
    },
  };
}
