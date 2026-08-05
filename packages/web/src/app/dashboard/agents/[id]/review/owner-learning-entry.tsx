"use client";

import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
import type {
  OwnerLearningEligibleInputs,
  OwnerLearningPreflight,
  SavedAgent,
} from "@/lib/api";
import {
  activityRows,
  canonicalFacts,
  formatAvailabilityTimestamp,
  selectedPreflightGame,
} from "./owner-learning-model";

interface OwnerLearningEntryViewProps {
  eligible: OwnerLearningEligibleInputs;
  agent: SavedAgent | null;
  selectedProfileId: string;
  selectedGameIds: string[];
  preflight: OwnerLearningPreflight | null;
  preflightPending: boolean;
  startPending: boolean;
  notice: string | null;
  onChangeProfile: (profileId: string) => void;
  onToggleGame: (gameId: string) => void;
  onStart: () => void;
  onDismiss?: () => void;
}

export function OwnerLearningEntryView({
  eligible,
  agent,
  selectedProfileId,
  selectedGameIds,
  preflight,
  preflightPending,
  startPending,
  notice,
  onChangeProfile,
  onToggleGame,
  onStart,
  onDismiss,
}: OwnerLearningEntryViewProps) {
  const profile = eligible.profiles.find((entry) => entry.agentProfileId === selectedProfileId)
    ?? eligible.profiles[0]
    ?? null;
  if (!profile) {
    return (
      <section className="olm-empty" data-testid="owner-learning-empty">
        <p className="olm-kicker">Agent review</p>
        <h1>No eligible Daily Free games yet.</h1>
        <p>Once one of your agents completes ranked play, its accepted game facts can anchor a private strategy review.</p>
        <Link href="/games/free" className="olm-button olm-button-primary">Enter Influence Queue</Link>
      </section>
    );
  }

  const facts = selectedGameIds.flatMap((gameId) => {
    const game = selectedPreflightGame(preflight, gameId);
    return game ? [canonicalFacts(game.canonicalFacts)] : [];
  });
  const decisions = facts.reduce((total, game) => total + activityRows(game).length, 0);
  const finals = facts.filter((game) =>
    game.reviewedPlayer.won
    || game.reviewedPlayer.status === "finalist"
    || (game.reviewedPlayer.placement != null && game.reviewedPlayer.placement <= 2)
  ).length;
  const pressure = facts.reduce((total, game) => total
    + sumVotes(game.actionsAgainstAgent.empowerVotesReceivedByRound)
    + sumVotes(game.actionsAgainstAgent.exposeVotesReceivedByRound)
    + sumVotes(game.actionsAgainstAgent.councilVotesReceived), 0);
  const startState = startAvailability(eligible, preflight, selectedGameIds, preflightPending);

  return (
    <div className="olm-enter" data-testid="owner-learning-entry">
      <nav className="olm-crumbs" aria-label="Breadcrumb">
        <Link href="/dashboard">Dashboard</Link><span>/</span>
        <Link href="/dashboard/agents">Agents</Link><span>/</span>
        <span>{profile.name}</span>
      </nav>

      <header className="olm-agent-head">
        <div className="olm-agent-identity">
          <div className="olm-avatar-frame">
            <AgentAvatar
              avatarUrl={agent?.avatarUrl}
              personaKey={agent?.personaKey}
              persona={agent?.personaKey ?? "strategic"}
              name={profile.name}
              size="16"
            />
          </div>
          <div>
            <p className="olm-kicker">Agent review</p>
            <h1>{profile.name}</h1>
            <p>Current analytical revision · {shortRevision(profile.currentRevisionId)}</p>
          </div>
        </div>
        <span className="olm-credit"><i aria-hidden="true" />{reviewCreditLabel(eligible)}</span>
      </header>

      <div className="olm-entry-hero">
        <section className="olm-hero-copy" aria-labelledby="olm-entry-title">
          <h2 id="olm-entry-title">See what the room learned about <em>{profile.name}.</em></h2>
          <p>{profile.name} has {profile.qualifyingGameCount} eligible game{profile.qualifyingGameCount === 1 ? "" : "s"} on this strategy. Choose up to three; the review will connect accepted game facts to a focused next revision.</p>
          {eligible.profiles.length > 1 && (
            <label className="olm-agent-switcher">
              <span>Change agent</span>
              <select value={profile.agentProfileId} onChange={(event) => onChangeProfile(event.target.value)}>
                {eligible.profiles.map((entry) => (
                  <option key={entry.agentProfileId} value={entry.agentProfileId}>{entry.name}</option>
                ))}
              </select>
            </label>
          )}
        </section>

        <aside className="olm-decision-panel" aria-label="Start agent review">
          <p className="olm-panel-label">Private owner review</p>
          <h2>Review {selectedGameIds.length} selected game{selectedGameIds.length === 1 ? "" : "s"}</h2>
          <p>{startState.detail}</p>
          {notice && <p className="olm-notice" role="status">{notice}</p>}
          <div className="olm-button-row">
            <button
              type="button"
              className="olm-button olm-button-primary"
              disabled={!startState.available || startPending}
              onClick={onStart}
            >
              {startPending
                ? eligible.credit.mode === "unlimited" ? "Starting review…" : "Purchasing review…"
                : `Start ${selectedGameIds.length}-game review`}
              <span aria-hidden="true">→</span>
            </button>
            {onDismiss && (
              <button type="button" className="olm-button olm-button-quiet" onClick={onDismiss}>Not now</button>
            )}
          </div>
          <p className="olm-purchase-copy">{eligible.credit.mode === "unlimited"
            ? "Sysop testing is unlimited. Once started, the review remains open until it is resolved. Nothing changes until you approve an update."
            : "Starting uses your one review credit. Once started, it cannot be cancelled. Nothing changes until you approve an update."}</p>
        </aside>
      </div>

      <section className="olm-fact-strip" aria-label="Selected game facts">
        <Fact value={String(profile.qualifyingGameCount)} label="Eligible games in this strategy family" />
        <Fact value={preflightPending ? "…" : String(finals)} label="Final appearances selected" />
        <Fact value={preflightPending ? "…" : String(pressure)} label="Recorded votes received" />
        <Fact value={preflightPending ? "…" : String(decisions)} label="Action and counterplay rows" />
      </section>

      <section className="olm-section" aria-labelledby="olm-games-title">
        <div className="olm-section-head">
          <h2 id="olm-games-title">Choose 1–3 games</h2>
          <span>{selectedGameIds.length} selected · {preflightPending ? "refreshing recorded facts" : "recorded facts available now"}</span>
        </div>
        <div className="olm-filmstrip">
          {profile.games.map((game) => {
            const selected = selectedGameIds.includes(game.gameId);
            const projected = selectedPreflightGame(preflight, game.gameId);
            const gameFacts = projected ? canonicalFacts(projected.canonicalFacts) : null;
            return (
              <button
                type="button"
                key={game.gameId}
                className="olm-game"
                data-selected={selected}
                aria-pressed={selected}
                onClick={() => onToggleGame(game.gameId)}
                disabled={!selected && selectedGameIds.length >= 3}
              >
                <span className="olm-game-top">
                  <span>{gameFacts?.game.slug ?? game.slug}</span>
                  <span className={selected ? "olm-selected" : "olm-analyzed"}>
                    {selected ? "Selected" : game.previouslyAnalyzed ? "Previously analyzed" : "Select"}
                  </span>
                </span>
                <strong>{placement(gameFacts?.reviewedPlayer.placement)}</strong>
                <span className="olm-game-summary">
                  {gameFacts?.reviewedPlayer.readableSummary ?? formatGameDate(game.completionAt)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {preflight?.status === "awaiting_evidence" && (
        <section className="olm-state-message" data-tone="signal" role="status">
          <strong>More evidence is needed before strategic analysis.</strong>
          <p>These early exits are useful game facts, but one or two thin games cannot support a responsible strategy diagnosis. Select a later game or return after another Daily Free match.</p>
        </section>
      )}
      {preflight?.evidence.analysisTrack === "strategy_health_check" && (
        <section className="olm-state-message" data-tone="danger" role="status">
          <strong>Strategy Health Check</strong>
          <p>Three selected games ended in rounds one or two. This review will treat the pattern as a serious strategy audit while keeping observation, interpretation, and guidance distinct.</p>
        </section>
      )}

      <McpEntryCallout />
    </div>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function McpEntryCallout() {
  return (
    <aside className="olm-mcp-inline" aria-label="MCP connection">
      <div className="olm-mcp-copy"><span>MCP</span><div>
        <strong>Prefer to improve agents with your own AI?</strong>
        <p>Connect Influence MCP for deeper questions, authorized game lookup, and agent updates from your assistant.</p>
      </div></div>
      <Link href="/get-mcp" className="olm-text-link">Connect Influence MCP →</Link>
    </aside>
  );
}

function startAvailability(
  eligible: OwnerLearningEligibleInputs,
  preflight: OwnerLearningPreflight | null,
  selectedGameIds: string[],
  pending: boolean,
): { available: boolean; detail: string } {
  if (selectedGameIds.length === 0) return { available: false, detail: "Choose at least one Daily Free game." };
  if (eligible.credit.mode === "metered" && eligible.credit.balance === 0 && !eligible.credit.nextAvailableAt) {
    return { available: false, detail: "Your next review credit arrives after another Daily Free game." };
  }
  if (eligible.credit.mode === "metered" && eligible.credit.balance === 0 && eligible.credit.nextAvailableAt) {
    return {
      available: false,
      detail: `Your next review can start ${formatAvailabilityTimestamp(eligible.credit.nextAvailableAt)}. Your selected facts stay here.`,
    };
  }
  if (pending || !preflight) return { available: false, detail: "Loading the accepted actions and counterplay first." };
  if (preflight.status === "generation_unavailable") {
    return { available: false, detail: "Strategic review is temporarily unavailable. Your credit has not been used." };
  }
  if (preflight.status === "awaiting_evidence") {
    return { available: false, detail: "The selected early exits do not yet contain enough evidence for paid analysis." };
  }
  return eligible.credit.mode === "unlimited"
    ? { available: true, detail: "Recorded actions and counterplay are ready. Starting opens the private sysop analysis." }
    : { available: true, detail: "Recorded actions and counterplay are ready. Purchasing starts the private analysis." };
}

function reviewCreditLabel(eligible: OwnerLearningEligibleInputs): string {
  if (eligible.credit.mode === "unlimited") return "Unlimited sysop reviews";
  if (eligible.credit.balance === 1) return "1 review credit available";
  if (eligible.credit.nextAvailableAt) {
    return `0 review credits · next ${formatAvailabilityTimestamp(eligible.credit.nextAvailableAt)}`;
  }
  return "0 review credits";
}

function placement(value: number | null | undefined): string {
  if (value == null) return "Result recorded";
  const suffix = value % 10 === 1 && value % 100 !== 11
    ? "st"
    : value % 10 === 2 && value % 100 !== 12
      ? "nd"
      : value % 10 === 3 && value % 100 !== 13
        ? "rd"
        : "th";
  return `${value}${suffix}`;
}

function sumVotes(rows: Array<Record<string, unknown>>): number {
  return rows.reduce((total, row) => total + (typeof row.votes === "number" ? row.votes : 0), 0);
}

function shortRevision(revisionId: string): string {
  return revisionId.length > 12 ? revisionId.slice(0, 8) : revisionId;
}

function formatGameDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}
