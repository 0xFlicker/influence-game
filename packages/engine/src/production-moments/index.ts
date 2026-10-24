import type { WerewolfAudience, WerewolfPublicEntry } from "../werewolf/observation";
import type { WerewolfAction } from "../werewolf/types";
import { werewolfNightSteps, type WerewolfNightAction } from "../werewolf/watch-contract";

export type ProductionGameKind = "influence" | "werewolf";
export type ProductionAudience = "public" | WerewolfAudience;
export type ProductionTags = Readonly<Record<string, string>>;

/** Audience-local positions determine reveal order, never saved identity. */
export interface ProductionSourceOrder { anchor: number; offset: number }

export type ProductionSourceReference =
  | { kind: "influence-transcript"; transcriptId: string }
  | { kind: "influence-event"; eventSequence: number }
  | { kind: "werewolf-event"; eventSequence: number }
  | { kind: "werewolf-action"; eventSequence: number }
  | { kind: "opening"; gameKind: ProductionGameKind }
  | { kind: "influence-bridge"; following: Exclude<ProductionSourceReference, { kind: "influence-bridge" }>; followingPart: ProductionMomentPart };

export const INFLUENCE_PRESENTATION_KINDS = [
  "empowered_tally", "empowered_tie", "format_menu", "format_selected",
  "safety_bounce_started", "safety_bounce_pointer", "two_names_empowered_intro",
  "two_names_initial_names", "two_names_override_draw", "two_names_mingle_complete",
  "two_names_override_declined", "two_names_override_removed", "two_names_replacement",
  "two_names_plea", "format_aggregate", "format_roll_call", "format_tiebreak",
  "format_deciding_vote", "format_elimination", "endgame_ballot", "endgame_elimination",
  "endgame_winner", "empower_ballot", "ballot_tally",
] as const;
export type InfluenceProductionPresentationKind = typeof INFLUENCE_PRESENTATION_KINDS[number];

export type InfluenceProductionPresentation =
  | { kind: "format_selected"; stage: "choice_legible" | "rules_reveal"; actorId?: string }
  | { kind: "two_names_mingle_complete"; window: "initial_names" | "final_names" }
  | { kind: "format_roll_call" | "endgame_ballot" | "empower_ballot"; voterId: string; juryTiebreaker?: boolean; revote?: boolean }
  | { kind: "ballot_tally"; purpose: "empower" | "format" | "eliminate" | "winner"; juryTiebreaker: boolean; revote: boolean }
  | { kind: Exclude<InfluenceProductionPresentationKind, "format_selected" | "two_names_mingle_complete" | "format_roll_call" | "endgame_ballot" | "empower_ballot" | "ballot_tally">; actorId?: string };

export type ProductionMomentPart =
  | { kind: "speech" | "scene" | "opening" | "bridge" | "tally" | "outcome" | "result" | "protect" | "investigate" | "hunt" | "pack_vote" }
  | { kind: "night-speech"; action: "protect" | "investigate" }
  | { kind: "thinking"; actorId?: string }
  | { kind: "ballot"; voterId: string; purpose: "day" | "pack" | "empower" | "eliminate" | "winner"; juryTiebreaker: boolean; revote: boolean }
  | { kind: "influence-presentation"; presentation: InfluenceProductionPresentation };

interface OrderedProductionSource { order: ProductionSourceOrder }

/** Sources are already game-owned, accepted projections. No prose classification
 * or gameplay reduction occurs here. The assembler owns semantic eligibility. */
export type ProductionSource =
  | (OrderedProductionSource & {
      kind: "influence-transcript"; transcriptId: string;
      presentation: "speech" | "scene" | "ballot";
      ballot?: { voterId: string; purpose: "empower" | "eliminate" | "winner" };
      actorId?: string; thinking?: string | null; defaultThinking?: boolean;
      retrospectiveSource?: { eventSequence: number; ordinal: number };
    })
  | (OrderedProductionSource & {
      kind: "influence-event"; eventSequence: number;
      presentation: InfluenceProductionPresentation; actorId?: string;
      thinking?: string | null; defaultThinking?: boolean;
    })
  | (OrderedProductionSource & {
      kind: "influence-thinking"; eventSequence: number; actorId: string;
      thinking: string; defaultThinking: boolean;
    })
  | (OrderedProductionSource & {
      kind: "werewolf-event"; eventSequence: number; entry: WerewolfPublicEntry;
      rulesVersion?: 7 | 8 | 9 | 10;
      nightActions?: readonly WerewolfNightAction[];
    })
  | (OrderedProductionSource & {
      kind: "werewolf-action"; eventSequence: number; actorId: string;
      action: WerewolfAction; thinking: string; defaultThinking: boolean;
    })
  | (OrderedProductionSource & { kind: "opening"; gameKind: ProductionGameKind })
  | (OrderedProductionSource & { kind: "influence-bridge"; following: Exclude<ProductionSourceReference, { kind: "influence-bridge" }>; followingPart: ProductionMomentPart });

export const PRODUCTION_MOMENT_KINDS = ["thinking", "speech", "ballot", "tally", "scene", "action", "outcome", "result", "opening", "bridge"] as const;
export type ProductionMomentKind = typeof PRODUCTION_MOMENT_KINDS[number];
export interface ProductionMoment {
  id: string;
  sourceKey: string;
  source: ProductionSourceReference;
  part: ProductionMomentPart;
  kind: ProductionMomentKind;
  order: ProductionSourceOrder;
  /** Finite presentation expansion within this source anchor. */
  semanticOrder: number;
  actorId?: string;
  purpose?: "retrospective";
  retrospectiveSource?: { eventSequence: number; ordinal: number };
  /** Adding catalog coverage must not silently expand existing full movies. */
  defaultIncluded: boolean;
}
export interface ProductionCatalog {
  gameId: string;
  gameKind: ProductionGameKind;
  audience: ProductionAudience;
  moments: ProductionMoment[];
}

function nonempty(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.length || value.length > 512) throw new Error(`Invalid production ${label}`);
}
function sequence(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || typeof value !== "number" || value < 1) throw new Error("Invalid production event sequence");
}
function validateOrder(order: ProductionSourceOrder) {
  if (!order || !Number.isSafeInteger(order.anchor) || order.anchor < 0 || !Number.isSafeInteger(order.offset) || order.offset < 0) throw new Error("Invalid production source order");
}

function referenceValue(ref: ProductionSourceReference): unknown[] {
  switch (ref.kind) {
    case "influence-transcript": nonempty(ref.transcriptId, "transcript ID"); return [ref.kind, ref.transcriptId];
    case "influence-event": case "werewolf-event": case "werewolf-action": sequence(ref.eventSequence); return [ref.kind, ref.eventSequence];
    case "opening":
      if (ref.gameKind !== "influence" && ref.gameKind !== "werewolf") throw new Error("Invalid production opening game");
      return [ref.kind, ref.gameKind];
    case "influence-bridge":
      if (ref.following.kind !== "influence-transcript" && ref.following.kind !== "influence-event") throw new Error("A House bridge requires an Influence source");
      return [ref.kind, referenceValue(ref.following), partValue(ref.followingPart)];
    default: throw new Error("Unsupported production source reference");
  }
}

function presentationValue(presentation: InfluenceProductionPresentation): unknown[] {
  if (!INFLUENCE_PRESENTATION_KINDS.includes(presentation.kind)) throw new Error("Unsupported Influence production presentation");
  if ("actorId" in presentation && presentation.actorId !== undefined) nonempty(presentation.actorId, "actor ID");
  switch (presentation.kind) {
    case "format_selected":
      if (presentation.stage !== "choice_legible" && presentation.stage !== "rules_reveal") throw new Error("Unsupported format selection stage");
      return [presentation.kind, presentation.stage];
    case "two_names_mingle_complete":
      if (presentation.window !== "initial_names" && presentation.window !== "final_names") throw new Error("Unsupported Two Names window");
      return [presentation.kind, presentation.window];
    case "format_roll_call": case "endgame_ballot": case "empower_ballot":
      nonempty(presentation.voterId, "voter ID");
      if (presentation.juryTiebreaker !== undefined && typeof presentation.juryTiebreaker !== "boolean" || presentation.revote !== undefined && typeof presentation.revote !== "boolean") throw new Error("Invalid ballot discriminator");
      return [presentation.kind, presentation.voterId, presentation.juryTiebreaker ?? false, presentation.revote ?? false];
    case "ballot_tally":
      if (!["empower", "format", "eliminate", "winner"].includes(presentation.purpose) || typeof presentation.juryTiebreaker !== "boolean" || typeof presentation.revote !== "boolean") throw new Error("Invalid production tally discriminator");
      return [presentation.kind, presentation.purpose, presentation.juryTiebreaker, presentation.revote];
    default: return [presentation.kind];
  }
}

function partValue(part: ProductionMomentPart): unknown[] {
  switch (part.kind) {
    case "ballot":
      nonempty(part.voterId, "voter ID");
      if (!["day", "pack", "empower", "eliminate", "winner"].includes(part.purpose) || typeof part.juryTiebreaker !== "boolean" || typeof part.revote !== "boolean") throw new Error("Invalid production ballot part");
      return [part.kind, part.voterId, part.purpose, part.juryTiebreaker, part.revote];
    case "influence-presentation": return [part.kind, ...presentationValue(part.presentation)];
    case "night-speech":
      if (part.action !== "protect" && part.action !== "investigate") throw new Error("Invalid night speech action");
      return [part.kind, part.action];
    case "thinking":
      if (part.actorId !== undefined) { nonempty(part.actorId, "thinking actor ID"); return [part.kind, part.actorId]; }
      return [part.kind];
    case "speech": case "scene": case "opening": case "bridge": case "tally": case "outcome": case "result": case "protect": case "investigate": case "hunt": case "pack_vote": return [part.kind];
    default: throw new Error("Unsupported production semantic part");
  }
}

/** Keys are data, never authorization. Resolve submitted keys against a fresh
 * authorized catalog. These producer-only references do not replace public DTOs. */
export function productionSourceKey(gameId: string, source: ProductionSourceReference): string {
  nonempty(gameId, "game ID");
  return `ps1:${encodeURIComponent(JSON.stringify([gameId, ...referenceValue(source)]))}`;
}
export function productionMomentKey(gameId: string, source: ProductionSourceReference, part: ProductionMomentPart): string {
  nonempty(gameId, "game ID");
  return `pm1:${encodeURIComponent(JSON.stringify([gameId, referenceValue(source), partValue(part)]))}`;
}

function sourceReference(source: ProductionSource): ProductionSourceReference {
  switch (source.kind) {
    case "influence-transcript": return { kind: source.kind, transcriptId: source.transcriptId };
    case "influence-event": case "werewolf-event": case "werewolf-action": return { kind: source.kind, eventSequence: source.eventSequence };
    case "influence-thinking": return { kind: "influence-event", eventSequence: source.eventSequence };
    case "opening": return { kind: source.kind, gameKind: source.gameKind };
    case "influence-bridge": return { kind: source.kind, following: source.following, followingPart: source.followingPart };
    default: throw new Error("Unsupported production source");
  }
}

/** The same assembler is used before storage validation and browser compilation.
 * All ordering metadata is separate from the stable source/semantic-part key. */
export function assembleProductionCatalog(input: {
  gameId: string; gameKind: ProductionGameKind; audience: ProductionAudience;
  sources: readonly ProductionSource[];
}): ProductionCatalog {
  nonempty(input.gameId, "game ID");
  if (input.gameKind === "influence" ? input.audience !== "public" : input.gameKind !== "werewolf" || !["mystery", "omniscient"].includes(input.audience)) throw new Error("Invalid production game audience");
  const moments: ProductionMoment[] = [];
  const seen = new Map<string, ProductionSourceOrder>();
  for (const source of input.sources) {
    validateOrder(source.order);
    const ref = sourceReference(source);
    referenceValue(ref);
    const sourceGame = source.kind.startsWith("influence") ? "influence" : source.kind.startsWith("werewolf") ? "werewolf" : source.kind === "opening" ? source.gameKind : null;
    if (sourceGame !== input.gameKind) throw new Error("Cross-game production source");
    const emit = (part: ProductionMomentPart, kind: ProductionMomentKind, semanticOrder: number, defaultIncluded = true, actorId?: string) => {
      if (actorId !== undefined) nonempty(actorId, "actor ID");
      const id = productionMomentKey(input.gameId, ref, part);
      const prior = seen.get(id);
      if (prior) throw new Error(`Duplicate or ambiguous production moment ${id} at ${JSON.stringify(prior)} and ${JSON.stringify(source.order)}`);
      seen.set(id, source.order);
      const retrospective = kind === "speech" ? source.kind === "influence-transcript" ? source.retrospectiveSource
        : source.kind === "werewolf-event" && source.entry.kind === "speech" && source.entry.purpose === "retrospective" ? { eventSequence: source.eventSequence, ordinal: source.entry.ordinal } : undefined : undefined;
      if (retrospective) {
        sequence(retrospective.eventSequence);
        if (!actorId || !Number.isSafeInteger(retrospective.ordinal) || retrospective.ordinal < 0 || retrospective.ordinal >= 12) throw new Error("Invalid retrospective production provenance");
      }
      moments.push({ id, sourceKey: productionSourceKey(input.gameId, ref), source: ref, part, kind, order: { ...source.order }, semanticOrder, defaultIncluded, ...(actorId !== undefined ? { actorId } : {}),
        ...(retrospective ? { purpose: "retrospective" as const, retrospectiveSource: retrospective } : {}) });
    };
    const thought = (text: string | null | undefined, full: boolean | undefined, actorId?: string) => {
      if (text !== undefined && text !== null && typeof text !== "string") throw new Error("Invalid production thinking evidence");
      if (full !== undefined && typeof full !== "boolean") throw new Error("Invalid production full-thinking eligibility");
      if (text?.trim()) { nonempty(actorId, "thinking actor ID"); emit({ kind: "thinking", ...(ref.kind === "influence-event" ? { actorId } : {}) }, "thinking", 0, full ?? false, actorId); }
    };
    switch (source.kind) {
      case "influence-transcript":
        thought(source.thinking, source.defaultThinking, source.actorId);
        if (source.presentation === "ballot") {
          if (!source.ballot) throw new Error("Transcript ballot requires structured provenance");
          emit({ kind: "ballot", ...source.ballot, juryTiebreaker: false, revote: false }, "ballot", 1, true, source.ballot.voterId);
        } else if (source.presentation === "speech" || source.presentation === "scene") {
          if (source.ballot) throw new Error("Ambiguous transcript ballot presentation");
          emit({ kind: source.presentation }, source.presentation, 1, true, source.actorId);
        } else throw new Error("Unsupported transcript presentation");
        break;
      case "influence-event": {
        const p = source.presentation;
        presentationValue(p);
        const actorId = source.actorId ?? ("actorId" in p ? p.actorId : "voterId" in p ? p.voterId : undefined);
        thought(source.thinking, source.defaultThinking, actorId);
        const kind: ProductionMomentKind = ["format_roll_call", "endgame_ballot", "empower_ballot"].includes(p.kind) ? "ballot"
          : ["empowered_tally", "empowered_tie", "format_aggregate", "ballot_tally"].includes(p.kind) ? "tally"
          : p.kind === "endgame_winner" ? "result"
          : ["format_elimination", "endgame_elimination"].includes(p.kind) ? "outcome"
          : p.kind === "two_names_plea" ? "speech" : "action";
        emit({ kind: "influence-presentation", presentation: p }, kind, 1, true, actorId);
        break;
      }
      case "influence-thinking": thought(source.thinking, source.defaultThinking, source.actorId); break;
      case "opening": emit({ kind: "opening" }, "opening", 0); break;
      case "influence-bridge": emit({ kind: "bridge" }, "bridge", 0); break;
      case "werewolf-action":
        if (!["introduce", "discuss", "open_thread", "pack_talk", "attack", "protect", "investigate", "vote", "conversation", "public_vote", "pack_propose"].includes(source.action)) throw new Error("Unsupported Werewolf thinking action");
        if (input.audience === "omniscient") thought(source.thinking, source.defaultThinking, source.actorId);
        break;
      case "werewolf-event": assembleWerewolfParts(source, input.audience, emit); break;
    }
  }
  moments.sort((a, b) => a.order.anchor - b.order.anchor || a.order.offset - b.order.offset || a.semanticOrder - b.semanticOrder || a.id.localeCompare(b.id));
  return { gameId: input.gameId, gameKind: input.gameKind, audience: input.audience, moments };
}

function assembleWerewolfParts(source: Extract<ProductionSource, { kind: "werewolf-event" }>, audience: ProductionAudience,
  emit: (part: ProductionMomentPart, kind: ProductionMomentKind, order: number, full?: boolean, actorId?: string) => void) {
  const entry = source.entry;
  if (audience === "mystery" && (entry.kind === "pack_vote" || entry.kind === "speech" && entry.audience === "pack")) return;
  if (source.nightActions?.length && entry.kind !== "night") throw new Error("Night staging requires a resolved night source");
  switch (entry.kind) {
    case "phase": break;
    case "speech": if (entry.text?.trim()) emit({ kind: "speech" }, "speech", 1, true, entry.actorId); break;
    case "discussion": if (!entry.contribution.unavailable && entry.contribution.text?.trim()) emit({ kind: "speech" }, "speech", 1, true, entry.contribution.actorId); break;
    case "conversation": if (!entry.unavailable && entry.text?.trim()) emit({ kind: "speech" }, "speech", 1, true, entry.actorId); break;
    // The spoken vote and its collection into the ledger share one replay cue.
    case "ballot": emit({ kind: "ballot", voterId: entry.actorId, purpose: "day", juryTiebreaker: false, revote: false }, "ballot", 2, true, entry.actorId); break;
    case "proposal": if (audience === "omniscient" && !entry.unavailable && entry.text?.trim()) emit({ kind: "speech" }, "speech", 1, false, entry.actorId); break;
    case "vote": {
      if ((source.rulesVersion ?? 8) >= 9) { emit({ kind: "tally" }, "tally", 0); emit({ kind: "outcome" }, "outcome", 1); break; }
      const rank = (b: { targetId: string | null; unavailable: boolean }) => b.targetId ? 0 : b.unavailable ? 1 : 2;
      const ballots = [...entry.result.ballots].sort((a, b) => rank(a) - rank(b));
      for (const [index, ballot] of ballots.entries()) emit({ kind: "ballot", voterId: ballot.voterId, purpose: "day", juryTiebreaker: false, revote: false }, "ballot", index, true, ballot.voterId);
      if (ballots.length) emit({ kind: "tally" }, "tally", ballots.length);
      emit({ kind: "outcome" }, "outcome", ballots.length + 1);
      break;
    }
    case "pack_vote":
      for (const [index, ballot] of entry.result.ballots.entries()) emit({ kind: "ballot", voterId: ballot.voterId, purpose: "pack", juryTiebreaker: false, revote: false }, "ballot", index, false, ballot.voterId);
      emit({ kind: "pack_vote" }, "tally", entry.result.ballots.length); break;
    case "night":
      if (audience === "omniscient") for (const [index, {action, decision}] of werewolfNightSteps(source.nightActions ?? []).entries()) {
        if (decision && action.kind !== "hunt") emit({kind: "night-speech", action: action.kind}, "speech", index, true, action.actorId);
        else emit({ kind: action.kind }, "action", index, true, "actorId" in action ? action.actorId : undefined);
      }
      emit({ kind: "outcome" }, "outcome", audience === "omniscient" ? werewolfNightSteps(source.nightActions ?? []).length : 0);
      break;
    case "result": emit({ kind: "result" }, "result", 0); break;
    default: throw new Error("Unsupported Werewolf production source");
  }
}

const RESERVED_TAG_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** Shared request/predicate validation: exact strings, no normalization. */
export function validateProductionTags(value: unknown, requireNonempty = false): ProductionTags {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Production tags must be a flat object");
  const pairs = Object.entries(value);
  if (pairs.length > 32 || requireNonempty && pairs.length === 0) throw new Error("Production tags require 1–32 pairs for a selection and at most 32 for an annotation");
  const encoder = new TextEncoder();
  const result: Record<string, string> = Object.create(null);
  for (const [key, entry] of pairs) {
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(key) || RESERVED_TAG_KEYS.has(key)) throw new Error(`Invalid production tag key ${key}`);
    if (typeof entry !== "string" || !entry.length || encoder.encode(entry).length > 256) throw new Error(`Invalid production tag value for ${key}`);
    result[key] = entry;
  }
  if (encoder.encode(JSON.stringify(result)).length > 8192) throw new Error("Production tags exceed 8 KiB");
  return result;
}

export const PRODUCTION_LABELS = {smart: "Smart", fourth_wall: "4th wall", mistake: "Mistake", aggressive: "Aggressive"} as const;
export type ProductionLabel = keyof typeof PRODUCTION_LABELS;
export const THINKING_LABELS: readonly ProductionLabel[] = ["smart", "fourth_wall", "mistake"];
export const SPEECH_LABELS: readonly ProductionLabel[] = ["smart", "mistake", "aggressive"];
export function productionLabelKey(label: ProductionLabel): string {return `label.${label}`;}
export type ProductionKindPolicy = {mode: "all"} | {mode: "none"} | {mode: "any"; labels: readonly ProductionLabel[]};
export type ProductionRecipe = {mode: "recipe"; thinking: boolean; base: "full" | "empty"; policies: Partial<Record<ProductionMomentKind, ProductionKindPolicy>>};

function decodeRecipePolicies(value: unknown): ProductionRecipe["policies"] {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Production recipe policies must be a flat object");
  const result: ProductionRecipe["policies"] = {};
  for (const [kind, input] of Object.entries(value)) {
    if (!PRODUCTION_MOMENT_KINDS.includes(kind as ProductionMomentKind)) throw new Error(`Unsupported production moment kind ${kind}`);
    if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("Invalid production kind policy");
    const policy = input as Record<string, unknown>;
    const fields = policy.mode === "any" ? ["mode", "labels"] : ["mode"];
    if (Object.keys(policy).some(field => !fields.includes(field))) throw new Error("Unsupported production policy fields");
    if (policy.mode === "all" || policy.mode === "none") result[kind as ProductionMomentKind] = {mode: policy.mode};
    else if (policy.mode === "any") {
      if (!Array.isArray(policy.labels) || policy.labels.length > Object.keys(PRODUCTION_LABELS).length || policy.labels.some(label => typeof label !== "string" || !Object.hasOwn(PRODUCTION_LABELS, label)) || new Set(policy.labels).size !== policy.labels.length) throw new Error("Production recipe requires unique known labels");
      result[kind as ProductionMomentKind] = {mode: "any", labels: policy.labels as ProductionLabel[]};
    } else throw new Error("Unsupported production policy mode");
  }
  return result;
}

export type ProductionSelection =
  | { mode: "full"; thinking: boolean }
  | { mode: "tagged"; thinking: boolean; predicate: ProductionTags; includeOpening?: boolean; includeResult?: boolean }
  | { mode: "ids"; thinking: boolean; ids: readonly string[] }
  | ProductionRecipe;

/** Client selection is a strict data contract, never a path or source authority. */
export function decodeProductionSelection(value: unknown): ProductionSelection {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Production selection must be an object");
  const record = value as Record<string, unknown>;
  if (typeof record.thinking !== "boolean") throw new Error("Production selection requires boolean thinking");
  const fields = record.mode === "full" ? ["mode", "thinking"]
    : record.mode === "tagged" ? ["mode", "thinking", "predicate", "includeOpening", "includeResult"]
    : record.mode === "ids" ? ["mode", "thinking", "ids"]
    : record.mode === "recipe" ? ["mode", "thinking", "base", "policies"] : null;
  if (!fields || Object.keys(record).some(key => !fields.includes(key))) throw new Error("Unsupported production selection fields");
  if (record.mode === "full") return { mode: "full", thinking: record.thinking };
  if (record.mode === "recipe") {
    if (record.base !== "full" && record.base !== "empty") throw new Error("Invalid production recipe baseline");
    return {mode: "recipe", thinking: record.thinking, base: record.base, policies: decodeRecipePolicies(record.policies)};
  }
  if (record.mode === "ids") {
    if (!Array.isArray(record.ids) || record.ids.length > 50000 || record.ids.some(id => typeof id !== "string" || id.length < 1 || id.length > 8192) || new Set(record.ids).size !== record.ids.length) throw new Error("Production selection requires unique bounded moment IDs");
    return { mode: "ids", thinking: record.thinking, ids: record.ids as string[] };
  }
  if (record.includeOpening !== undefined && typeof record.includeOpening !== "boolean" || record.includeResult !== undefined && typeof record.includeResult !== "boolean") throw new Error("Invalid production opening/result selection");
  return { mode: "tagged", thinking: record.thinking, predicate: validateProductionTags(record.predicate, true),
    ...(typeof record.includeOpening === "boolean" ? { includeOpening: record.includeOpening } : {}),
    ...(typeof record.includeResult === "boolean" ? { includeResult: record.includeResult } : {}) };
}

/** Resolve immutable IDs without re-evaluating the original tag predicate.
 * Handcrafted private or cross-game keys never acquire authority from syntax. */
export function resolveProductionMomentIds(catalog: ProductionCatalog, ids: readonly string[]): ProductionMoment[] {
  if (!Array.isArray(ids)) throw new Error("Selected production moment IDs must be an array");
  const requested = new Set<string>();
  const available = new Set(catalog.moments.map(m => m.id));
  for (const id of ids) {
    if (!available.has(id)) throw new Error(`Unavailable production moment ${id}`);
    if (requested.has(id)) throw new Error(`Duplicate selected production moment ${id}`);
    requested.add(id);
  }
  return catalog.moments.filter(moment => requested.has(moment.id));
}

export function selectProductionMoments(catalog: ProductionCatalog, selection: ProductionSelection, annotations: Readonly<Record<string, ProductionTags>> = {}): ProductionMoment[] {
  if (typeof selection.thinking !== "boolean") throw new Error("Invalid production thinking selection");
  if (selection.mode === "ids") {
    const moments = resolveProductionMomentIds(catalog, selection.ids);
    if (!selection.thinking && moments.some(moment => moment.kind === "thinking")) throw new Error("Thinking is disabled for this selection");
    return moments;
  }
  if (selection.mode === "full") return catalog.moments.filter(m => m.defaultIncluded && (selection.thinking || m.kind !== "thinking"));
  if (selection.mode === "recipe") {
    if (selection.base !== "full" && selection.base !== "empty") throw new Error("Invalid production recipe baseline");
    const policies = decodeRecipePolicies(selection.policies);
    return catalog.moments.filter(moment => {
      if (moment.kind === "thinking" && !selection.thinking) return false;
      const policy = policies[moment.kind];
      if (!policy) return selection.base === "full" && moment.defaultIncluded;
      if (policy.mode === "all") return true;
      if (policy.mode === "none") return false;
      const tags = annotations[moment.id];
      return policy.labels.some(label => tags !== undefined && Object.hasOwn(tags, productionLabelKey(label)) && tags[productionLabelKey(label)] === "true");
    });
  }
  if (selection.mode !== "tagged") throw new Error("Unsupported production selection");
  const predicate = validateProductionTags(selection.predicate, true);
  if (selection.includeOpening !== undefined && typeof selection.includeOpening !== "boolean" || selection.includeResult !== undefined && typeof selection.includeResult !== "boolean") throw new Error("Invalid production opening/result selection");
  return catalog.moments.filter(moment => {
    if (moment.kind === "thinking" && !selection.thinking) return false;
    if (selection.includeOpening && moment.kind === "opening" || selection.includeResult && moment.kind === "result") return true;
    const tags = annotations[moment.id];
    return tags !== undefined && Object.entries(predicate).every(([key, value]) => Object.hasOwn(tags, key) && tags[key] === value);
  });
}
