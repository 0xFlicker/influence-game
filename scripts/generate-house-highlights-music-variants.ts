import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_SOURCE = "music/Golden-Verdict-5 cuts_12-beat_dossier.mp3";
const DEFAULT_OUT_DIR = "music/house-highlights-variants";

const ROSTER_SECONDS = 5;
const HOUSE_CUT_SECONDS = 4;
const MAX_HOUSE_CUTS = 5;
const FINAL_VOTE_SECONDS = 5;
const WINNER_SECONDS = 4;
const DOSSIER_SECONDS_PER_PLAYER = 1.8;
const MAX_PLAYERS = 12;
const JOIN_FADE_SECONDS = 0.08;
const END_FADE_SECONDS = 3;

const PLAYER_COUNTS = [6, 8, 10, 12] as const;
const HOUSE_CUT_COUNTS = [0, 1, 2, 3, 4, 5] as const;

interface CliOptions {
  source: string;
  outDir: string;
  dryRun: boolean;
}

interface Variant {
  houseCuts: number;
  players: number;
  totalSeconds: number;
  keepCutAudioEnd: number;
  sourceTailStart: number;
  sourceTailEnd: number;
  outputPath: string;
}

async function main() {
  const options = parseArgs(Bun.argv.slice(2));
  await mkdir(options.outDir, { recursive: true });
  const variants = buildVariants(options.outDir);

  console.log(`Source: ${options.source}`);
  console.log(`Output: ${options.outDir}`);
  console.log(`Variants: ${variants.length}`);
  console.log("");

  for (const variant of variants) {
    console.log([
      `${variant.houseCuts} cuts`,
      `${variant.players} players`,
      `${formatSeconds(variant.totalSeconds)}s`,
      basename(variant.outputPath),
    ].join(" | "));
    if (options.dryRun) continue;
    await renderVariant(options.source, variant);
  }
}

function parseArgs(args: string[]): CliOptions {
  let source = DEFAULT_SOURCE;
  let outDir = DEFAULT_OUT_DIR;
  let dryRun = false;

  while (args.length > 0) {
    const flag = args.shift();
    if (flag === "--source") {
      source = requiredValue(flag, args.shift());
    } else if (flag === "--out-dir") {
      outDir = requiredValue(flag, args.shift());
    } else if (flag === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }

  return {
    source: resolve(source),
    outDir: resolve(outDir),
    dryRun,
  };
}

function requiredValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function buildVariants(outDir: string): Variant[] {
  const variants: Variant[] = [];
  for (const houseCuts of HOUSE_CUT_COUNTS) {
    for (const players of PLAYER_COUNTS) {
      const totalSeconds = totalDurationSeconds(houseCuts, players);
      const keepCutAudioEnd = ROSTER_SECONDS + houseCuts * HOUSE_CUT_SECONDS;
      const sourceTailStart = ROSTER_SECONDS + MAX_HOUSE_CUTS * HOUSE_CUT_SECONDS;
      const sourceTailEnd = ROSTER_SECONDS
        + MAX_HOUSE_CUTS * HOUSE_CUT_SECONDS
        + FINAL_VOTE_SECONDS
        + WINNER_SECONDS
        + players * DOSSIER_SECONDS_PER_PLAYER;
      const name = `golden-verdict-${houseCuts}-cuts-${players}-players-${formatSeconds(totalSeconds)}s.m4a`;
      variants.push({
        houseCuts,
        players,
        totalSeconds,
        keepCutAudioEnd,
        sourceTailStart,
        sourceTailEnd,
        outputPath: resolve(outDir, name),
      });
    }
  }
  return variants;
}

function totalDurationSeconds(houseCuts: number, players: number): number {
  return ROSTER_SECONDS
    + houseCuts * HOUSE_CUT_SECONDS
    + FINAL_VOTE_SECONDS
    + WINNER_SECONDS
    + players * DOSSIER_SECONDS_PER_PLAYER;
}

async function renderVariant(source: string, variant: Variant): Promise<void> {
  const filters = filterGraphFor(variant);
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-i", source,
    "-filter_complex", filters.graph,
    "-map", filters.outputLabel,
    "-c:a", "aac",
    "-b:a", "192k",
    "-vn",
    variant.outputPath,
  ];
  await run("ffmpeg", args);
}

function filterGraphFor(variant: Variant): { graph: string; outputLabel: string } {
  const finalFadeStart = Math.max(0, variant.totalSeconds - END_FADE_SECONDS);

  if (variant.houseCuts === MAX_HOUSE_CUTS) {
    return {
      graph: [
        `[0:a]atrim=start=0:end=${formatSeconds(variant.sourceTailEnd)},asetpts=PTS-STARTPTS,`,
        `afade=t=out:st=${formatSeconds(finalFadeStart)}:d=${formatSeconds(END_FADE_SECONDS)}[outa]`,
      ].join(""),
      outputLabel: "[outa]",
    };
  }

  const firstFadeStart = Math.max(0, variant.keepCutAudioEnd - JOIN_FADE_SECONDS);
  const secondFadeEnd = Math.min(
    variant.sourceTailEnd - variant.sourceTailStart,
    JOIN_FADE_SECONDS,
  );

  return {
    graph: [
      `[0:a]atrim=start=0:end=${formatSeconds(variant.keepCutAudioEnd)},asetpts=PTS-STARTPTS,`,
      `afade=t=out:st=${formatSeconds(firstFadeStart)}:d=${formatSeconds(JOIN_FADE_SECONDS)}[a0];`,
      `[0:a]atrim=start=${formatSeconds(variant.sourceTailStart)}:end=${formatSeconds(variant.sourceTailEnd)},asetpts=PTS-STARTPTS,`,
      `afade=t=in:st=0:d=${formatSeconds(secondFadeEnd)}[a1];`,
      `[a0][a1]concat=n=2:v=0:a=1,`,
      `afade=t=out:st=${formatSeconds(finalFadeStart)}:d=${formatSeconds(END_FADE_SECONDS)}[outa]`,
    ].join(""),
    outputLabel: "[outa]",
  };
}

function formatSeconds(value: number): string {
  return value.toFixed(1);
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
