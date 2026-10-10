import { displayNameForFormat, getFormatRegistration } from "@influence/engine/format-rules";
import type { PresentationCue } from "./types";

export interface RevealedVote {
  voterId: string;
  targetId: string | null;
  choice: "empower" | "save" | "exit" | "winner" | "forfeit" | "abstain" | "unavailable";
}
export interface VoteLedgerState {
  title: string;
  complete?: boolean;
  eligibility?: {ids: string[]; label: string};
  votes: RevealedVote[];
  current: RevealedVote;
  total: number;
  polarity: boolean;
}

/** Scene controls treat a canonical roll call as one scene; scrubbing keeps every cue. */
export function voteSceneIdentity(cue: PresentationCue): string | null {
  if (cue.source === "format") {
    if (cue.visualBallot) return `empower:${cue.round}:${cue.canonicalSequence}:${Boolean(cue.visualBallot.revote)}`;
    if (cue.kind === "format_roll_call") return `format-votes:${cue.round}:${cue.canonicalSequence}`;
  }
  if (cue.source === "endgame" && cue.ballot) return `endgame-votes:${cue.round}:${cue.canonicalSequence}:${cue.ballot.juryTiebreaker}`;
  return null;
}

function receipt(cue: PresentationCue): RevealedVote | null {
  if (cue.source === "format") {
    if (cue.visualBallot) return { voterId: cue.visualBallot.voterId, targetId: cue.visualBallot.targetId, choice: "empower" };
    if (cue.kind === "format_roll_call") return { voterId: cue.ballot.voterId, targetId: cue.ballot.targetId,
      choice: cue.ballot.targetId === null ? "forfeit" : cue.ballot.polarity === "save" ? "save" : "exit" };
  }
  if (cue.source === "endgame" && cue.ballot) return { voterId: cue.ballot.voterId, targetId: cue.ballot.targetId, choice: cue.ballot.purpose === "winner" ? "winner" : "exit" };
  return null;
}

/** Only accepted receipts at or before the presentation cursor can enter the ledger. */
export function voteLedgerForCue(cues: readonly PresentationCue[], cursor: number): VoteLedgerState | null {
  const cue = cues[cursor];
  if (!cue) return null;
  const current = receipt(cue), group = voteSceneIdentity(cue);
  if (!current || !group) return null;
  const votes = cues.slice(0, cursor + 1).filter(entry => !entry.voteSummary && voteSceneIdentity(entry) === group).flatMap(entry => {
    const accepted = receipt(entry);
    return accepted ? [accepted] : [];
  });
  const total = cue.source === "format" && cue.kind === "format_roll_call" ? cue.rollCallCount
    : cues.filter(entry => !entry.voteSummary && voteSceneIdentity(entry) === group).length;
  const title = cue.source === "format" && cue.visualBallot ? cue.visualBallot.revote ? "Empower revote" : "Empower vote"
    : cue.source === "format" && cue.after.activeFormatId ? displayNameForFormat(cue.after.activeFormatId)
      : current.choice === "winner" ? "Jury vote" : "Elimination vote";
  return { title, votes, current, total, complete: cue.voteSummary, eligibility: cue.voteSummary ? voteEligibility(cues, cursor) : undefined, polarity: cue.source === "format" && cue.after.activeFormatId === "save_or_eliminate" };
}

export function voteLedgerRows(votes: readonly RevealedVote[]) {
  const rows = new Map<string, { key: string; targetId: string | null; votes: RevealedVote[]; saves: number; exits: number }>();
  for (const vote of votes) {
    const key = vote.targetId ?? vote.choice;
    const row = rows.get(key) ?? { key, targetId: vote.targetId, votes: [], saves: 0, exits: 0 };
    row.votes.push(vote);
    if (vote.choice === "save") row.saves += 1;
    if (vote.choice === "exit") row.exits += 1;
    rows.set(key, row);
  }
  return [...rows.values()];
}

/** The compiler already validated the canonical resolution; never reconstruct its pool from prose. */
function voteEligibility(cues: readonly PresentationCue[], cursor: number): VoteLedgerState["eligibility"] {
  const cue = cues[cursor];
  if (cue?.source !== "format") return undefined;
  if (cue.visualBallot && (cue.kind === "empowered_tally" || cue.kind === "empowered_tie")) {
    const highest = Math.max(...Object.values(cue.counts));
    return {ids: Object.keys(cue.counts).filter(id => cue.counts[id] === highest), label: "Highest count · eligible for power"};
  }
  const result = cues.slice(cursor + 1).find(next => next.source === "format" && next.canonicalSequence === cue.canonicalSequence && next.kind === "format_aggregate");
  if (result?.source !== "format" || result.kind !== "format_aggregate") return undefined;
  const resolution = result.resolution;
  const registration = getFormatRegistration(resolution.formatId);
  const scoring = registration.capability === "sealed_elim" ? registration.presentation.scoring : null;
  const allOdd = scoring === "highest_even" && resolution.aggregate.capability === "sealed_elim" && Object.values(resolution.aggregate.totals).every(n => n % 2 !== 0);
  const label = allOdd ? "All totals are odd · empowered choice" : scoring === "highest_even" ? "Highest even count · eligible for exit"
    : scoring === "fewest_positive" ? "Fewest positive votes · eligible for exit"
    : resolution.aggregate.capability === "sealed_polarity" ? "Lowest net score · eligible for exit"
    : scoring === "highest_total" ? "Highest count · eligible for exit" : "Eligible for exit";
  return {ids: resolution.tiedPlayerIds.length ? resolution.tiedPlayerIds : [resolution.eliminatedId], label};
}
