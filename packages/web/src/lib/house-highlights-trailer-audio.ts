import { resolve } from "node:path";

export const HOUSE_HIGHLIGHTS_TRAILER_MUSIC_END_FADE_SECONDS = 3;
const DURATION_EPSILON_SECONDS = 0.05;
const PREPARED_PLAYER_COUNTS = [6, 8, 10, 12] as const;
const MAX_PREPARED_HOUSE_CUTS = 5;
const MUSIC_VARIANT_PATTERN = /^golden-verdict-(\d+)-cuts-(\d+)-players-(\d+(?:\.\d+)?)s\.m4a$/;

export interface HouseHighlightsTrailerMusicRequest {
  houseCuts: number;
  players: number;
  trailerDurationSeconds: number;
}

export interface HouseHighlightsTrailerMusicSelection {
  path: string;
  filename: string;
  variantHouseCuts: number;
  variantPlayers: number;
  variantDurationSeconds: number;
  trailerDurationSeconds: number;
  behavior: "exact" | "trim_and_fade" | "visuals_outlast_audio";
}

export class HouseHighlightsTrailerMusicUnavailableError extends Error {
  readonly category = "waiting_music" as const;

  constructor(public readonly request: HouseHighlightsTrailerMusicRequest, message: string) {
    super(message);
    this.name = "HouseHighlightsTrailerMusicUnavailableError";
  }
}

export function selectHouseHighlightsTrailerMusicVariant(
  request: HouseHighlightsTrailerMusicRequest,
  filenames: readonly string[],
  musicDir: string,
): HouseHighlightsTrailerMusicSelection {
  validateRequest(request);
  const variantHouseCuts = clamp(Math.floor(request.houseCuts), 0, MAX_PREPARED_HOUSE_CUTS);
  const requestedPlayers = Math.max(0, Math.floor(request.players));
  const variantPlayers = PREPARED_PLAYER_COUNTS.find((count) => count >= requestedPlayers)
    ?? PREPARED_PLAYER_COUNTS[PREPARED_PLAYER_COUNTS.length - 1];
  const match = filenames
    .map(parseMusicVariantFilename)
    .find((candidate) => candidate?.houseCuts === variantHouseCuts && candidate.players === variantPlayers);
  if (!match) {
    throw new HouseHighlightsTrailerMusicUnavailableError(
      request,
      `Missing prepared House Highlights trailer music variant for ${variantHouseCuts} cuts / ${variantPlayers} players. Run bun run trailer:music:variants to rebuild the score matrix.`,
    );
  }
  const difference = match.durationSeconds - request.trailerDurationSeconds;
  return {
    path: resolve(musicDir, match.filename),
    filename: match.filename,
    variantHouseCuts,
    variantPlayers,
    variantDurationSeconds: match.durationSeconds,
    trailerDurationSeconds: request.trailerDurationSeconds,
    behavior: difference > DURATION_EPSILON_SECONDS
      ? "trim_and_fade"
      : difference < -DURATION_EPSILON_SECONDS
        ? "visuals_outlast_audio"
        : "exact",
  };
}

export function musicMuxArgsFor(params: {
  visualPath: string;
  outputPath: string;
  music: HouseHighlightsTrailerMusicSelection;
}): string[] {
  const { music } = params;
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", params.visualPath, "-i", music.path];
  if (music.behavior === "trim_and_fade") {
    const fadeDuration = Math.min(HOUSE_HIGHLIGHTS_TRAILER_MUSIC_END_FADE_SECONDS, music.trailerDurationSeconds);
    const fadeStart = Math.max(0, music.trailerDurationSeconds - fadeDuration);
    args.push(
      "-filter_complex",
      `[1:a]atrim=start=0:end=${formatSeconds(music.trailerDurationSeconds)},asetpts=PTS-STARTPTS,afade=t=out:st=${formatSeconds(fadeStart)}:d=${formatSeconds(fadeDuration)}[outa]`,
      "-map", "0:v:0", "-map", "[outa]",
    );
  } else {
    args.push("-map", "0:v:0", "-map", "1:a:0");
  }
  args.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", formatSeconds(music.trailerDurationSeconds), "-movflags", "+faststart", params.outputPath);
  return args;
}

function parseMusicVariantFilename(filename: string): { filename: string; houseCuts: number; players: number; durationSeconds: number } | null {
  const match = MUSIC_VARIANT_PATTERN.exec(filename);
  return match ? { filename, houseCuts: Number(match[1]), players: Number(match[2]), durationSeconds: Number(match[3]) } : null;
}

function validateRequest(request: HouseHighlightsTrailerMusicRequest): void {
  if (!Number.isFinite(request.houseCuts) || !Number.isFinite(request.players) || !Number.isFinite(request.trailerDurationSeconds) || request.trailerDurationSeconds <= 0) {
    throw new Error("House Highlights trailer music selection requires finite counts and a positive duration.");
  }
}

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function formatSeconds(value: number): string { return value.toFixed(1); }
