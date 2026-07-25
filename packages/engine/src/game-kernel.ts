import type { CanonicalGameEvent } from "./canonical-events";

/**
 * Durable match-spine identity for a deployed game.
 * Names the mode (classic Power→Council vs format kernel), not a round format card.
 */
export type GameKernel = "classic" | "format";

export type GameKernelSource = "stored" | "inferred";

export interface ResolveGameKernelResult {
  kernel: GameKernel;
  source: GameKernelSource;
}

export interface ResolveGameKernelOptions {
  /** Column value from games.game_kernel; null/undefined means unstamped history. */
  stored?: string | null;
  /** Trusted event prefix used only when stored is absent. */
  events?: readonly CanonicalGameEvent[];
}

const STORED_KERNELS = new Set<GameKernel>(["classic", "format"]);

/**
 * Resolve game kernel for producer/MCP reads.
 * Non-null stored wins. Null/invalid stored → infer from format.* evidence, else classic.
 */
export function resolveGameKernel(options: ResolveGameKernelOptions): ResolveGameKernelResult {
  const stored = normalizeStoredKernel(options.stored);
  if (stored) {
    return { kernel: stored, source: "stored" };
  }

  if (hasFormatKernelEvidence(options.events ?? [])) {
    return { kernel: "format", source: "inferred" };
  }

  return { kernel: "classic", source: "inferred" };
}

function normalizeStoredKernel(stored: string | null | undefined): GameKernel | null {
  if (stored === null || stored === undefined) return null;
  if (STORED_KERNELS.has(stored as GameKernel)) {
    return stored as GameKernel;
  }
  return null;
}

function hasFormatKernelEvidence(events: readonly CanonicalGameEvent[]): boolean {
  for (const event of events) {
    switch (event.type) {
      case "format.menu_offered":
      case "format.selected":
      case "format.resolved":
      case "format.ballot_cast":
      case "format.safety_bounce_started":
      case "format.safety_bounce_pointer":
        return true;
      default:
        break;
    }
  }
  return false;
}
