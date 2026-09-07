import { formatsAvailableForSelection, isRegisteredFormatId } from "./catalog";
import type { UUID } from "../types";
import type { LaunchFormatId } from "./types";

export interface FormatMenuInput {
  /** Frozen per-game legal set. Cast-size fitness is identity in this slice. */
  formatManifest: readonly LaunchFormatId[];
  /** Previous round's selected format, if any. */
  lastFormatId: LaunchFormatId | null;
  /** One-based game round used for catalog admission rules. */
  round: number;
  /** Canonical living roster at this round's selection boundary. */
  livingIds: readonly UUID[];
  /** Optional RNG in [0, 1). Defaults to Math.random. */
  random?: () => number;
}

export interface FormatMenuResult {
  offered: [LaunchFormatId, LaunchFormatId] | null;
  autoSelected: LaunchFormatId | null;
}

/**
 * Build a two-option menu from the frozen manifest, excluding the last format
 * whenever at least two alternatives remain. A single-format manifest skips it.
 */
export function buildFormatMenu(input: FormatMenuInput): FormatMenuResult {
  const random = input.random ?? Math.random;
  const last = input.lastFormatId;
  const manifest = formatsAvailableForSelection(input.formatManifest, {
    round: input.round,
    livingIds: input.livingIds,
  });
  if (manifest.length === 0) {
    throw new Error(`Format manifest has no formats available in round ${input.round}`);
  }

  if (manifest.length === 1) {
    return { offered: null, autoSelected: manifest[0]! };
  }

  if (last !== null && manifest.includes(last)) {
    const remaining = manifest.filter((id) => id !== last);
    if (remaining.length >= 2) {
      const shuffled = shuffleFormats(remaining, random);
      return { offered: [shuffled[0]!, shuffled[1]!], autoSelected: null };
    }
  }

  const shuffled = shuffleFormats(manifest, random);
  return { offered: [shuffled[0]!, shuffled[1]!], autoSelected: null };
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
  return isRegisteredFormatId(value);
}

export function pickFormatFromMenu(
  offered: readonly LaunchFormatId[],
  chosen: string,
): LaunchFormatId | null {
  if (!isLaunchFormatId(chosen)) return null;
  return offered.includes(chosen) ? chosen : null;
}
