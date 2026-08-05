import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OwnerLearningEligibleInputs, OwnerLearningPreflight } from "../lib/api";
import { OwnerLearningActivationView } from "../app/dashboard/agents/[id]/review/owner-learning-activation";
import { OwnerLearningEntryView } from "../app/dashboard/agents/[id]/review/owner-learning-entry";

describe("owner learning activation", () => {
  test("grades the Daily Free prompt from subtle to prominent", () => {
    const subtle = renderToStaticMarkup(
      <OwnerLearningActivationView eligible={eligibleFixture()} onDismiss={() => undefined} />,
    );
    const prominent = renderToStaticMarkup(
      <OwnerLearningActivationView
        eligible={eligibleFixture({ prompt: { threshold: 3, prominent: true, suppressedByDismissal: false } })}
        onDismiss={() => undefined}
      />,
    );

    expect(subtle).toContain('data-variant="subtle"');
    expect(subtle).toContain("1 review credit available");
    expect(subtle).toContain("Open the recorded facts first");
    expect(prominent).toContain('data-variant="prominent"');
    expect(prominent).toContain("Three-game pattern ready");
    expect(prominent).toContain("Review the pattern");
    expect(prominent).not.toContain("2 review credits");
  });

  test("keeps the subtle dashboard entry after a prominent prompt is dismissed", () => {
    const html = renderToStaticMarkup(
      <OwnerLearningActivationView
        eligible={eligibleFixture({
          prompt: { threshold: 3, prominent: true, suppressedByDismissal: true },
        })}
        onDismiss={undefined}
      />,
    );

    expect(html).toContain('data-variant="subtle"');
    expect(html).toContain("1 review credit available");
    expect(html).toContain("Open game review");
    expect(html).not.toContain("Not now");
  });

  test("resumes the owner-wide singleton even from another agent context", () => {
    const html = renderToStaticMarkup(
      <OwnerLearningActivationView
        contextAgentId="agent-2"
        eligible={eligibleFixture({
          openReview: {
            id: "review-1",
            agentProfileId: "agent-1",
            analysisStatus: "running",
            stage: "investigating_moments",
            analysisTrack: "evidence_rich",
          },
        })}
      />,
    );

    expect(html).toContain('data-variant="resume"');
    expect(html).toContain("Return to Atlas");
    expect(html).toContain("One owner review stays open at a time");
    expect(html).toContain("/dashboard/agents/agent-1/review/review-1");
    expect(html).not.toContain("Start");
  });

  test("shows a purchase decision over one to three eligible current-revision games", () => {
    const html = renderToStaticMarkup(
      <OwnerLearningEntryView
        eligible={eligibleFixture()}
        agent={null}
        selectedProfileId="agent-1"
        selectedGameIds={["game-1", "game-3"]}
        preflight={preflightFixture("evidence_rich")}
        preflightPending={false}
        startPending={false}
        notice={null}
        onChangeProfile={() => undefined}
        onToggleGame={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(html).toContain("Change agent");
    expect(html).toContain("Choose 1–3 games");
    expect(html).toContain("Start 2-game review");
    expect(html).toContain("Previously analyzed");
    expect(html).toContain("Starting uses your one review credit");
    expect(html).not.toContain("review allowance");
    expect(html).toContain("cannot be cancelled");
    expect(html).toContain("Nothing changes until you approve an update");
    expect(html).not.toContain("custom-game");
  });

  test("keeps thin evidence free and gives three early exits a health-check frame", () => {
    const awaiting = renderToStaticMarkup(
      <OwnerLearningEntryView
        eligible={eligibleFixture()}
        agent={null}
        selectedProfileId="agent-1"
        selectedGameIds={["game-1"]}
        preflight={preflightFixture("awaiting_evidence")}
        preflightPending={false}
        startPending={false}
        notice={null}
        onChangeProfile={() => undefined}
        onToggleGame={() => undefined}
        onStart={() => undefined}
      />,
    );
    const health = renderToStaticMarkup(
      <OwnerLearningEntryView
        eligible={eligibleFixture()}
        agent={null}
        selectedProfileId="agent-1"
        selectedGameIds={["game-1", "game-2", "game-3"]}
        preflight={preflightFixture("strategy_health_check")}
        preflightPending={false}
        startPending={false}
        notice={null}
        onChangeProfile={() => undefined}
        onToggleGame={() => undefined}
        onStart={() => undefined}
      />,
    );

    expect(awaiting).toContain("More evidence is needed before strategic analysis");
    expect(awaiting).toContain("cannot support a responsible strategy diagnosis");
    expect(awaiting).toContain("disabled");
    expect(health).toContain("Strategy Health Check");
    expect(health).toContain("observation, interpretation, and guidance distinct");
  });

  test("preserves selected facts when generation or rolling admission is unavailable", () => {
    const generationUnavailable = renderEntry(
      eligibleFixture(),
      preflightFixture("evidence_rich", "generation_unavailable"),
    );
    const rollingLimited = renderEntry(
      eligibleFixture({
        credit: {
          mode: "metered",
          balance: 0,
          nextAvailableAt: "2026-08-05T14:30:00.000Z",
          latestEligibleCompletion: { gameId: "game-3", completionAt: "2026-08-04T12:00:00.000Z" },
          refillCompletion: { gameId: "game-3", completionAt: "2026-08-04T12:00:00.000Z" },
          qualifyingCompletionCount: 3,
        },
      }),
      preflightFixture("evidence_rich"),
    );

    expect(generationUnavailable).toContain("Strategic review is temporarily unavailable");
    expect(generationUnavailable).toContain("Your credit has not been used");
    expect(generationUnavailable).toContain("game-01");
    expect(rollingLimited).toContain("Your next review can start");
    expect(rollingLimited).toContain("0 review credits");
    expect(rollingLimited).not.toContain("review credit ready");
    expect(rollingLimited).toContain("Your selected facts stay here");
    expect(rollingLimited).toContain("game-01");
  });

  test("presents sysop access as unlimited instead of inventing a ready credit", () => {
    const eligible = eligibleFixture({
      credit: {
        mode: "unlimited",
        balance: null,
        nextAvailableAt: null,
        latestEligibleCompletion: { gameId: "game-3", completionAt: "2026-08-04T12:00:00.000Z" },
        refillCompletion: null,
        qualifyingCompletionCount: 3,
      },
    });
    const activation = renderToStaticMarkup(
      <OwnerLearningActivationView eligible={eligible} />,
    );
    const entry = renderEntry(eligible, preflightFixture("evidence_rich"));

    expect(activation).toContain("Unlimited sysop reviews");
    expect(activation).not.toContain("credit ready");
    expect(entry).toContain("Unlimited sysop reviews");
    expect(entry).toContain("Sysop testing is unlimited");
    expect(entry).not.toContain("rolling allowance");
    expect(entry).not.toContain("disabled");
  });
});

function renderEntry(eligible: OwnerLearningEligibleInputs, preflight: OwnerLearningPreflight): string {
  return renderToStaticMarkup(
    <OwnerLearningEntryView
      eligible={eligible}
      agent={null}
      selectedProfileId="agent-1"
      selectedGameIds={["game-1"]}
      preflight={preflight}
      preflightPending={false}
      startPending={false}
      notice={null}
      onChangeProfile={() => undefined}
      onToggleGame={() => undefined}
      onStart={() => undefined}
    />,
  );
}

function eligibleFixture(overrides: Partial<OwnerLearningEligibleInputs> = {}): OwnerLearningEligibleInputs {
  return {
    eligibilityPolicyVersion: "daily-free-v1",
    credit: {
      mode: "metered",
      balance: 1,
      nextAvailableAt: null,
      latestEligibleCompletion: { gameId: "game-3", completionAt: "2026-08-04T12:00:00.000Z" },
      refillCompletion: { gameId: "game-3", completionAt: "2026-08-04T12:00:00.000Z" },
      qualifyingCompletionCount: 3,
    },
    profiles: [
      {
        agentProfileId: "agent-1",
        name: "Atlas",
        currentRevisionId: "revision-atlas-01",
        strategyStyle: "Read the room before committing.",
        qualifyingGameCount: 3,
        games: [1, 2, 3].map((number) => ({
          gameId: `game-${number}`,
          slug: `game-0${number}`,
          playerId: `player-${number}`,
          completionAt: `2026-08-0${number}T12:00:00.000Z`,
          analyticalRevisionId: "revision-atlas-01",
          transcriptCaptureVersion: 2,
          cognitiveArtifactCaptureVersion: 1,
          previouslyAnalyzed: number === 2,
        })),
        recommendedGameIds: ["game-3", "game-2", "game-1"],
      },
      {
        agentProfileId: "agent-2",
        name: "Mira",
        currentRevisionId: "revision-mira-01",
        strategyStyle: null,
        qualifyingGameCount: 1,
        games: [{
          gameId: "game-4",
          slug: "game-04",
          playerId: "player-4",
          completionAt: "2026-08-04T12:00:00.000Z",
          analyticalRevisionId: "revision-mira-01",
          transcriptCaptureVersion: 2,
          cognitiveArtifactCaptureVersion: 1,
          previouslyAnalyzed: false,
        }],
        recommendedGameIds: ["game-4"],
      },
    ],
    recommendedAgentProfileId: "agent-1",
    prompt: { threshold: 1, prominent: false, suppressedByDismissal: false },
    openReview: null,
    mcp: { connectionState: "not_connected", requiredScopesVersion: "owner-learning-v1" },
    ...overrides,
  };
}

function preflightFixture(
  track: "awaiting_evidence" | "evidence_rich" | "strategy_health_check",
  status: OwnerLearningPreflight["status"] = track === "awaiting_evidence" ? "awaiting_evidence" : "ready",
): OwnerLearningPreflight {
  return {
    status,
    selection: {
      agentProfileId: "agent-1",
      agentProfileName: "Atlas",
      reviewedRevisionId: "revision-atlas-01",
      gameIds: ["game-1", "game-2", "game-3"],
    },
    evidence: {
      analysisTrack: track,
      games: [1, 2, 3].map((number) => ({
        gameId: `game-${number}`,
        canonicalFacts: canonicalFacts(`game-0${number}`, number),
        candidateMoments: [],
        narrativeCoverage: track === "awaiting_evidence" ? "thin" : "rich",
        sourceHash: `source-${number}`,
        sourceCaptureVersion: "capture-v1",
      })),
    },
  };
}

function canonicalFacts(slug: string, placement: number) {
  return {
    game: { id: slug, slug, playerCount: 6, roundCount: 4 },
    reviewedPlayer: { placement, status: placement === 1 ? "winner" : "eliminated", readableSummary: `Placed ${placement} after four rounds.` },
    actionsByAgent: { votesCastByRound: [{ round: 1, empowerTarget: { name: "Mira" }, exposeTarget: { name: "Rune" } }], councilVotesCast: [], powersUsed: [] },
    actionsAgainstAgent: { empowerVotesReceivedByRound: [{ round: 1, votes: 2 }], exposeVotesReceivedByRound: [], councilVotesReceived: [], timesNominated: [], shieldsReceived: [] },
  };
}
