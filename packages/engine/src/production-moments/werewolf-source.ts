import type { WerewolfAudience } from "../werewolf/observation";
import type { WerewolfThinkingEntry } from "../werewolf/thinking";
import { isWerewolfPlayable, type WerewolfWatchMoment } from "../werewolf/watch-contract";
import { assembleProductionCatalog, type ProductionSource } from "./index";

export interface WerewolfProductionThought extends WerewolfThinkingEntry { eventSequence: number }

/** Producer-only provenance joins the unchanged audience projection. Every
 * accepted thought owns its source even when several share one reveal cursor. */
export function buildWerewolfProductionSources(input: {
  gameId: string; audience: WerewolfAudience;
  moments: readonly WerewolfWatchMoment[];
  provenance: readonly { cursor: number; eventSequence: number }[];
  thoughts: readonly WerewolfProductionThought[];
  opening: boolean;
}): ProductionSource[] {
  const refs = new Map<number, number>();
  for (const row of input.provenance) {
    if (!Number.isSafeInteger(row.cursor) || row.cursor < 1 || !Number.isSafeInteger(row.eventSequence) || row.eventSequence < 1 || refs.has(row.cursor)) throw new Error("Invalid or ambiguous Werewolf production provenance");
    refs.set(row.cursor, row.eventSequence);
  }
  const sources: ProductionSource[] = input.opening ? [{ kind: "opening", gameKind: "werewolf", order: { anchor: 0, offset: 0 } }] : [];
  const thoughtsByCursor = new Map<number, WerewolfProductionThought[]>();
  if (input.audience === "omniscient") for (const thought of input.thoughts) {
    const group = thoughtsByCursor.get(thought.cursor) ?? [];
    group.push(thought); thoughtsByCursor.set(thought.cursor, group);
  }
  for (const group of thoughtsByCursor.values()) group.sort((a, b) => a.eventSequence - b.eventSequence);
  const cursors = new Set<number>();
  for (const moment of [...input.moments].sort((a, b) => a.cursor - b.cursor)) {
    if (moment.snapshot.gameId !== input.gameId || moment.snapshot.audience !== input.audience || cursors.has(moment.cursor)) throw new Error("Invalid or repeated Werewolf production row");
    const eventSequence = refs.get(moment.cursor);
    if (!eventSequence) throw new Error("Werewolf production row lacks accepted provenance");
    cursors.add(moment.cursor);
    // Silent/unavailable discussion turns remain diagnostic evidence, never editable playback moments.
    if (!isWerewolfPlayable(moment.entry)) continue;
    const actorId = moment.entry.kind === "speech" || moment.entry.kind === "conversation" || moment.entry.kind === "ballot" || moment.entry.kind === "proposal" ? moment.entry.actorId : moment.entry.kind === "discussion" ? moment.entry.contribution.actorId : undefined;
    const thoughts = thoughtsByCursor.get(moment.cursor) ?? [];
    for (const [index, thought] of thoughts.entries()) {
      if (thought.eventSequence > eventSequence) throw new Error("Werewolf thought cannot reveal before its accepted action");
      sources.push({ kind: "werewolf-action", eventSequence: thought.eventSequence, actorId: thought.actorId, action: thought.action, thinking: thought.thinking,
        defaultThinking: Boolean(actorId && actorId === thought.actorId), order: { anchor: moment.cursor, offset: index } });
    }
    sources.push({ kind: "werewolf-event", eventSequence, entry: moment.entry, rulesVersion: moment.snapshot.rulesVersion,
      ...(input.audience === "omniscient" && moment.night ? { nightActions: moment.night.actions } : {}),
      order: { anchor: moment.cursor, offset: thoughts.length } });
  }
  if (input.audience === "omniscient" && input.thoughts.some(thought => !cursors.has(thought.cursor))) throw new Error("Werewolf thinking is outside the fixed production prefix");
  assembleProductionCatalog({ gameId: input.gameId, gameKind: "werewolf", audience: input.audience, sources });
  return sources;
}
