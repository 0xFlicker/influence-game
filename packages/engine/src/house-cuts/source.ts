import { createHash } from "node:crypto";
import type { ReplayAudience } from "../game-links";

export interface CutEvidence {
  id: string;
  group: string;
  label: string;
  position: number;
  participantIds: string[];
  replayHref: string | null;
  content: { kind: "dialogue"; speakerId: string; text: string }
    | { kind: "fact"; value: object };
}
export interface CutSource {
  version: "house-cuts-prototype-v1";
  game: { id: string; slug: string; kind: "influence" | "werewolf" };
  audience: "public" | ReplayAudience;
  cast: Array<{ id: string; name: string }>;
  evidence: CutEvidence[];
  limitations: string[];
  hash: string;
}

/** Hash only the permitted projection, not private events or mutable profiles. */
export function cutSource(input: Omit<CutSource, "version" | "hash">): CutSource {
  const source = structuredClone({ version: "house-cuts-prototype-v1" as const, ...input });
  const cast = new Set(source.cast.map(p => p.id));
  if (!cast.size || cast.size !== source.cast.length) throw new Error("Invalid Cut cast");
  const refs = new Set<string>();
  for (const entry of source.evidence) {
    if (refs.has(entry.id) || !Number.isSafeInteger(entry.position) || entry.position < 1) throw new Error("Invalid Cut source reference");
    refs.add(entry.id);
    if (entry.participantIds.some(id => !cast.has(id))) throw new Error("Unknown Cut participant");
    if (entry.content.kind === "dialogue" && (!entry.participantIds.includes(entry.content.speakerId) || !entry.content.text.trim())) throw new Error("Invalid Cut dialogue");
  }
  return { ...source, hash: createHash("sha256").update(JSON.stringify(source)).digest("hex") };
}
