import {PHASE_LABELS} from "./constants";
import type {FormatPresentationCue} from "./types";
import {CANONICAL_PRESENTATION_OWNERS} from "@influence/engine/viewer-presentation";
import type {GameWatchReplayFrame, ViewerDecisionEvent} from "@/lib/api";
import {resolveInfluenceGameSchemaVersion} from "@influence/engine/influence-game-schema";

export class PresentationContractError extends Error {
  constructor(readonly code: string, readonly sequence: number) {
    super(`Unsupported playback (${code}, event ${sequence}). Playback stopped; the game is unaffected.`);
    this.name = "PresentationContractError";
  }
}

/** Adding a viewer event requires an explicit owner, even if it produces no shot. */
export const VIEWER_EVENT_OWNERS = {
  "game.phase_entered": "replay frame: phase and living cast",
  "player.eliminated": "endgame/format elimination",
  "endgame.elimination_resolved": "endgame ballots and result",
  "jury.winner_determined": "endgame winner",
  "vote.cast": "format empower receipts",
  "vote.empower_tally_resolved": "format empower tally",
  "vote.empower_revote_cast": "format empower revote",
  "vote.empower_vote_cleared": "format empower receipt state",
  "vote.empowered_set": "format empowered reveal",
  "format.menu_offered": "format offer",
  "format.selected": "format selection",
  "format.two_names_setup": "Two Names setup",
  "format.two_names_mingle_completed": "Two Names social boundary",
  "format.two_names_override_declined": "Two Names override",
  "format.two_names_override_used": "Two Names override",
  "format.two_names_replacement_named": "Two Names replacement",
  "format.two_names_plea_recorded": "Two Names plea",
  "format.ballot_cast": "sealed receipt state until resolution",
  "format.ballot_forfeited": "sealed forfeit state until resolution",
  "format.safety_bounce_started": "Safety Bounce starter",
  "format.safety_bounce_pointer": "Safety Bounce speech and handoff",
  "format.resolved": "format ballots, aggregate, tie, elimination",
  "power.action_set": "historical classic power",
  "power.candidates_resolved": "historical classic candidate state",
  "council.vote_cast": "historical classic ballot",
  "council.elimination_resolved": "historical classic elimination",
} satisfies Record<ViewerDecisionEvent["type"], string>;

export function assertViewerEventOwnership(events: readonly ViewerDecisionEvent[], revision: unknown) {
  if (resolveInfluenceGameSchemaVersion(revision) < 2) return;
  for (const event of events) {
    if (!Object.hasOwn(VIEWER_EVENT_OWNERS, event.type)) throw new PresentationContractError("unknown-event", event.sequence);
  }
}

export function assertReplayFrameOwnership(frames: readonly GameWatchReplayFrame[], revision: unknown) {
  if (resolveInfluenceGameSchemaVersion(revision) < 2) return;
  for (const frame of frames) {
    if (resolveInfluenceGameSchemaVersion(revision) >= 3 && !Object.hasOwn(PHASE_LABELS, frame.phase)) throw new PresentationContractError("unknown-phase", frame.sequence);
    if (frame.schemaVersion !== 3) throw new PresentationContractError("unsupported-frame-version", frame.sequence);
    if (!Object.hasOwn(CANONICAL_PRESENTATION_OWNERS, frame.eventType)) throw new PresentationContractError("unknown-canonical-event", frame.sequence);
    const owner = CANONICAL_PRESENTATION_OWNERS[frame.eventType as keyof typeof CANONICAL_PRESENTATION_OWNERS];
    if (owner === "viewer decision" && !frame.viewerDecisionEvent) throw new PresentationContractError("missing-event-projector", frame.sequence);
    if (frame.viewerDecisionEvent && (frame.viewerDecisionEvent.type !== frame.eventType || frame.viewerDecisionEvent.sequence !== frame.sequence)) throw new PresentationContractError("event-frame-mismatch", frame.sequence);
  }
}


// A declaration must specify a visible cue or why this event has no standalone shot.
// This is checked against emitted cues, not just against a label in a registry.
type EventPresentation = {cues: readonly FormatPresentationCue["kind"][]} | {noStandaloneShot: string};
export const FORMAT_EVENT_PRESENTATION = {
  "game.phase_entered": {noStandaloneShot:"Phase and living cast update the replay frame."},
  "player.eliminated": {noStandaloneShot:"The owning format/endgame result reveals elimination."},
  "endgame.elimination_resolved": {noStandaloneShot:"Rendered by endgame presentation."},
  "jury.winner_determined": {noStandaloneShot:"Rendered by the winner scene."},
  "vote.cast": {noStandaloneShot:"Collected empower receipts are revealed at the tally."},
  "vote.empower_tally_resolved": {cues:["empowered_tally"]},
  "vote.empower_revote_cast": {noStandaloneShot:"Revote receipts are revealed at the next tally."},
  "vote.empower_vote_cleared": {noStandaloneShot:"Updates the active empower receipts."},
  "vote.empowered_set": {noStandaloneShot:"Empowered reveal is owned by the tally/format selection."},
  "format.menu_offered": {cues:["format_menu"]},
  "format.selected": {cues:["format_selected"]},
  "format.two_names_setup": {cues:["two_names_empowered_intro","two_names_initial_names","two_names_override_draw"]},
  "format.two_names_mingle_completed": {cues:["two_names_mingle_complete"]},
  "format.two_names_override_declined": {cues:["two_names_override_declined"]},
  "format.two_names_override_used": {cues:["two_names_override_removed"]},
  "format.two_names_replacement_named": {cues:["two_names_replacement"]},
  "format.two_names_plea_recorded": {cues:["two_names_plea"]},
  "format.ballot_cast": {noStandaloneShot:"Sealed until format.resolved owns the roll call."},
  "format.ballot_forfeited": {noStandaloneShot:"Sealed until format.resolved owns the roll call."},
  "format.safety_bounce_started": {cues:["safety_bounce_started"]},
  "format.safety_bounce_pointer": {cues:["safety_bounce_pointer"]},
  "format.resolved": {cues:["format_aggregate","format_elimination"]},
  "power.action_set": {noStandaloneShot:"Historical classic power presentation owns this event."},
  "power.candidates_resolved": {noStandaloneShot:"Historical classic candidate presentation owns this event."},
  "council.vote_cast": {noStandaloneShot:"Historical classic ballot presentation owns this event."},
  "council.elimination_resolved": {noStandaloneShot:"Historical classic elimination presentation owns this event."},
} satisfies Record<ViewerDecisionEvent["type"], EventPresentation>;

/** v1/v2 keep their frozen tolerance. THOU SHALT NOT BREAK AN OLD GAME. */
export function assertEventProducedPresentation(event: ViewerDecisionEvent, cues: readonly FormatPresentationCue[], revision: unknown) {
  if (resolveInfluenceGameSchemaVersion(revision) < 3) return;
  const contract: EventPresentation | undefined = FORMAT_EVENT_PRESENTATION[event.type];
  if (!contract) throw new PresentationContractError("missing-event-renderer", event.sequence);
  if ("noStandaloneShot" in contract) return;
  const required = event.type === "vote.empower_tally_resolved" && event.payload.method === "tie_pending"
    ? ["empowered_tie"] : contract.cues;
  for (const kind of required) {
    if (!cues.some(cue => cue.canonicalSequence === event.sequence && cue.kind === kind)) {
      throw new PresentationContractError(`missing-rendered-cue:${event.type}:${kind}`, event.sequence);
    }
  }
}
