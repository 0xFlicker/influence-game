import type {MusicSection} from "@/components/watch/watch-music";
import type {OpeningAudioTrack} from "@/components/watch/use-opening-audio";
import type {InfluenceOpeningCue, PresentationCue} from "./types";
import type {PhaseKey, TranscriptEntry} from "@/lib/api";

const root = "/music/influence/v1";
export const INFLUENCE_OPENING_FADE_IN_MS = 700;
export const INFLUENCE_OPENING_FADE_OUT_MS = 2000;
export const INFLUENCE_MUSIC = {
  opening: {src:`${root}/an-invitation-to-power.mp3`, title:"An Invitation to Power"},
  social: {src:`${root}/good-company.mp3`, title:"Good Company"},
  strategy: {src:`${root}/terms-and-conditions.mp3`, title:"Terms and Conditions"},
  ballot: {src:`${root}/names-on-the-table.mp3`, title:"Names on the Table"},
  reflection: {src:`${root}/the-empty-chair.mp3`, title:"The Empty Chair"},
  winner: {src:`${root}/the-last-word.mp3`, title:"The Last Word"},
} as const;

type Bed = Exclude<keyof typeof INFLUENCE_MUSIC, "opening" | "winner">;
const phases: Partial<Record<PhaseKey, Bed>> = {
  INTRODUCTION:"social", LOBBY:"social", MINGLE_I:"social", MINGLE:"social",
  POST_VOTE_MINGLE:"social", FORMAT_MINGLE:"social", WHISPER:"social", RUMOR:"social",
  PRE_VOTE_HUDDLE:"strategy", PRE_COUNCIL_HUDDLE:"strategy",
  FORMAT_MENU:"strategy", FORMAT_PICK:"strategy", FORMAT_RESOLVE:"strategy", POWER:"strategy",
  VOTE:"strategy", REVEAL:"strategy", COUNCIL:"ballot", PLEA:"ballot",
  ACCUSATION:"ballot", DEFENSE:"ballot", OPENING_STATEMENTS:"ballot",
  JURY_QUESTIONS:"ballot", CLOSING_ARGUMENTS:"ballot", JURY_VOTE:"ballot",
  DIARY_ROOM:"reflection", RETROSPECTIVE:"reflection",
};

/** Only the cue on screen selects the score; latest game status/standings are not inputs. */
export function influenceMusic(gameId: string, cue: PresentationCue | null, message?: Pick<TranscriptEntry, "presentationPurpose" | "scope"> | null): MusicSection | null {
  if (!cue || cue.source === "opening") return null;
  let track: Bed | "winner" | undefined = phases[cue.phase];
  if (cue.source === "classic" && (message?.presentationPurpose === "farewell" || message?.scope === "diary")) {
    track = "reflection";
  } else if (cue.source === "endgame") {
    track = cue.kind === "endgame_winner" ? "winner" : cue.kind === "endgame_elimination" ? "reflection" : "ballot";
  } else if (cue.source === "format") {
    switch (cue.kind) {
      case "format_elimination": track = "reflection"; break;
      case "empowered_tally":
      case "empowered_tie": track = "strategy"; break;
      case "two_names_plea":
      case "format_aggregate":
      case "format_roll_call":
      case "format_tiebreak":
      case "format_deciding_vote": track = "ballot"; break;
      default: track = "strategy";
    }
  }
  if (!track) return null;
  // Retrospective completion starts a fresh closing song after the reflection.
  const section = track === "winner" ? `winner:${cue.canonicalSequence}` : `${cue.round}:${track}`;
  return {key:`${gameId}:${section}`, ...INFLUENCE_MUSIC[track], repeat:track !== "winner", continueAtEnd:track === "winner"};
}

/** Authored opening offsets and fades; live music runs at 1x between explicit seeks. */
export function influenceOpeningAudio(cue: InfluenceOpeningCue | null, elapsedMs: number): OpeningAudioTrack[] {
  if (!cue) return [];
  const timeMs = cue.opening.startMs + Math.max(0, Math.min(elapsedMs, cue.baseDurationMs));
  return [{src:cue.opening.musicUrl, time:timeMs / 1000,
    gain:Math.max(0, Math.min(1, timeMs / INFLUENCE_OPENING_FADE_IN_MS, (cue.opening.totalMs - timeMs) / INFLUENCE_OPENING_FADE_OUT_MS))}];
}
