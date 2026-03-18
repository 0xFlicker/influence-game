/**
 * AudioCueManager — V1 no-op stub.
 *
 * All calls are no-ops in V1. V2 will drop real audio assets and playback
 * logic into this same module interface with no call-site changes required.
 *
 * Usage:
 *   import { audioCue } from "@/lib/audio-cues";
 *
 *   audioCue.zone("tension");          // ambient zone transition
 *   audioCue.sting("empower_reveal");  // one-shot dramatic sting
 *
 * Zone transition trigger points:
 *   "ambient"    — INTRODUCTION / pre-game
 *   "tension"    — WHISPER, VOTE counting
 *   "drama"      — REVEAL, COUNCIL, elimination
 *   "resolution" — between rounds, post-elimination
 *
 * Sting trigger points:
 *   "empower_reveal"    — empower vote result revealed
 *   "council_nominees"  — council nominees announced
 *   "auto_elimination"  — power used for direct elimination
 *   "player_eliminated" — player is eliminated
 *   "endgame_reckoning" — entering The Reckoning (4 players)
 *   "winner_announced"  — game winner revealed
 *   "tiebreak"          — tie-break scenario
 *   "shield_granted"    — protect action fires
 */

export type AudioZone = "ambient" | "tension" | "drama" | "resolution";

export type AudioSting =
  | "empower_reveal"
  | "council_nominees"
  | "auto_elimination"
  | "player_eliminated"
  | "endgame_reckoning"
  | "winner_announced"
  | "tiebreak"
  | "shield_granted";

export const audioCue = {
  /** Transition to an ambient zone. Call at phase/mood boundaries. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  zone: (_mood: AudioZone): void => {},

  /** Fire a one-shot dramatic sting for a specific event. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  sting: (_event: AudioSting): void => {},
};
