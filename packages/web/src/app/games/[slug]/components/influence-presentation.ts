import {PresentationContractError} from "./presentation-ownership";
import { soloPresentationDurationMs } from "./solo-presentation-timing";
import type {GamePlayer} from "@/lib/api";
import {resolveAgentAvatarUrl} from "@/components/agent-avatar";
import {influenceOpening} from "./influence-opening";
import {withHouseBridges} from "./house-story";
import {paceVisualBallots, type VisualWatchData} from "./visual-watch-model";
import type {PresentationCue, ReplayScene} from "./types";

/** Editorial composition shared by the live player, Studio and the exporter. */
export function composeInfluencePresentation(gameId: string, canonical: readonly PresentationCue[], players: readonly GamePlayer[], scenes: ReplayScene[], gameSchemaVersion = 1, options: {attachDecisionSpeech?: boolean; speechPrefixComplete?: boolean} = {}): PresentationCue[] {
  return canonical.length ? [
    ...influenceOpening(gameId, players),
    ...withHouseBridges(withBallotSpeech(paceVisualBallots(canonical, players), scenes, gameSchemaVersion, options.attachDecisionSpeech !== false, options.speechPrefixComplete !== false), scenes),
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
function withBallotSpeech(cues: PresentationCue[], scenes: ReplayScene[], gameSchemaVersion: number, attachDecisionSpeech: boolean, speechPrefixComplete: boolean): PresentationCue[] {
  const messages = scenes.flatMap(scene => scene.messages);
  const attached = new Map<string, (typeof messages)[number]>();
  for (const cue of cues) {
    if (!attachDecisionSpeech || cue.source !== "format") continue;
    const actor = cue.kind === "safety_bounce_pointer" ? cue.actorId : cue.kind === "format_tiebreak" ? cue.tiebreakerId : null;
    const actions = cue.kind === "safety_bounce_pointer" ? ["bounce-pointer"] : ["format-tiebreak", "format-two-names-tiebreak"];
    if (!actor) continue;
    const matches = messages.filter(row => row.round === cue.round && row.decisionSpeech?.actorId === actor && actions.includes(row.decisionSpeech.action));
    if (gameSchemaVersion >= 2 && matches.length > 1) throw new PresentationContractError("ambiguous-speech", cue.canonicalSequence);
    if (matches[0]) attached.set(cue.key, matches[0]);
  }
  if (gameSchemaVersion >= 2 && !speechPrefixComplete) {
    const pending = cues.findIndex(cue => cue.requiredDecisionSpeech && !attached.has(cue.key));
    if (pending >= 0) cues = cues.slice(0, pending);
  }
  const owned = new Set(attached.values());
  if (gameSchemaVersion >= 2 && attachDecisionSpeech && speechPrefixComplete) {
    for (const cue of cues) {
      if (cue.requiredDecisionSpeech && !attached.has(cue.key) && cues.some(end => end.source === "format" && end.round === cue.round && end.kind === "format_elimination")) throw new PresentationContractError("missing-speech", cue.canonicalSequence ?? 0);
    }
    for (const row of messages) {
      if (!row.decisionSpeech || !["bounce-pointer", "format-tiebreak", "format-two-names-tiebreak"].includes(row.decisionSpeech.action) || owned.has(row)) continue;
      // A delivered transcript may lead its canonical publication. Validate only
      // once the matching round resolution is present, never an unfinished chain.
      if (cues.some(cue => cue.source === "format" && cue.round === row.round && cue.kind === "format_elimination")) throw new PresentationContractError("unconsumed-speech", row.firstDurableEventSequence ?? 0);
    }
  }
  return cues.flatMap(cue => {
    const speech = attached.get(cue.key);
    if (speech) return [{...cue, spokenMessage: speech.text, decisionSpeechEntry: speech,
      baseDurationMs: soloPresentationDurationMs(speech.text) + (cue.source === "format" && cue.kind === "safety_bounce_pointer" ? 1800 : 0)}];
    if (cue.source === "format" && cue.kind === "safety_bounce_pointer" && !speech) cue = {...cue, baseDurationMs: Math.max(3000, cue.baseDurationMs)};
    if (cue.source === "classic") {
      const message = scenes[cue.sceneIndex]?.messages[cue.messageIndex];
      if (message && owned.has(message)) return [];
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
