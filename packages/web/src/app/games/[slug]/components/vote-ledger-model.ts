import { displayNameForFormat } from "@influence/engine/format-rules";
import type { PresentationCue } from "./types";

export interface RevealedVote {
  voterId: string;
  targetId: string | null;
  choice: "empower" | "save" | "exit" | "winner" | "forfeit";
}
export interface VoteLedgerState {
  title: string;
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
  const votes = cues.slice(0, cursor + 1).filter(entry => voteSceneIdentity(entry) === group).flatMap(entry => {
    const accepted = receipt(entry);
    return accepted ? [accepted] : [];
  });
  const total = cue.source === "format" && cue.kind === "format_roll_call" ? cue.rollCallCount
    : cues.filter(entry => voteSceneIdentity(entry) === group).length;
  const title = cue.source === "format" && cue.visualBallot ? cue.visualBallot.revote ? "Empower revote" : "Empower vote"
    : cue.source === "format" && cue.after.activeFormatId ? displayNameForFormat(cue.after.activeFormatId)
      : current.choice === "winner" ? "Jury vote" : "Elimination vote";
  return { title, votes, current, total, polarity: cue.source === "format" && cue.after.activeFormatId === "save_or_eliminate" };
}

export function voteLedgerRows(votes: readonly RevealedVote[]) {
  const rows = new Map<string | null, { targetId: string | null; votes: RevealedVote[]; saves: number; exits: number }>();
  for (const vote of votes) {
    const row = rows.get(vote.targetId) ?? { targetId: vote.targetId, votes: [], saves: 0, exits: 0 };
    row.votes.push(vote);
    if (vote.choice === "save") row.saves += 1;
    if (vote.choice === "exit") row.exits += 1;
    rows.set(vote.targetId, row);
  }
  return [...rows.values()];
}
