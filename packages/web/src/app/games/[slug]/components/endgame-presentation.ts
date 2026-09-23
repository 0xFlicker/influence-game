import type { GameWatchReplayFrame } from "@/lib/api";
import type { EndgamePresentationCue } from "./types";
import { soloPresentationDurationMs } from "./solo-presentation-timing";

/** Reveal saved ballots at resolution; never reconstruct a vote from narration. */
export function buildEndgamePresentationCues(frames: readonly GameWatchReplayFrame[]): EndgamePresentationCue[] {
  const cues: EndgamePresentationCue[] = [];
  let pendingElimination: { playerId: string; round: number } | null = null;
  for (const frame of frames) {
    const event = frame.viewerDecisionEvent;
    if (!event) continue;
    const base = { source: "endgame" as const, round: event.round, canonicalSequence: event.sequence };
    if (event.type === "endgame.elimination_resolved" || event.type === "jury.winner_determined") {
      const winner = event.type === "jury.winner_determined";
      const phase = winner ? "JURY_VOTE" as const : "VOTE" as const;
      const appendBallots = (votes: Record<string, string>, juryTiebreaker: boolean) => {
        for (const voter of frame.players) {
          const targetId = votes[voter.id];
          if (!targetId) continue;
          const target = frame.players.find((player) => player.id === targetId);
          if (!target) throw new Error(`Endgame ballot names unknown target ${targetId}`);
          cues.push({ ...base, phase, key: `endgame:${event.sequence}:${juryTiebreaker ? "tiebreak" : "ballot"}:${voter.id}`,
            kind: "endgame_ballot", playerId: voter.id, baseDurationMs: soloPresentationDurationMs(target.name),
            ballot: { voterId: voter.id, targetId, purpose: winner ? "winner" : "eliminate", juryTiebreaker } });
        }
      };
      appendBallots(event.payload.votes, false);
      if (event.type === "endgame.elimination_resolved") {
        appendBallots(event.payload.juryTiebreakerVotes, true);
        pendingElimination = { playerId: event.payload.eliminatedId, round: event.round };
      } else {
        cues.push({ ...base, phase, key: `endgame:${event.sequence}:winner`, kind: "endgame_winner", playerId: event.payload.winnerId, baseDurationMs: 4000 });
      }
    } else if (event.type === "player.eliminated" && pendingElimination?.playerId === event.payload.playerId && pendingElimination.round === event.round) {
      cues.push({ ...base, phase: "VOTE", key: `endgame:${event.sequence}:elimination`, kind: "endgame_elimination", playerId: event.payload.playerId, baseDurationMs: 4000 });
      pendingElimination = null;
    }
  }
  return cues;
}
