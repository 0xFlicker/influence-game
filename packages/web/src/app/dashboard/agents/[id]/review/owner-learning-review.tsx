"use client";

import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
import type { OwnerLearningReview, SavedAgent } from "@/lib/api";
import { recordOwnerLearningManualEditorOpened } from "@/lib/api";
import {
  OWNER_LEARNING_STAGES,
  activityRows,
  canonicalFacts,
  recommendationSupportLabel,
  stageIndex,
} from "./owner-learning-model";

interface OwnerLearningReviewViewProps {
  review: OwnerLearningReview;
  agent: SavedAgent | null;
  activeGameId: string;
  pendingAction: "retry" | "apply" | "resolve" | null;
  notice: string | null;
  mcpConnectionState: "connected" | "not_connected";
  onSelectGame: (gameId: string) => void;
  onRetry: () => void;
  onApply: () => void;
  onResolve: (resolution: "declined" | "failed") => void;
}

export function OwnerLearningReviewView({
  review,
  agent,
  activeGameId,
  pendingAction,
  notice,
  mcpConnectionState,
  onSelectGame,
  onRetry,
  onApply,
  onResolve,
}: OwnerLearningReviewViewProps) {
  const activeEvidence = review.evidence.games.find((game) => game.gameId === activeGameId)
    ?? review.evidence.games[0]
    ?? null;
  const activeFacts = canonicalFacts(activeEvidence?.canonicalFacts);
  const rows = activityRows(activeFacts);
  const running = review.resolution == null
    && (review.analysisStatus === "queued" || review.analysisStatus === "running");
  const ready = review.analysisStatus === "ready" && review.result != null;
  const noChange = review.analysisStatus === "no_change" && review.result != null;
  const failed = review.analysisStatus === "failed" && review.resolution == null;
  const isHealthCheck = review.analysisTrack === "strategy_health_check";

  return (
    <div className="olm-enter" data-testid="owner-learning-review" data-review-status={review.analysisStatus}>
      <nav className="olm-crumbs" aria-label="Breadcrumb">
        <Link href="/dashboard">Dashboard</Link><span>/</span>
        <Link href="/dashboard/agents">Agents</Link><span>/</span>
        <Link href={`/dashboard/agents/${encodeURIComponent(review.agentProfileId)}`}>{agent?.name ?? "Agent"}</Link><span>/</span>
        <span>Review</span>
      </nav>

      <header className="olm-review-head">
        <div className="olm-agent-identity">
          <div className="olm-avatar-frame olm-avatar-compact">
            <AgentAvatar
              avatarUrl={agent?.avatarUrl}
              personaKey={agent?.personaKey}
              persona={agent?.personaKey ?? "strategic"}
              name={agent?.name ?? "Agent"}
              size="12"
            />
          </div>
          <div>
            <p className="olm-kicker">Owner review · {shortRevision(review.reviewedRevisionId)}</p>
            <h1>{reviewHeading(review, agent?.name ?? "Agent")}</h1>
            <p>{review.selectedGameIds.length} selected game{review.selectedGameIds.length === 1 ? "" : "s"} · {trackLabel(review.analysisTrack)}</p>
          </div>
        </div>
        <ReviewStatus review={review} />
      </header>

      {review.resolution && <ResolutionBanner review={review} />}
      {notice && <p className="olm-notice olm-review-notice" role="status">{notice}</p>}

      <div className={running ? "olm-review-grid" : "olm-review-grid olm-review-grid-wide"}>
        <div className="olm-evidence-workspace">
          <div className="olm-game-tabs" role="tablist" aria-label="Selected games">
            {review.evidence.games.map((game, index) => {
              const facts = canonicalFacts(game.canonicalFacts);
              return (
                <button
                  type="button"
                  role="tab"
                  aria-selected={game.gameId === activeEvidence?.gameId}
                  key={game.gameId}
                  onClick={() => onSelectGame(game.gameId)}
                >
                  <span>Game {index + 1}</span>
                  <strong>{facts.game.slug ?? shortGame(game.gameId)}</strong>
                </button>
              );
            })}
          </div>

          {activeEvidence ? (
            <section className="olm-fact-callout">
              <div className="olm-fact-number">
                {placement(activeFacts.reviewedPlayer.placement)}
                <span>{activeFacts.reviewedPlayer.status ?? "recorded result"}</span>
              </div>
              <p>
                {activeFacts.reviewedPlayer.readableSummary ?? "The accepted result and action ledger are available for this game."}
                <small>Accepted actions, votes, powers, and results—not generated analysis.</small>
              </p>
            </section>
          ) : null}

          <div className="olm-activity" aria-label="Accepted action timeline">
            {rows.length === 0 ? (
              <p className="olm-timeline-empty">No action rows were recorded for this game. The accepted result remains available above.</p>
            ) : rows.map((row) => (
              <div className="olm-activity-row" key={row.id}>
                <div className="olm-round">{row.round == null ? "Game" : `Round ${row.round}`}</div>
                <div><strong>{row.action}</strong><span>{row.actionDetail}</span></div>
                <div className="olm-arrow" aria-hidden="true">→</div>
                <div className="olm-response"><strong>{row.counterplay}</strong><span>{row.counterplayDetail}</span></div>
                <span className="olm-result-tag">{row.result}</span>
              </div>
            ))}
          </div>

        </div>

        {running && (
          <AnalysisRail review={review} mcpConnectionState={mcpConnectionState} />
        )}
      </div>

      {(ready || noChange) && review.result && (
        <>
          <section className="olm-verdict" aria-labelledby="olm-verdict-title">
            <h2 id="olm-verdict-title">{isHealthCheck ? "Strategy health check" : "What changed in the room"}</h2>
            <div className="olm-verdict-body">
              <p className="olm-verdict-copy">{review.result.diagnosis}</p>
              <p className="olm-verdict-support">{diagnosisSupport(review)}</p>
              <div className="olm-confidence">
                <span><i aria-hidden="true" />{isHealthCheck ? "Three-game remedial review" : `${review.selectedGameIds.length}-game evidence set`}</span>
              </div>
            </div>
          </section>

          {review.result.recommendations.length > 0 && (
            <section className="olm-recommendations" aria-labelledby="olm-recommendations-title">
              <h2 id="olm-recommendations-title">Recommended changes</h2>
              {review.result.recommendations.map((recommendation, index) => (
                <article
                  className="olm-recommendation"
                  data-disposition={recommendation.disposition}
                  key={recommendation.id ?? recommendation.title}
                  tabIndex={-1}
                >
                  <div className="olm-rec-index">{String(index + 1).padStart(2, "0")}</div>
                  <div>
                    <h3>{recommendation.title}</h3>
                    <p>{recommendation.rationale}</p>
                    {recommendation.keepGuidance && <p className="olm-keep-guidance"><strong>Keep:</strong> {recommendation.keepGuidance}</p>}
                    {isHealthCheck && recommendation.proof && (
                      <div className="olm-proof">
                        <div><span>Observed evidence</span><p>{recommendation.proof.observedEvidence}</p></div>
                        <div><span>Strategic interpretation</span><p>{recommendation.proof.strategicInterpretation}</p></div>
                        <div><span>Proposed guidance</span><p>{recommendation.proof.proposedGuidance}</p></div>
                      </div>
                    )}
                  </div>
                  <aside className="olm-rec-evidence">
                    <span>{recommendationSupportLabel(recommendation)}</span>
                  </aside>
                </article>
              ))}
            </section>
          )}

          {noChange && (
            <section className="olm-state-message" data-tone="success">
              <strong>No strategy update recommended.</strong>
              <p>{review.result.noChange?.rationale ?? "The selected evidence does not support a focused strategy change."}</p>
            </section>
          )}

          {ready && review.result.proposal && !review.resolution && (
            <section className="olm-update-dock" aria-labelledby="olm-update-title">
              <header><div>
                <h2 id="olm-update-title">Proposed strategy update</h2>
                <p>A focused change to strategy guidance. Persona, model, and backstory stay untouched.</p>
              </div><span>Not applied</span></header>
              <div className="olm-diff" aria-label="Proposed strategy changes">
                <div className="olm-minus">− {review.result.proposal.before}</div>
                <div className="olm-plus">+ {review.result.proposal.after}</div>
              </div>
              <footer>
                <p>Applying creates a new revision. Future games use it immediately.</p>
                <Link
                  href={`/dashboard/agents/${encodeURIComponent(review.agentProfileId)}/edit?sourceReviewId=${encodeURIComponent(review.id)}`}
                  className="olm-button olm-button-secondary"
                  onClick={() => { void recordOwnerLearningManualEditorOpened(review.id); }}
                >Edit changes myself</Link>
                <button
                  type="button"
                  className="olm-button olm-button-quiet"
                  disabled={pendingAction != null}
                  onClick={() => onResolve("declined")}
                >{pendingAction === "resolve" ? "Keeping…" : "Keep current strategy"}</button>
                <button
                  type="button"
                  className="olm-button olm-button-primary"
                  disabled={pendingAction != null || !review.proposalFingerprint}
                  onClick={onApply}
                >{pendingAction === "apply" ? "Applying…" : "Apply strategy update"}</button>
              </footer>
            </section>
          )}
        </>
      )}

      {failed && (
        <section className="olm-failure" role="status">
          <p className="olm-kicker">Review interrupted</p>
          <h2>The game facts are safe. Strategic analysis did not finish.</h2>
          <p>{failureMessage(review.safeFailureCode)} Resolving the failure closes this review. Any credit used to start a metered review is not refunded.</p>
          <div className="olm-button-row">
            {review.retryable && review.logicalCallCount < 4 && (
              <button type="button" className="olm-button olm-button-primary" onClick={onRetry} disabled={pendingAction != null}>
                {pendingAction === "retry" ? "Retrying…" : "Retry analysis"}
              </button>
            )}
            <button type="button" className="olm-button olm-button-secondary" onClick={() => onResolve("failed")} disabled={pendingAction != null}>
              {pendingAction === "resolve" ? "Resolving…" : "Resolve failed review"}
            </button>
          </div>
        </section>
      )}

      {(running || ready) && <McpReviewCallout review={review} connectionState={mcpConnectionState} />}
    </div>
  );
}

function AnalysisRail({ review, mcpConnectionState }: {
  review: OwnerLearningReview;
  mcpConnectionState: "connected" | "not_connected";
}) {
  const active = stageIndex(review.stage);
  return (
    <aside className="olm-analysis-rail" aria-label="Analysis progress">
      <p className="olm-rail-kicker">AI review in progress</p>
      <h2>Finding the change worth making</h2>
      <p>The reviewer is comparing repeated choices, room responses, and outcomes.</p>
      <div className="olm-progress-track" data-progress={active} aria-hidden="true"><div /></div>
      <div className="olm-progress-meta"><span>{stageTitle(review.stage)}</span><span>Progress is saved</span></div>
      <ol className="olm-steps">
        {OWNER_LEARNING_STAGES.map((entry, index) => (
          <li key={entry.stage} data-state={index < active ? "done" : index === active ? "active" : "pending"}>
            <strong>{entry.label}</strong><span>{entry.detail}</span>
          </li>
        ))}
      </ol>
      <div className="olm-rail-divider" />
      <div className="olm-mcp-rail">
        <strong>{mcpConnectionState === "connected" ? "Continue with your AI" : "Want a deeper conversation?"}</strong>
        <p>{mcpConnectionState === "connected"
          ? "Ask your connected assistant to list open learning reviews."
          : "Influence MCP lets your own AI inspect these games, ask follow-ups, and update your agent with you."}</p>
      </div>
    </aside>
  );
}

function McpReviewCallout({ review, connectionState }: {
  review: OwnerLearningReview;
  connectionState: "connected" | "not_connected";
}) {
  const returnTo = `/dashboard/agents/${encodeURIComponent(review.agentProfileId)}/review/${encodeURIComponent(review.id)}`;
  return (
    <aside className="olm-mcp-inline" aria-label="MCP deeper analysis">
      <div className="olm-mcp-copy"><span>MCP</span><div>
        <strong>{connectionState === "connected" ? "Interrogate this review with your own AI" : "Take this review deeper with your own AI"}</strong>
        <p>{connectionState === "connected"
          ? "Ask your assistant to list open learning reviews, then inspect this review by ID."
          : "Connect Influence MCP, return here, and ask your assistant to list open learning reviews."}</p>
      </div></div>
      {connectionState === "connected"
        ? <span className="olm-connected">MCP connected</span>
        : <Link href={`/get-mcp?returnTo=${encodeURIComponent(returnTo)}`} className="olm-text-link">Connect Influence MCP →</Link>}
    </aside>
  );
}

function ReviewStatus({ review }: { review: OwnerLearningReview }) {
  if (review.resolution) return <div className="olm-ready-marker">✓ {resolutionTitle(review.resolution)}</div>;
  if (review.analysisStatus === "ready" || review.analysisStatus === "no_change") {
    return <div className="olm-ready-marker">✓ Analysis complete</div>;
  }
  if (review.analysisStatus === "failed") return <div className="olm-live-status olm-status-failed"><i /> Review interrupted</div>;
  return <div className="olm-live-status"><i /> {stageTitle(review.stage)}</div>;
}

function ResolutionBanner({ review }: { review: OwnerLearningReview }) {
  const copy: Record<NonNullable<OwnerLearningReview["resolution"]>, string> = {
    applied: "The proposed strategy was applied.",
    manual_update: "You completed a linked manual update. The generated proposal was not marked accepted.",
    declined: "You chose to keep the current strategy. The proposal remains here as review history.",
    no_change: "The review found no focused strategy update to make.",
    failed: "You resolved an unfinished failed review. Its purchase was not refunded.",
    superseded: "A newer update to this agent won. This proposal is preserved but can no longer be applied.",
  };
  return <section className="olm-resolution-banner" data-resolution={review.resolution}><strong>{resolutionTitle(review.resolution!)}</strong><p>{copy[review.resolution!]}</p></section>;
}

function reviewHeading(review: OwnerLearningReview, name: string): string {
  if (review.resolution) return `${name}'s review is resolved`;
  if (review.analysisStatus === "ready") return `${name}'s review is ready`;
  if (review.analysisStatus === "no_change") return `${name}'s strategy holds up`;
  if (review.analysisStatus === "failed") return `${name}'s review was interrupted`;
  return `Reviewing ${review.selectedGameIds.length} game${review.selectedGameIds.length === 1 ? "" : "s"} with ${name}`;
}

function diagnosisSupport(review: OwnerLearningReview): string {
  if (review.analysisTrack === "strategy_health_check") {
    const classification = review.result?.strategyHealthClassification;
    if (classification === "guidance_gap") return "The observed pattern is supported by a specific gap in the current strategy guidance.";
    if (classification === "execution_gap") return "The current guidance is usable, but the selected games show the agent did not execute it consistently.";
    return "The selected games show a serious pattern without enough proof to blame one strategy instruction.";
  }
  return "The diagnosis is generated from the selected games shown above.";
}

function stageTitle(stage: OwnerLearningReview["stage"]): string {
  const item = OWNER_LEARNING_STAGES.find((entry) => entry.stage === stage);
  return item?.label ?? "Analysis complete";
}

function trackLabel(track: OwnerLearningReview["analysisTrack"]): string {
  return track === "strategy_health_check" ? "Strategy Health Check" : "Evidence-rich review";
}

function resolutionTitle(resolution: NonNullable<OwnerLearningReview["resolution"]>): string {
  const labels = {
    applied: "Strategy update applied",
    manual_update: "Manual update completed",
    declined: "Current strategy kept",
    no_change: "No change recommended",
    failed: "Failed review resolved",
    superseded: "Review superseded",
  } satisfies Record<NonNullable<OwnerLearningReview["resolution"]>, string>;
  return labels[resolution];
}

function failureMessage(code: string | null): string {
  const messages: Record<string, string> = {
    provider_capacity_exhausted: "Review capacity remained unavailable after the bounded fallback.",
    provider_timeout: "The reviewer did not finish within the allowed time.",
    provider_error: "The reviewer returned a provider error.",
    invalid_structured_output: "The reviewer did not return a valid evidence-backed result.",
    tier_mismatch: "The requested processing tier could not be verified.",
    output_budget_exhausted: "The review reached its output budget before a valid result.",
    logical_call_budget_exhausted: "The review used its four logical calls without a valid result.",
    evidence_unavailable: "The selected evidence could not be reauthorized.",
    worker_interrupted: "The review worker stopped before completion.",
  };
  return code ? messages[code] ?? "The review stopped safely." : "The review stopped safely.";
}

function placement(value: number | null | undefined): string {
  return value == null ? "—" : `#${value}`;
}

function shortGame(value: string): string {
  return value.length > 12 ? value.slice(0, 8) : value;
}

function shortRevision(value: string): string {
  return value.length > 12 ? `Revision ${value.slice(0, 8)}` : `Revision ${value}`;
}
