import { LAUNCH_FORMAT_IDS, type LaunchFormatId } from "./types";

export interface FormatMenuInput {
  /** Previous round's selected format, if any. */
  lastFormatId: LaunchFormatId | null;
  /** Optional RNG in [0, 1). Defaults to Math.random. */
  random?: () => number;
}

export interface FormatMenuResult {
  offered: [LaunchFormatId, LaunchFormatId];
}

/**
 * Build a two-option format menu.
 * Round 1 (no last format): any two of three (first + second by shuffled order).
 * Later rounds: the two formats that are not last round's selection.
 */
export function buildFormatMenu(input: FormatMenuInput): FormatMenuResult {
  const random = input.random ?? Math.random;
  const last = input.lastFormatId;

  if (last !== null && LAUNCH_FORMAT_IDS.includes(last)) {
    const remaining = LAUNCH_FORMAT_IDS.filter((id) => id !== last) as LaunchFormatId[];
    if (remaining.length >= 2) {
      return { offered: [remaining[0]!, remaining[1]!] };
    }
  }

  const shuffled = shuffleFormats([...LAUNCH_FORMAT_IDS], random);
  return { offered: [shuffled[0]!, shuffled[1]!] };
}

function shuffleFormats(ids: LaunchFormatId[], random: () => number): LaunchFormatId[] {
  const copy = [...ids];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy;
}

export function isLaunchFormatId(value: string): value is LaunchFormatId {
  return (LAUNCH_FORMAT_IDS as readonly string[]).includes(value);
}

export function pickFormatFromMenu(
  offered: readonly LaunchFormatId[],
  chosen: string,
): LaunchFormatId | null {
  if (!isLaunchFormatId(chosen)) return null;
  return offered.includes(chosen) ? chosen : null;
}
