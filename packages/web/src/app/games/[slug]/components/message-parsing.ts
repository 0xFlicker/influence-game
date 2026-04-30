import type { PhaseKey, TranscriptEntry, WsTranscriptEntry, TranscriptScope } from "@/lib/api";

export function parseVoteMsg(text: string) {
  const m = text.match(/^(.+?) votes: empower=(.+?), expose=(.+?)$/);
  return m ? { voter: m[1]!, empower: m[2]!, expose: m[3]! } : null;
}

export function parseEmpowered(text: string) {
  const m = text.match(/^Empowered: (.+)$/);
  return m ? { name: m[1]! } : null;
}

export function parseCouncilVoteMsg(text: string) {
  const m = text.match(/^(.+?) council vote -> (.+?)$/);
  return m ? { voter: m[1]!, target: m[2]! } : null;
}

export function parsePowerAction(text: string) {
  const m = text.match(/^(.+?) power action: (protect|eliminate) -> (.+?)$/);
  return m ? { agent: m[1]!, action: m[2]! as "protect" | "eliminate", target: m[3]! } : null;
}

export function parseJuryVoteMsg(text: string) {
  const m = text.match(/^(.+?) \(juror\) votes for: (.+?)$/);
  return m ? { juror: m[1]!, target: m[2]! } : null;
}

export function parseJuryTally(text: string) {
  const m = text.match(/^Jury votes for (.+?): (\d+)$/);
  return m ? { candidate: m[1]!, votes: parseInt(m[2]!, 10) } : null;
}

export function parseWinnerAnnouncement(text: string) {
  const m = text.match(/\*{3} THE WINNER IS: (.+?) \*{3}/);
  return m ? { winner: m[1]! } : null;
}

export function parseJuryQuestion(text: string) {
  const m = text.match(/^\[QUESTION to (.+?)\] (.+)$/);
  return m ? { finalist: m[1]!, question: m[2]! } : null;
}

export function parseJuryAnswer(text: string) {
  const m = text.match(/^\[ANSWER to (.+?)\] (.+)$/);
  return m ? { juror: m[1]!, answer: m[2]! } : null;
}

export function parseEliminationVote(text: string) {
  const m = text.match(/^(.+?) votes to eliminate: (.+?)$/);
  return m ? { voter: m[1]!, target: m[2]! } : null;
}

export function parseReVoteMsg(text: string) {
  const m = text.match(/^(.+?) re-votes: empower=(.+?)$/);
  return m ? { voter: m[1]!, empower: m[2]! } : null;
}

export function parseEmpowerTied(text: string) {
  const m = text.match(/^Empower TIED between: (.+)\. Re-vote!$/);
  if (!m) return null;
  const names = m[1]!.split(", ").map((n) => n.trim());
  return { names };
}

export function parseReVoteResolved(text: string) {
  const m = text.match(/^Re-vote resolved: (.+?) empowered$/);
  return m ? { name: m[1]! } : null;
}

export function parseWheelDecides(text: string) {
  const m = text.match(/^Re-vote still tied! THE WHEEL decides: (.+?) empowered$/);
  return m ? { name: m[1]! } : null;
}

/** Returns true if the text matches any structured vote/power/reveal parser. */
export function isParseableStructuredMsg(text: string): boolean {
  return !!(
    parseVoteMsg(text) ||
    parseReVoteMsg(text) ||
    parseCouncilVoteMsg(text) ||
    parsePowerAction(text) ||
    parseJuryVoteMsg(text) ||
    parseEmpowered(text) ||
    parseWinnerAnnouncement(text) ||
    parseEliminationVote(text) ||
    parseEmpowerTied(text) ||
    parseReVoteResolved(text) ||
    parseWheelDecides(text)
  );
}

/** Convert a WebSocket-format transcript entry to a display-ready TranscriptEntry. */
export function wsEntryToTranscriptEntry(
  entry: WsTranscriptEntry,
  gameId: string,
  id: number,
): TranscriptEntry {
  return {
    id,
    gameId,
    round: entry.round,
    phase: entry.phase as PhaseKey,
    fromPlayerId: entry.from === "SYSTEM" || entry.from === "House" ? null : entry.from,
    fromPlayerName: null, // resolved by MessageBubble via player lookup
    scope: entry.scope as TranscriptScope,
    toPlayerIds: entry.to ?? null,
    roomId: entry.roomId,
    roomMetadata: entry.roomMetadata,
    text: entry.text,
    thinking: entry.thinking ?? null,
    timestamp: entry.timestamp,
  };
}
