import type { CanonicalGameEvent } from "./canonical-events";

/**
 * Durable match-spine identity for a deployed game.
 * Names the mode (classic Power→Council vs format kernel), not a round format card.
 */
export type GameKernel = "classic" | "format";

export type GameKernelSource = "stored" | "inferred";

export interface GameKernelContradictionDiagnostic {
  code: "stored_kernel_event_contradiction";
  message: string;
  storedKernel: GameKernel;
  evidenceKernel: GameKernel;
  eventType: CanonicalGameEvent["type"];
  sequence: number;
}

export interface ResolveGameKernelResult {
  kernel: GameKernel;
  source: GameKernelSource;
  diagnostics: GameKernelContradictionDiagnostic[];
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
    const contradictoryEvent = firstContradictoryKernelEvent(
      stored,
      options.events ?? [],
    );
    return {
      kernel: stored,
      source: "stored",
      diagnostics: contradictoryEvent
        ? [{
            code: "stored_kernel_event_contradiction",
            message: `Stored ${stored} kernel contradicts trusted ${contradictoryEvent.evidenceKernel} event ${contradictoryEvent.event.type}.`,
            storedKernel: stored,
            evidenceKernel: contradictoryEvent.evidenceKernel,
            eventType: contradictoryEvent.event.type,
            sequence: contradictoryEvent.event.sequence,
          }]
        : [],
    };
  }

  if (hasFormatKernelEvidence(options.events ?? [])) {
    return { kernel: "format", source: "inferred", diagnostics: [] };
  }

  return { kernel: "classic", source: "inferred", diagnostics: [] };
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

function firstContradictoryKernelEvent(
  stored: GameKernel,
  events: readonly CanonicalGameEvent[],
): { evidenceKernel: GameKernel; event: CanonicalGameEvent } | null {
  for (const event of events) {
    const evidenceKernel = eventKernelEvidence(event);
    if (evidenceKernel && evidenceKernel !== stored) {
      return { evidenceKernel, event };
    }
  }
  return null;
}

function eventKernelEvidence(event: CanonicalGameEvent): GameKernel | null {
  switch (event.type) {
    case "format.menu_offered":
    case "format.selected":
    case "format.resolved":
    case "format.ballot_cast":
    case "format.safety_bounce_started":
    case "format.safety_bounce_pointer":
      return "format";
    case "power.action_set":
    case "power.candidates_resolved":
    case "council.vote_cast":
    case "council.elimination_resolved":
      return "classic";
    default:
      return null;
  }
}
