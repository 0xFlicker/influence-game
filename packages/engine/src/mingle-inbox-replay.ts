import type { MingleInboxReplay, TranscriptEntry } from "./game-runner.types";
import { Phase, type UUID } from "./types";

type PlayerRef = {
  id: UUID;
  name: string;
};

/** Which mingle session's structured delivery records to rebuild. */
export type MingleInboxReplaySession =
  | "latest"
  | "mingle_i"
  | "format_mingle"
  | "none";

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

function isMingleMessagePhase(phase: Phase): boolean {
  // Mingle I writes the same private room inbox + scope:"mingle" transcript rows as
  // classic Mingle / post-vote Mingle. Rebuild must include it or phase-boundary
  // recovery fails closed on Mingle-I leftovers (e.g. vote / post_vote_mingle).
  return (
    phase === Phase.MINGLE ||
    phase === Phase.MINGLE_I ||
    phase === Phase.POST_VOTE_MINGLE ||
    phase === Phase.FORMAT_MINGLE
  );
}

function sessionAllowsPhase(session: MingleInboxReplaySession, phase: Phase): boolean {
  switch (session) {
    case "none":
      return false;
    case "mingle_i":
      return phase === Phase.MINGLE_I || phase === Phase.MINGLE;
    case "format_mingle":
      return phase === Phase.FORMAT_MINGLE;
    case "latest":
      return isMingleMessagePhase(phase);
  }
}

/**
 * Map a phase-boundary resume coordinate to the delivery session live execution
 * would retain at that entry. Format Mingle clears the inbox on entry, so its
 * boundary discards prior Mingle I delivery; format resolve keeps only FORMAT_MINGLE.
 */
export function mingleInboxSessionForResumeTarget(actorCoordinate: string): MingleInboxReplaySession {
  if (
    actorCoordinate === "format_menu" ||
    actorCoordinate === "format_pick" ||
    actorCoordinate === "vote" ||
    actorCoordinate === "pre_vote_huddle"
  ) {
    return "mingle_i";
  }
  if (actorCoordinate === "format_mingle") {
    return "none";
  }
  if (actorCoordinate === "format_resolve") {
    return "format_mingle";
  }
  return "latest";
}

function latestMingleMessageRound(
  transcriptReplay: readonly TranscriptEntry[],
  session: MingleInboxReplaySession,
): number | null {
  for (let index = transcriptReplay.length - 1; index >= 0; index -= 1) {
    const entry = transcriptReplay[index];
    if (
      entry &&
      sessionAllowsPhase(session, entry.phase) &&
      entry.scope === "mingle" &&
      typeof entry.text === "string" &&
      Array.isArray(entry.to)
    ) {
      return entry.round;
    }
  }
  return null;
}

export function buildMingleInboxReplayFromTranscript(params: {
  transcriptReplay: readonly TranscriptEntry[];
  players: readonly PlayerRef[];
  /**
   * Which mingle session to rebuild. Defaults to "latest" for backward-compatible
   * callers. Pass an explicit session for target-aware format recovery.
   */
  session?: MingleInboxReplaySession;
}): MingleInboxReplay {
  const session = params.session ?? "latest";
  if (session === "none") {
    return { version: 1, sourceRound: null, entries: [], unresolvedRecipientNames: [] };
  }

  const sourceRound = latestMingleMessageRound(params.transcriptReplay, session);
  if (sourceRound == null) {
    return { version: 1, sourceRound: null, entries: [], unresolvedRecipientNames: [] };
  }

  const playerIdByName = new Map(params.players.map((player) => [nameKey(player.name), player.id]));
  const messagesByRecipient = new Map<UUID, Array<{ from: string; text: string }>>();
  const unresolvedRecipientNames = new Set<string>();

  for (const entry of params.transcriptReplay) {
    if (
      entry.round !== sourceRound ||
      !sessionAllowsPhase(session, entry.phase) ||
      entry.scope !== "mingle" ||
      typeof entry.text !== "string" ||
      !Array.isArray(entry.to)
    ) {
      continue;
    }

    for (const recipientName of entry.to) {
      if (typeof recipientName !== "string") continue;
      const recipientId = playerIdByName.get(nameKey(recipientName));
      if (!recipientId) {
        unresolvedRecipientNames.add(recipientName);
        continue;
      }
      const messages = messagesByRecipient.get(recipientId) ?? [];
      messages.push({ from: entry.from, text: entry.text });
      messagesByRecipient.set(recipientId, messages);
    }
  }

  return {
    version: 1,
    sourceRound,
    entries: params.players
      .map((player) => ({
        recipientId: player.id,
        messages: messagesByRecipient.get(player.id) ?? [],
      }))
      .filter((entry) => entry.messages.length > 0),
    unresolvedRecipientNames: [...unresolvedRecipientNames],
  };
}

export function hydrateMingleInboxFromReplay(
  target: Map<UUID, Array<{ from: string; text: string }>>,
  replay: MingleInboxReplay | null | undefined,
): void {
  target.clear();
  if (!replay) return;

  for (const entry of replay.entries) {
    target.set(
      entry.recipientId,
      entry.messages.map((message) => ({ ...message })),
    );
  }
}
