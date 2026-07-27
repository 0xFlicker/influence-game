import type { CanonicalGameProjection } from "./game-projection";
import type {
  RevealedExposureBenchEntry,
} from "./revealed-round-facts";
import type { UUID } from "./types";

export function exposureBenchEntries(value: unknown, projection: CanonicalGameProjection): RevealedExposureBenchEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: RevealedExposureBenchEntry[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    entries.push({
      player: {
        id: item.id,
        name: projection.players[item.id]?.name ?? item.id,
      },
      exposeScore: typeof item.exposeScore === "number" ? item.exposeScore : null,
    });
  }
  return entries;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function stringArray(value: unknown): UUID[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is UUID => typeof item === "string");
}

export function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}
