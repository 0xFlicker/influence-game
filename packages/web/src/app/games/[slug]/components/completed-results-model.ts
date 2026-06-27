import type {
  CompletedGameResultsPlayer,
  CompletedGameResultsPlayerRef,
  CompletedGameResultsRead,
} from "@/lib/api";

export interface CompletedResultsOverview {
  headline: string;
  winnerName: string | null;
  winnerResolution: string;
  finalVoteLabel: string | null;
  roundsPlayed: number;
  playerCount: number;
  detailLabel: string | null;
  degraded: boolean;
}

export interface CompletedResultsTimelineItem {
  playerId: string;
  playerName: string;
  round: number;
  source: string;
  method: string;
}

export interface CompletedResultsVoteColumn {
  id: string;
  label: string;
  shortLabel: string;
  round: number;
  kind: "empower" | "expose" | "council" | "endgame" | "jury";
}

export interface CompletedResultsVoteCell {
  targetId: string | null;
  targetName: string;
  groupKey: string;
  colorClass: string;
}

export interface CompletedResultsVoteRow {
  player: CompletedGameResultsPlayerRef;
  cells: CompletedResultsVoteCell[];
}

export interface CompletedResultsAgentCardModel {
  player: CompletedGameResultsPlayer;
  placementLabel: string;
  votesCast: number;
  votesReceived: number;
  tags: string[];
}

export interface CompletedResultsReviewModel {
  overview: CompletedResultsOverview;
  timeline: CompletedResultsTimelineItem[];
  voteMatrix: {
    columns: CompletedResultsVoteColumn[];
    rows: CompletedResultsVoteRow[];
  };
  agentCards: CompletedResultsAgentCardModel[];
}

const COLOR_CLASSES = [
  "bg-cyan-400/15 text-cyan-100 border-cyan-300/20",
  "bg-emerald-400/15 text-emerald-100 border-emerald-300/20",
  "bg-amber-400/15 text-amber-100 border-amber-300/20",
  "bg-rose-400/15 text-rose-100 border-rose-300/20",
  "bg-violet-400/15 text-violet-100 border-violet-300/20",
  "bg-sky-400/15 text-sky-100 border-sky-300/20",
  "bg-lime-400/15 text-lime-100 border-lime-300/20",
  "bg-fuchsia-400/15 text-fuchsia-100 border-fuchsia-300/20",
];

export function buildCompletedResultsReviewModel(
  results: CompletedGameResultsRead,
): CompletedResultsReviewModel {
  const columns = buildVoteColumns(results);
  const cellLookup = buildCellLookup(results);
  const colorByGroup = new Map<string, string>();
  const rows = results.players.map((player) => ({
    player,
    cells: columns.map((column) => {
      const cell = cellLookup.get(`${column.id}:${player.id}`) ?? {
        targetId: null,
        targetName: "—",
        groupKey: `${column.id}:empty`,
      };
      return {
        ...cell,
        colorClass: colorForGroup(cell.groupKey, colorByGroup),
      };
    }),
  }));

  return {
    overview: {
      headline: results.summary.winner ? `${results.summary.winner.name} won` : "No winner recorded",
      winnerName: results.summary.winner?.name ?? null,
      winnerResolution: winnerResolutionLabel(results.summary.winnerMethod, results.jury.status === "available"),
      finalVoteLabel: finalVoteLabel(results),
      roundsPlayed: results.summary.roundsPlayed,
      playerCount: results.summary.playerCount,
      detailLabel: resultDetailLabel(results),
      degraded: results.availability.status !== "available",
    },
    timeline: results.eliminationOrder.map((entry) => ({
      playerId: entry.player.id,
      playerName: entry.player.name,
      round: entry.round,
      source: labelFromToken(entry.source),
      method: entry.method ? labelFromToken(entry.method) : "Unknown",
    })),
    voteMatrix: { columns, rows },
    agentCards: buildAgentCards(results, rows),
  };
}

function buildVoteColumns(results: CompletedGameResultsRead): CompletedResultsVoteColumn[] {
  const columns: CompletedResultsVoteColumn[] = [];
  for (const round of results.rounds) {
    const facts = round.canonicalFacts.roundFacts;
    if (facts.standardVote.ledger.length > 0) {
      columns.push({ id: `r${round.round}:empower`, label: `Round ${round.round} empower`, shortLabel: `R${round.round} E+`, round: round.round, kind: "empower" });
      columns.push({ id: `r${round.round}:expose`, label: `Round ${round.round} expose`, shortLabel: `R${round.round} X`, round: round.round, kind: "expose" });
    }
    if (facts.council.ledger.length > 0) {
      columns.push({ id: `r${round.round}:council`, label: `Round ${round.round} council`, shortLabel: `R${round.round} C`, round: round.round, kind: "council" });
    }
    round.endgameEliminations.forEach((entry, index) => {
      if (entry.ledger.length > 0) {
        const columnId = endgameColumnId(round.round, entry.stage, index, "vote");
        columns.push({
          id: columnId,
          label: `Round ${round.round} ${entry.stage ? labelFromToken(entry.stage) : `endgame ${index + 1}`}`,
          shortLabel: `R${round.round} EG${round.endgameEliminations.length > 1 ? index + 1 : ""}`,
          round: round.round,
          kind: "endgame",
        });
      }
      if (entry.juryTiebreakerLedger.length === 0) return;
      const columnId = endgameColumnId(round.round, entry.stage, index, "jury-tiebreaker");
      columns.push({
        id: columnId,
        label: `Round ${round.round} ${entry.stage ? labelFromToken(entry.stage) : `endgame ${index + 1}`} jury tiebreaker`,
        shortLabel: `R${round.round} JT${round.endgameEliminations.length > 1 ? index + 1 : ""}`,
        round: round.round,
        kind: "endgame",
      });
    });
  }
  if (results.jury.ledger.length > 0) {
    columns.push({ id: "jury:winner", label: "Jury winner", shortLabel: "Jury", round: results.summary.roundsPlayed, kind: "jury" });
  }
  return columns;
}

function buildCellLookup(results: CompletedGameResultsRead): Map<string, Omit<CompletedResultsVoteCell, "colorClass">> {
  const cells = new Map<string, Omit<CompletedResultsVoteCell, "colorClass">>();
  for (const round of results.rounds) {
    const facts = round.canonicalFacts.roundFacts;
    for (const entry of facts.standardVote.ledger) {
      setCell(cells, `r${round.round}:empower`, entry.voter, entry.empowerTarget);
      setCell(cells, `r${round.round}:expose`, entry.voter, entry.exposeTarget);
    }
    for (const entry of facts.council.ledger) {
      setCell(cells, `r${round.round}:council`, entry.voter, entry.target);
    }
    round.endgameEliminations.forEach((elimination, index) => {
      const voteColumnId = endgameColumnId(round.round, elimination.stage, index, "vote");
      for (const entry of elimination.ledger) {
        setCell(cells, voteColumnId, entry.voter, entry.target);
      }
      const tiebreakerColumnId = endgameColumnId(round.round, elimination.stage, index, "jury-tiebreaker");
      for (const entry of elimination.juryTiebreakerLedger) {
        setCell(cells, tiebreakerColumnId, entry.voter, entry.target);
      }
    });
  }
  for (const entry of results.jury.ledger) {
    setCell(cells, "jury:winner", entry.juror, entry.finalist);
  }
  return cells;
}

function endgameColumnId(round: number, stage: string | null, index: number, ledger: "vote" | "jury-tiebreaker"): string {
  return `r${round}:endgame:${stage ?? "stage"}:${index}:${ledger}`;
}

function setCell(
  cells: Map<string, Omit<CompletedResultsVoteCell, "colorClass">>,
  columnId: string,
  voter: CompletedGameResultsPlayerRef,
  target: CompletedGameResultsPlayerRef,
): void {
  cells.set(`${columnId}:${voter.id}`, {
    targetId: target.id,
    targetName: target.name,
    groupKey: `${columnId}:${target.id}`,
  });
}

function buildAgentCards(
  results: CompletedGameResultsRead,
  rows: readonly CompletedResultsVoteRow[],
): CompletedResultsAgentCardModel[] {
  const received = new Map<string, number>();
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.targetId) received.set(cell.targetId, (received.get(cell.targetId) ?? 0) + 1);
    }
  }
  return results.players.map((player) => {
    const row = rows.find((candidate) => candidate.player.id === player.id);
    return {
      player,
      placementLabel: placementLabel(player),
      votesCast: row?.cells.filter((cell) => cell.targetId).length ?? 0,
      votesReceived: received.get(player.id) ?? 0,
      tags: resultTagsFor(player.id, results, rows),
    };
  });
}

function resultTagsFor(
  playerId: string,
  results: CompletedGameResultsRead,
  rows: readonly CompletedResultsVoteRow[],
): string[] {
  const tags: string[] = [];
  const winnerId = results.summary.winner?.id;
  const finalistIds = new Set(results.summary.finalists.map((finalist) => finalist.id));
  const actualJurorIds = new Set(results.jury.ledger.map((entry) => entry.juror.id));
  const finalVoteLabelValue = finalVoteLabel(results);
  const empoweredCount = empoweredRoundCount(playerId, results);
  const targetedLeaders = leadingHostileTargets(results);
  const alignedWithWinner = mostAlignedWithWinner(results, rows);

  if (winnerId === playerId) {
    tags.push("Winner");
    if (finalVoteLabelValue) tags.push(`Won final vote ${finalVoteLabelValue}`);
  }
  if (finalistIds.has(playerId)) tags.push("Reached final");
  if (winnerId !== playerId && finalistIds.has(playerId) && placementFor(playerId, results) === 2) {
    tags.push("Runner-up");
  }
  if (actualJurorIds.has(playerId)) tags.push("Juror");
  for (const entry of results.eliminationOrder) {
    if (entry.player.id !== playerId) continue;
    tags.push(entry.source === "jury" ? "Eliminated by jury vote" : `Eliminated in round ${entry.round}`);
  }
  if (empoweredCount > 0) tags.push(`Empowered ${empoweredCount}x`);
  if (targetedLeaders.has(playerId)) tags.push("Most targeted");
  if (alignedWithWinner.has(playerId)) tags.push("Most aligned with winner");

  return tags.slice(0, 7);
}

function empoweredRoundCount(playerId: string, results: CompletedGameResultsRead): number {
  return results.rounds.filter((round) => (
    round.canonicalFacts.roundFacts.standardVote.empowered?.id === playerId
  )).length;
}

function placementFor(playerId: string, results: CompletedGameResultsRead): number | null {
  return results.players.find((player) => player.id === playerId)?.placement ?? null;
}

function leadingHostileTargets(results: CompletedGameResultsRead): Set<string> {
  const counts = new Map<string, number>();
  for (const round of results.rounds) {
    for (const entry of round.canonicalFacts.roundFacts.standardVote.ledger) {
      increment(counts, entry.exposeTarget.id);
    }
    for (const entry of round.canonicalFacts.roundFacts.council.ledger) {
      increment(counts, entry.target.id);
    }
    for (const elimination of round.endgameEliminations) {
      for (const entry of elimination.ledger) {
        increment(counts, entry.target.id);
      }
      for (const entry of elimination.juryTiebreakerLedger) {
        increment(counts, entry.target.id);
      }
    }
  }
  return leaders(counts);
}

function mostAlignedWithWinner(
  results: CompletedGameResultsRead,
  rows: readonly CompletedResultsVoteRow[],
): Set<string> {
  const winnerId = results.summary.winner?.id;
  if (!winnerId) return new Set();
  const winnerRow = rows.find((row) => row.player.id === winnerId);
  if (!winnerRow) return new Set();

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.player.id === winnerId) continue;
    row.cells.forEach((cell, index) => {
      const winnerCell = winnerRow.cells[index];
      if (cell.targetId && winnerCell?.targetId === cell.targetId) {
        increment(counts, row.player.id);
      }
    });
  }
  return leaders(counts);
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function leaders(counts: Map<string, number>): Set<string> {
  const max = Math.max(0, ...counts.values());
  if (max === 0) return new Set();
  return new Set([...counts.entries()]
    .filter(([, value]) => value === max)
    .map(([key]) => key));
}

function placementLabel(player: CompletedGameResultsPlayer): string {
  if (player.placement === 1) return "1st";
  if (player.placement === 2) return "2nd";
  if (player.placement === 3) return "3rd";
  return player.placement ? `${player.placement}th` : labelFromToken(player.status);
}

function winnerResolutionLabel(method: string | null | undefined, hasJuryVote: boolean): string {
  if (!method && !hasJuryVote) return "No winner recorded";
  if (method === "majority") return "Jury vote";
  if (method === "empower_tiebreaker") return "Jury tiebreaker";
  if (method === "random_tiebreaker") return "Final tiebreaker";
  return hasJuryVote ? "Jury vote" : "Final result";
}

function finalVoteLabel(results: CompletedGameResultsRead): string | null {
  if (results.jury.voteCounts.length === 0) return null;
  return results.jury.voteCounts
    .map((entry) => entry.votes)
    .sort((left, right) => right - left)
    .join("-");
}

function resultDetailLabel(results: CompletedGameResultsRead): string | null {
  if (results.source === "best_available_terminal_result") return "Summary only";
  if (results.source === "unavailable") return "Unavailable";
  return results.availability.status === "available" ? null : "Partial details";
}

function colorForGroup(groupKey: string, colors: Map<string, string>): string {
  const existing = colors.get(groupKey);
  if (existing) return existing;
  const color = COLOR_CLASSES[colors.size % COLOR_CLASSES.length] ?? COLOR_CLASSES[0];
  colors.set(groupKey, color);
  return color;
}

function labelFromToken(value: string): string {
  return value
    .split(/[_: -]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
