import { loadPayloads, Hydrated } from "./payload-storage.js";
import { isViewerGame } from "./game-visibility.js";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { werewolfDecisionArtifact, werewolfGameplayDecision } from "@influence/engine/werewolf";
import { exactStructuredOutputRegistry } from "@influence/engine";
import { projectWerewolfPresentation } from "@influence/engine/werewolf/presentation";
import { werewolfThinkingActions, type WerewolfThinking, type WerewolfThinkingEntry } from "@influence/engine/werewolf/thinking";
import { schema, type DrizzleDB } from "../db/index.js";
import { readWerewolfEvents, WerewolfGameError } from "./werewolf-games.js";
import { sha256StableJson } from "./stable-hash.js";

/** Explicit opt-in surface. Never return prompts, native reasoning, or pending calls. */
export async function readWerewolfThinking(db: Pick<DrizzleDB, "select">, id: string, audience: string, cursor: number): Promise<WerewolfThinking> {
  const result = await readWerewolfProductionThinking(db, id, audience, cursor);
  // Public reasoning remains audience-local. Canonical private sequence gaps
  // belong only to the separately authorized production source read.
  return { cursor: result.cursor, entries: result.entries.map(({ eventSequence: _eventSequence, ...entry }) => entry) };
}

export interface WerewolfProductionThinkingEntry extends WerewolfThinkingEntry { eventSequence: number }
export interface WerewolfProductionThinking { cursor: number; entries: WerewolfProductionThinkingEntry[] }

/** Producer-source evidence, batched once for a fixed accepted prefix. Route
 * authorization is required separately; this never widens Mystery visibility. */
export async function readWerewolfProductionThinking(db: Pick<DrizzleDB, "select">, id: string, audience: string, cursor: number, options: { throughEventSequence?: number; includeHidden?: boolean } = {}): Promise<WerewolfProductionThinking> {
  if (audience !== "omniscient") throw new WerewolfGameError("Thinking is available only in Omniscient mode", 403);
  const [game] = await db.select({ id: schema.games.id, config: schema.games.config, hiddenAt: schema.games.hiddenAt, startedAt: schema.games.startedAt }).from(schema.games).where(and(eq(schema.games.gameKind, "werewolf"), options.includeHidden ? undefined : isNull(schema.games.hiddenAt), or(eq(schema.games.id, id), eq(schema.games.slug, id))));
  if (!game || !isViewerGame(options.includeHidden ? { ...game, hiddenAt: null } : game)) throw new WerewolfGameError("Game not found", 404);
  if (!game.startedAt) throw new WerewolfGameError("This game has not started. Open its casting lobby.");
  const allEvents = await readWerewolfEvents(db, game.id);
  if (options.throughEventSequence !== undefined && (!Number.isSafeInteger(options.throughEventSequence) || options.throughEventSequence < 1 || !allEvents.some(event => event.sequence === options.throughEventSequence))) throw new WerewolfGameError("Invalid production thinking prefix");
  const events = options.throughEventSequence === undefined ? allEvents : allEvents.filter(event => event.sequence <= options.throughEventSequence!);
  const frame = projectWerewolfPresentation(events, "omniscient", cursor);
  const actions = werewolfThinkingActions(events, frame.view.cursor);
  const calls = await loadPayloads(db.select({ actorId: schema.providerLogicalCalls.actorId, action: schema.providerLogicalCalls.action,
    semantic: schema.providerLogicalCalls.semanticCoordinate, value: schema.providerLogicalCalls.acceptedValue,
    hash: schema.providerLogicalCalls.acceptedValueSha256 }).from(schema.providerLogicalCalls)
    .where(and(eq(schema.providerLogicalCalls.gameId, game.id), isNotNull(schema.providerLogicalCalls.acceptedAttemptId))));
  const bySequence = new Map<number, Hydrated<typeof calls>[number]>();
  const eligibleSequences = new Set(actions.map(action => action.event.sequence));
  for (const call of calls) {
    const semantic = call.semantic;
    if (!semantic || typeof semantic !== "object" || !("kind" in semantic) || semantic.kind !== "werewolf_action"
      || !("eventSequence" in semantic) || typeof semantic.eventSequence !== "number") continue;
    if (!eligibleSequences.has(semantic.eventSequence)) continue;
    if (bySequence.has(semantic.eventSequence)) throw new Error("Ambiguous Werewolf accepted thinking provenance");
    bySequence.set(semantic.eventSequence, call);
  }
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
    return thinking?.trim() ? [{ eventSequence: event.sequence, cursor, day, actorId: request.actorId, action: request.action, thinking }] : [];
  }) };
}
