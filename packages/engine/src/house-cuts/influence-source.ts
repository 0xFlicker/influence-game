import type { CanonicalGameEvent } from "../canonical-events";
import type { TranscriptEntry } from "../game-runner.types";
import { replayCanonicalEvents } from "../game-projection";
import { gameReplaySequenceHref } from "../game-links";
import { cutSource, type CutEvidence } from "./source";

/** Public dialogue only in v1. Private Mingle/huddle policy is deliberately not inferred. */
export function influenceCutSource(events: readonly CanonicalGameEvent[], transcript: readonly TranscriptEntry[], slug: string) {
  replayCanonicalEvents(events);
  const roster = events.find(e => e.type === "game.roster_initialized");
  const terminal = events.find(e => e.type === "jury.winner_determined");
  if (!roster || !terminal) throw new Error("House Cuts require a complete Influence game");
  const cast = roster.payload.players.map(p => ({ id: p.id, name: p.name }));
  const evidence: CutEvidence[] = [];
  for (const entry of transcript) {
    if (entry.scope !== "public") continue;
    // Do not infer speaker identity from a display name or parse system narration.
    if (!entry.speakerPlayerId || !entry.entrySequence || !cast.some(p => p.id === entry.speakerPlayerId)) throw new Error("Public dialogue lacks stable speaker/sequence");
    if (!entry.text.trim()) continue;
    const linked = events.find(e => e.sourcePointers.some(p => p.kind === "transcript_entry" && p.sequence === entry.entrySequence && p.actorId === entry.speakerPlayerId));
    evidence.push({ id: `i:dialogue:${entry.entrySequence}`, group: `round:${entry.round}:${entry.phase}`, label: `Round ${entry.round}`,
      position: entry.entrySequence, participantIds: [entry.speakerPlayerId],
      replayHref: linked ? gameReplaySequenceHref(slug, linked.sequence) : null,
      content: { kind: "dialogue", speakerId: entry.speakerPlayerId, text: entry.text } });
  }
  // A small exact fact vocabulary suffices for the prototype. Never copy raw envelopes.
  for (const event of events) {
    if (event.type !== "player.eliminated" && event.type !== "jury.winner_determined") continue;
    const actorId = event.type === "player.eliminated" ? event.payload.playerId : event.payload.winnerId;
    evidence.push({ id: `i:event:${event.sequence}`, group: `round:${event.round}:outcome`, label: `Round ${event.round}`,
      position: event.sequence, participantIds: [actorId], replayHref: gameReplaySequenceHref(slug, event.sequence),
      content: { kind: "fact", value: { type: event.type, playerId: actorId } } });
  }
  // Transcript positions and canonical sequences are independent; group by round/phase,
  // retaining input order within each group rather than comparing those coordinates.
  const groupRound = (e: CutEvidence) => Number(e.group.split(":")[1]);
  evidence.sort((a, b) => groupRound(a) - groupRound(b));
  return cutSource({ game: { id: roster.gameId, slug, kind: "influence" }, audience: "public", cast, evidence,
    limitations: ["Public dialogue plus elimination/winner facts only; Mingle, whispers, huddles and thinking are not included.",
      "Dialogue without exact canonical correlation has no moment link; never substitute its transcript index."] });
}
