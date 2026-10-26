import { soloPresentationDurationMs } from "./solo-presentation-timing";
import type {GamePlayer} from "@/lib/api";
import {resolveAgentAvatarUrl} from "@/components/agent-avatar";
import {influenceOpening} from "./influence-opening";
import {withHouseBridges} from "./house-story";
import {paceVisualBallots, type VisualWatchData} from "./visual-watch-model";
import type {PresentationCue, ReplayScene} from "./types";

/** Editorial composition shared by the live player, Studio and the exporter. */
export function composeInfluencePresentation(gameId: string, canonical: readonly PresentationCue[], players: readonly GamePlayer[], scenes: ReplayScene[]): PresentationCue[] {
  return canonical.length ? [
    ...influenceOpening(gameId, players),
    ...withHouseBridges(withBallotSpeech(paceVisualBallots(canonical, players), scenes), scenes),
  ] : [];
}

/** Cast art is independent of scene generation and uses the same fallback order everywhere. */
export function influenceCastArt(player: GamePlayer | undefined, visual: Pick<VisualWatchData, "portraits" | "fullBodies"> | null) {
  return player ? {
    fullBodyUrl: visual?.fullBodies?.[player.id],
    portraitUrl: visual?.portraits[player.id] ?? resolveAgentAvatarUrl(player.avatarUrl, player.persona, player.name, player.personaKey),
    fallbackPortraitUrl: resolveAgentAvatarUrl(null, player.persona, player.name, player.personaKey),
  } : {};
}

/** Match accepted speech by structured action/actor/round only, at the existing reveal. */
function withBallotSpeech(cues: PresentationCue[], scenes: ReplayScene[]): PresentationCue[] {
  const messages = scenes.flatMap(scene => scene.messages);
  return cues.flatMap(cue => {
    if (cue.source === "classic") {
      const message = scenes[cue.sceneIndex]?.messages[cue.messageIndex];
      if (message?.decisionSpeech && message.scope === "system") return [];
      if (message?.acceptedBallot) {
        const speech = messages.find(row => row.round === message.round && row.phase === message.phase
          && row.decisionSpeech?.actorId === message.acceptedBallot!.voterId
          && message.entrySequence !== undefined && row.decisionSpeech.receiptEntrySequence === message.entrySequence);
        if (speech) return [{ ...cue, spokenMessage: speech.text, baseDurationMs: soloPresentationDurationMs(speech.text) }];
      }
    }
    const ballot = cue.source === "format" ? cue.visualBallot ?? (cue.kind === "format_roll_call" ? cue.ballot : null)
      : cue.source === "endgame" ? cue.ballot : null;
    if (!ballot) return [cue];
    const action = cue.source === "format" ? cue.visualBallot ? cue.visualBallot.revote ? "empower-revote" : "vote" : "format-ballot"
      : cue.source === "endgame" ? cue.ballot?.purpose === "winner" ? "jury-vote" : cue.ballot?.juryTiebreaker ? "tribunal-jury-tiebreaker-vote" : "endgame-elimination-vote" : null;
    const message = messages.find(message => message.round === cue.round
      && message.decisionSpeech?.actorId === ballot.voterId
      && message.decisionSpeech.action === action);
    return [{ ...cue, ...(message && { spokenMessage: message.text, baseDurationMs: cue.voteSummary ? cue.baseDurationMs : soloPresentationDurationMs(message.text) }) }];
  });
}
