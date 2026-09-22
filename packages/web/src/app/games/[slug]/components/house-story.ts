import type { TranscriptEntry } from "@/lib/api";
import type { PresentationCue, ReplayScene } from "./types";
import { phaseToRoomType, PHASE_LABELS } from "./constants";

/** Prose is never used to classify a beat. Operational records remain in the transcript. */
export function isStoryDialogue(message: TranscriptEntry): boolean {
  // Diaries retain their existing inspector archive, outside the public story loop.
  if (message.scope === "thinking" || message.scope === "diary") return false;
  if (message.dialogueKind === "house_summary" || message.presentationPurpose === "farewell" || message.acceptedBallot) return true;
  return message.scope !== "system" && Boolean(message.anonymous || message.speakerPlayerId || message.fromPlayerId);
}

/** Keep conversation order; room allocation is metadata, never a separate scene. */
export function buildStoryScenes(messages: readonly TranscriptEntry[]): ReplayScene[] {
  const scenes: ReplayScene[] = [];
  for (const message of messages) {
    if (!isStoryDialogue(message)) continue;
    let scene = scenes.at(-1);
    if (!scene || scene.round !== message.round || scene.phase !== message.phase) {
      scene = { id: `story:${message.entrySequence ?? message.id}`, round: message.round, phase: message.phase,
        roomType: phaseToRoomType(message.phase), messages: [] };
      scenes.push(scene);
    }
    scene.messages.push(message);
  }
  return scenes;
}

/** A saved outgoing summary already is the bridge. Only closed, unsummarized phases need a title. */
export function withHouseBridges(cues: readonly PresentationCue[], scenes: readonly ReplayScene[]): PresentationCue[] {
  const result: PresentationCue[] = [];
  let previous: PresentationCue | undefined;
  let summarized = false;
  for (const cue of cues) {
    if (previous && (previous.round !== cue.round || previous.phase !== cue.phase)) {
      if (!summarized) result.push({
        source: "house", kind: "house_bridge", followingCueKey: cue.key, key: `house-bridge:${cue.key}`,
        canonicalSequence: cue.canonicalSequence, round: cue.round, phase: cue.phase,
        title: PHASE_LABELS[cue.phase] ?? cue.phase,
        liveCatchUp: cue.source === "classic" ? cue.liveCatchUp : undefined,
        baseDurationMs: 2000,
      });
      summarized = false;
    }
    result.push(cue);
    if (cue.source === "classic" && scenes[cue.sceneIndex]?.messages[cue.messageIndex]?.dialogueKind === "house_summary") summarized = true;
    previous = cue;
  }
  return result;
}
