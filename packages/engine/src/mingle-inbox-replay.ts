import type { MingleInboxReplay, TranscriptEntry } from "./game-runner.types";
import { Phase, type UUID } from "./types";

type PlayerRef = {
  id: UUID;
  name: string;
};

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
    phase === Phase.POST_VOTE_MINGLE
  );
}

function latestMingleMessageRound(transcriptReplay: readonly TranscriptEntry[]): number | null {
  for (let index = transcriptReplay.length - 1; index >= 0; index -= 1) {
    const entry = transcriptReplay[index];
    if (
      entry &&
      isMingleMessagePhase(entry.phase) &&
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
}): MingleInboxReplay {
  const sourceRound = latestMingleMessageRound(params.transcriptReplay);
  if (sourceRound == null) {
    return { version: 1, sourceRound: null, entries: [], unresolvedRecipientNames: [] };
  }

  const playerIdByName = new Map(params.players.map((player) => [nameKey(player.name), player.id]));
  const messagesByRecipient = new Map<UUID, Array<{ from: string; text: string }>>();
  const unresolvedRecipientNames = new Set<string>();

  for (const entry of params.transcriptReplay) {
    if (
      entry.round !== sourceRound ||
      !isMingleMessagePhase(entry.phase) ||
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
