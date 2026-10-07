import { resolveWerewolfStrategy, type WerewolfPlayer } from "@influence/engine/werewolf";
import type { schema } from "../db/index.js";
import { sha256StableJson } from "./stable-hash.js";

export type ReviewGameKind = "influence" | "werewolf";
export type ReviewStrategyField = "strategyStyle" | "werewolfStrategyStyle";
type Profile = typeof schema.agentProfiles.$inferSelect;

export function reviewStrategyField(kind: ReviewGameKind): ReviewStrategyField {
  return kind === "werewolf" ? "werewolfStrategyStyle" : "strategyStyle";
}

/** Art and the other game's strategy do not change this game's learning identity. */
export function werewolfReviewIdentity(player: Pick<WerewolfPlayer, "name" | "personality" | "backstory" | "personaKey" | "strategy">): string {
  return `werewolf-review-v1:${sha256StableJson({ name: player.name, personality: player.personality,
    backstory: player.backstory, personaKey: player.personaKey ?? null, strategy: player.strategy })}`;
}

export function currentReviewIdentity(kind: ReviewGameKind, profile: Pick<Profile,
  "name" | "personality" | "backstory" | "personaKey" | "werewolfStrategyStyle" | "currentRevisionId">): string | null {
  return kind === "influence" ? profile.currentRevisionId : werewolfReviewIdentity({
    name: profile.name, personality: profile.personality, backstory: profile.backstory ?? "",
    personaKey: profile.personaKey,
    strategy: resolveWerewolfStrategy(profile.werewolfStrategyStyle, profile.personaKey),
  });
}
