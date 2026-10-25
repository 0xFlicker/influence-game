/** Presentation coordinates only; never carried into a contestant observation. */
export type AudioWatchCoordinate =
  | { kind: "werewolf"; cursor: number; action?: "protect" | "investigate"; actorId: string | null; part: "speech" | "thinking" }
  | { kind: "influence"; transcriptId?: string; eventSequence: number; actorId: string | null; part: "speech" | "thinking" };
