import { isViewerGame } from "./game-visibility.js";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { werewolfDecisionArtifact, werewolfGameplayDecision } from "@influence/engine/werewolf";
import { exactStructuredOutputRegistry } from "@influence/engine";
import { projectWerewolfPresentation } from "@influence/engine/werewolf/presentation";
import { werewolfThinkingActions, type WerewolfThinking } from "@influence/engine/werewolf/thinking";
import { schema, type DrizzleDB } from "../db/index.js";
import { readWerewolfEvents, WerewolfGameError } from "./werewolf-games.js";
import { sha256StableJson } from "./stable-hash.js";

/** Explicit opt-in surface. Never return prompts, native reasoning, or pending calls. */
export async function readWerewolfThinking(db: DrizzleDB, id: string, audience: string, cursor: number): Promise<WerewolfThinking> {
  if (audience !== "omniscient") throw new WerewolfGameError("Thinking is available only in Omniscient mode", 403);
  const [game] = await db.select({ id: schema.games.id, config: schema.games.config, hiddenAt: schema.games.hiddenAt, startedAt: schema.games.startedAt }).from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
  if (!game || !isViewerGame(game)) throw new WerewolfGameError("Game not found", 404);
  if (!game.startedAt) throw new WerewolfGameError("This game has not started. Open its casting lobby.");
  const events = await readWerewolfEvents(db, game.id);
  const frame = projectWerewolfPresentation(events, "omniscient", cursor);
  const actions = werewolfThinkingActions(events, frame.view.cursor);
  const calls = await db.select({ actorId: schema.providerLogicalCalls.actorId, action: schema.providerLogicalCalls.action,
    semantic: schema.providerLogicalCalls.semanticCoordinate, value: schema.providerLogicalCalls.acceptedValue,
    hash: schema.providerLogicalCalls.acceptedValueSha256 }).from(schema.providerLogicalCalls)
    .where(and(eq(schema.providerLogicalCalls.gameId, game.id), isNotNull(schema.providerLogicalCalls.acceptedAttemptId)));
  const bySequence = new Map(calls.flatMap(call => {
    const semantic = call.semantic;
    return semantic && typeof semantic === "object" && "kind" in semantic && semantic.kind === "werewolf_action"
      && "eventSequence" in semantic && typeof semantic.eventSequence === "number" ? [[semantic.eventSequence, call] as const] : [];
  }));
  return { cursor: frame.view.cursor, entries: actions.flatMap(({ event, day, cursor }) => {
    const { decision, fallback: _fallback, ...request } = event.payload;
    // Target actions already persisted thinking as part of their accepted decision.
    let thinking = decision.kind === "target" ? decision.thinking : null;
    if (decision.kind !== "target") {
      const call = bySequence.get(event.sequence);
      if (call && call.value && typeof call.value === "object" && "thinking" in call.value && call.actorId === request.actorId && call.action === `werewolf.${request.action}`) {
        if (call.hash !== sha256StableJson(call.value)) throw new Error("Werewolf thinking evidence failed integrity check");
        const decoded = exactStructuredOutputRegistry.decodeAcceptedValue(werewolfDecisionArtifact(request), call.value);
        if (decoded.status !== "valid") throw new Error("Invalid accepted Werewolf thinking evidence");
        if (sha256StableJson(werewolfGameplayDecision(decoded.value)) !== sha256StableJson(decision)) throw new Error("Werewolf thinking does not match the committed action");
        thinking = decoded.value.thinking;
      }
    }
    return thinking?.trim() ? [{ cursor, day, actorId: request.actorId, action: request.action, thinking }] : [];
  }) };
}
