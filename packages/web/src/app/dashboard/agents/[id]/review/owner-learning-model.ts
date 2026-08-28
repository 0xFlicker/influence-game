import type {
  OwnerLearningPreflight,
  OwnerLearningRecommendation,
  OwnerLearningReviewStatus,
  OwnerLearningStage,
} from "@/lib/api";

export const OWNER_LEARNING_STAGES: Array<{
  stage: OwnerLearningStage;
  label: string;
  detail: string;
}> = [
  {
    stage: "evidence_ready",
    label: "Game records loaded",
    detail: "Results, actions, votes, and powers",
  },
  {
    stage: "scanning_narratives",
    label: "Decisions mapped",
    detail: "Pairing choices with the room's counterplay",
  },
  {
    stage: "investigating_moments",
    label: "Repeated patterns compared",
    detail: "Checking the moments most likely to matter",
  },
  {
    stage: "drafting_recommendations",
    label: "Focused update drafted",
    detail: "At most three evidence-backed recommendations",
  },
];

export interface OwnerLearningCanonicalFacts {
  game: {
    id?: string;
    slug?: string;
    completionAt?: string;
    roundCount?: number;
    playerCount?: number;
  };
  reviewedPlayer: {
    placement?: number | null;
    status?: string;
    won?: boolean;
    eliminatedRound?: number | null;
    readableSummary?: string;
  };
  actionsByAgent: {
    votesCastByRound: Array<Record<string, unknown>>;
    formatBallotsCastByRound: Array<Record<string, unknown>>;
    councilVotesCast: Array<Record<string, unknown>>;
    powersUsed: Array<Record<string, unknown>>;
  };
  actionsAgainstAgent: {
    empowerVotesReceivedByRound: Array<Record<string, unknown>>;
    exposeVotesReceivedByRound: Array<Record<string, unknown>>;
    councilVotesReceived: Array<Record<string, unknown>>;
    timesNominated: Array<Record<string, unknown>>;
    shieldsReceived: Array<Record<string, unknown>>;
  };
}

export interface OwnerLearningActivityRow {
  id: string;
  round: number | null;
  action: string;
  actionDetail: string | null;
  counterplay: string;
  counterplayDetail: string;
  result: string;
}

export function reviewPath(agentProfileId: string, reviewId: string): string {
  return `/dashboard/agents/${encodeURIComponent(agentProfileId)}/review/${encodeURIComponent(reviewId)}`;
}

export function reviewEntryPath(agentProfileId: string): string {
  return `/dashboard/agents/${encodeURIComponent(agentProfileId)}/review`;
}

export function formatAvailabilityTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function stageIndex(stage: OwnerLearningStage): number {
  if (stage === "complete") return OWNER_LEARNING_STAGES.length;
  return Math.max(0, OWNER_LEARNING_STAGES.findIndex((entry) => entry.stage === stage));
}

export function isReviewPolling(review: OwnerLearningReviewStatus): boolean {
  return review.resolution == null
    && (
      review.analysisStatus === "queued"
      || review.analysisStatus === "retry_queued"
      || review.analysisStatus === "running"
    );
}

export function canonicalFacts(value: unknown): OwnerLearningCanonicalFacts {
  const object = record(value);
  const game = record(object.game);
  const reviewedPlayer = record(object.reviewedPlayer);
  const actionsByAgent = record(object.actionsByAgent);
  const actionsAgainstAgent = record(object.actionsAgainstAgent);
  return {
    game: {
      id: optionalString(game.id),
      slug: optionalString(game.slug),
      completionAt: optionalString(game.completionAt),
      roundCount: finiteNumber(game.roundCount) ?? undefined,
      playerCount: finiteNumber(game.playerCount) ?? undefined,
    },
    reviewedPlayer: {
      placement: finiteNumber(reviewedPlayer.placement),
      status: optionalString(reviewedPlayer.status),
      won: typeof reviewedPlayer.won === "boolean" ? reviewedPlayer.won : undefined,
      eliminatedRound: finiteNumber(reviewedPlayer.eliminatedRound),
      readableSummary: optionalString(reviewedPlayer.readableSummary),
    },
    actionsByAgent: {
      votesCastByRound: records(actionsByAgent.votesCastByRound),
      formatBallotsCastByRound: records(actionsByAgent.formatBallotsCastByRound),
      councilVotesCast: records(actionsByAgent.councilVotesCast),
      powersUsed: records(actionsByAgent.powersUsed),
    },
    actionsAgainstAgent: {
      empowerVotesReceivedByRound: records(actionsAgainstAgent.empowerVotesReceivedByRound),
      exposeVotesReceivedByRound: records(actionsAgainstAgent.exposeVotesReceivedByRound),
      councilVotesReceived: records(actionsAgainstAgent.councilVotesReceived),
      timesNominated: records(actionsAgainstAgent.timesNominated),
      shieldsReceived: records(actionsAgainstAgent.shieldsReceived),
    },
  };
}

export function activityRows(facts: OwnerLearningCanonicalFacts): OwnerLearningActivityRow[] {
  const rows: OwnerLearningActivityRow[] = [];
  const empowerByRound = numberByRound(facts.actionsAgainstAgent.empowerVotesReceivedByRound, "votes");
  const exposeByRound = numberByRound(facts.actionsAgainstAgent.exposeVotesReceivedByRound, "votes");
  const councilByRound = numberByRound(facts.actionsAgainstAgent.councilVotesReceived, "votes");
  const formatBallotByRound = recordByRound(facts.actionsByAgent.formatBallotsCastByRound);
  const voteRounds = new Set<number>();

  for (const vote of facts.actionsByAgent.votesCastByRound) {
    const round = finiteNumber(vote.round);
    if (round != null) voteRounds.add(round);
    const empower = playerName(vote.empowerTarget);
    const expose = playerName(vote.exposeTarget);
    const formatBallot = round == null ? null : formatBallotByRound.get(round) ?? null;
    const received = (round == null ? 0 : empowerByRound.get(round) ?? 0)
      + (round == null ? 0 : exposeByRound.get(round) ?? 0);
    rows.push({
      id: `vote-${round ?? rows.length}`,
      round,
      action: empower ? `Backed ${empower}` : "Submitted a round vote",
      actionDetail: expose ? `Exposed ${expose}` : formatBallotLabel(formatBallot),
      counterplay: received > 0 ? `${received} vote${received === 1 ? "" : "s"} landed in return` : "No vote pressure landed in return",
      counterplayDetail: round == null ? "Accepted vote ledger" : `Accepted round ${round} tally`,
      result: received > 0 ? "pressure" : "clear",
    });
  }

  for (const ballot of facts.actionsByAgent.formatBallotsCastByRound) {
    const round = finiteNumber(ballot.round);
    if (round != null && voteRounds.has(round)) continue;
    const received = (round == null ? 0 : empowerByRound.get(round) ?? 0)
      + (round == null ? 0 : exposeByRound.get(round) ?? 0);
    rows.push({
      id: `format-${round ?? rows.length}`,
      round,
      action: formatBallotLabel(ballot) ?? "Submitted a format ballot",
      actionDetail: null,
      counterplay: received > 0 ? `${received} vote${received === 1 ? "" : "s"} landed in return` : "No vote pressure landed in return",
      counterplayDetail: round == null ? "Accepted format ballot" : `Accepted round ${round} tally`,
      result: received > 0 ? "pressure" : "clear",
    });
  }

  for (const vote of facts.actionsByAgent.councilVotesCast) {
    const round = finiteNumber(vote.round);
    const received = round == null ? 0 : councilByRound.get(round) ?? 0;
    rows.push({
      id: `council-${round ?? rows.length}`,
      round,
      action: `Council vote${playerName(vote.target) ? ` against ${playerName(vote.target)}` : " cast"}`,
      actionDetail: "Accepted council decision",
      counterplay: received > 0 ? `${received} council vote${received === 1 ? "" : "s"} came back` : "No council vote came back",
      counterplayDetail: "Resolved council ledger",
      result: received > 0 ? "targeted" : "clear",
    });
  }

  for (const power of facts.actionsByAgent.powersUsed) {
    const round = finiteNumber(power.round);
    const action = typeof power.action === "string" ? humanize(power.action) : "power";
    const target = playerName(power.target);
    rows.push({
      id: `power-${round ?? rows.length}-${action}`,
      round,
      action: `Used ${action}${target ? ` on ${target}` : ""}`,
      actionDetail: "Accepted power action",
      counterplay: "The room continued from the resolved effect",
      counterplayDetail: "No outcome is inferred from transcript prose",
      result: "power",
    });
  }

  for (const nomination of facts.actionsAgainstAgent.timesNominated) {
    const round = finiteNumber(nomination.round);
    rows.push({
      id: `nomination-${round ?? rows.length}`,
      round,
      action: "The agent reached the council slate",
      actionDetail: "Canonical nomination record",
      counterplay: nomination.eliminated === true ? "The council eliminated the agent" : "The agent survived the council",
      counterplayDetail: "Resolved elimination state",
      result: nomination.eliminated === true ? "eliminated" : "survived",
    });
  }

  return rows.sort((left, right) => (left.round ?? Number.MAX_SAFE_INTEGER) - (right.round ?? Number.MAX_SAFE_INTEGER));
}

export function recommendationSupportLabel(recommendation: OwnerLearningRecommendation): string {
  if (recommendation.proof?.kind === "prompt_guidance_defect") {
    return "Found in your strategy guidance";
  }
  if (recommendation.proof?.kind === "combined") return "Seen in play and guidance";
  const gameCount = new Set(recommendation.evidenceRefs.map((ref) => ref.gameId)).size;
  return `Seen across ${Math.max(1, gameCount)} game${gameCount === 1 ? "" : "s"}`;
}

export function selectedPreflightGame(
  preflight: OwnerLearningPreflight | null,
  gameId: string,
): OwnerLearningPreflight["evidence"]["games"][number] | null {
  return preflight?.evidence.games.find((game) => game.gameId === gameId) ?? null;
}

function numberByRound(rows: Array<Record<string, unknown>>, key: string): Map<number, number> {
  const map = new Map<number, number>();
  for (const row of rows) {
    const round = finiteNumber(row.round);
    const value = finiteNumber(row[key]);
    if (round != null && value != null) map.set(round, value);
  }
  return map;
}

function recordByRound(rows: Array<Record<string, unknown>>): Map<number, Record<string, unknown>> {
  const map = new Map<number, Record<string, unknown>>();
  for (const row of rows) {
    const round = finiteNumber(row.round);
    if (round != null) map.set(round, row);
  }
  return map;
}

function formatBallotLabel(ballot: Record<string, unknown> | null): string | null {
  if (!ballot) return null;
  const target = playerName(ballot.target);
  if (!target) return null;
  if (ballot.polarity === "save") return `Voted to save ${target}`;
  if (ballot.polarity === "eliminate") return `Voted to exit ${target}`;
  if (ballot.formatId === "vote_bomb") return `The Short List vote against ${target}`;
  if (ballot.formatId === "majority_elimination") {
    return `Highest Count vote against ${target}`;
  }
  if (ballot.formatId === "even_votes") {
    return `Even Votes vote against ${target}`;
  }
  if (ballot.formatId === "safety_bounce") return `Safety Bounce vote against ${target}`;
  return `Format vote against ${target}`;
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function playerName(value: unknown): string | null {
  const player = record(value);
  return typeof player.name === "string" && player.name.trim() ? player.name : null;
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ").toLowerCase();
}
