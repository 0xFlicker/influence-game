/**
 * Policy-agnostic match narrative grouping (U2).
 *
 * Accepts already-authorized dialogue + cognition members and produces
 * decision/action groups with exact / inferred / uncorrelated correlation.
 * No ownership types, DB, or MCP imports — both producer and owner surfaces
 * feed this module after surface-specific authorization.
 */

import { UNTRUSTED_GAME_AUTHORED } from "./transcript-serialization.js";

export const NARRATIVE_CONTENT_TRUST = UNTRUSTED_GAME_AUTHORED;

export type NarrativePreset = "strategic" | "dialogue_only" | "full_cognition";
export type NarrativeDetail = "compact" | "full";

export type NarrativeCorrelationKind = "decision_id" | "inferred" | "uncorrelated";

export type NarrativeCorrelationBasis =
  | "decision_id"
  | "actor_phase_round_time"
  | "none";

export type NarrativeMemberKind = "dialogue" | "thinking" | "strategy";

export interface NarrativeActorRef {
  playerId: string | null;
  name: string | null;
}

/** Already-authorized dialogue member (product dialogue only). */
export interface NarrativeDialogueMemberInput {
  kind: "dialogue";
  rowId: string | number;
  entrySequence: number | null;
  timestampMs: number;
  actorPlayerId: string | null;
  actorName: string | null;
  phase: string | null;
  round: number | null;
  scope: string;
  dialogueKind: string | null;
  text: string;
  decisionId: string | null;
  eventSequence: number | null;
  visibility?: string;
}

/** Already-authorized cognition member (thinking or strategy). */
export interface NarrativeCognitionMemberInput {
  kind: "thinking" | "strategy";
  artifactId: string;
  createdAtMs: number;
  actorPlayerId: string | null;
  actorName: string | null;
  phase: string | null;
  round: number | null;
  action: string | null;
  decisionId: string | null;
  eventSequence: number | null;
  /** Allowlisted prose already extracted by the cognition read path. */
  prose: Record<string, unknown>;
}

export type NarrativeMemberInput =
  | NarrativeDialogueMemberInput
  | NarrativeCognitionMemberInput;

export interface NarrativeCorrelation {
  kind: NarrativeCorrelationKind;
  basis: NarrativeCorrelationBasis;
}

export interface NarrativeGroupMember {
  kind: NarrativeMemberKind;
  authority: "transcript" | "cognition";
  id: string;
  sortKey: number;
  phase: string | null;
  round: number | null;
  action: string | null;
  decisionId: string | null;
  eventSequence: number | null;
  /** Allowlisted fields for this member; may be truncated in compact mode. */
  fields: Record<string, unknown>;
  truncated?: boolean;
}

export interface NarrativeRelatedActionRef {
  eventSequence: number;
  phase: string | null;
  round: number | null;
  action: string | null;
}

export interface NarrativeGroup {
  groupId: string;
  decisionId: string | null;
  correlation: NarrativeCorrelation;
  actor: NarrativeActorRef;
  phase: string | null;
  round: number | null;
  action: string | null;
  sortKey: number;
  members: NarrativeGroupMember[];
  relatedActionRefs?: NarrativeRelatedActionRef[];
}

export interface NarrativeCorrelationSummary {
  /**
   * @deprecated Prefer exactCrossLane + idStampedSingleton. Kept as
   * exactCrossLane + idStampedSingleton for v1 clients.
   */
  exact: number;
  /** Groups with ≥2 lane kinds among dialogue/thinking/strategy sharing exact/inferred join. */
  exactCrossLane: number;
  /** Single-member groups that still carry decisionId. */
  idStampedSingleton: number;
  inferred: number;
  uncorrelated: number;
  /** Groups with both dialogue and at least one cognition lane (or action-linked). */
  paired: number;
  /** Groups with only one lane kind present. */
  unpaired: number;
  /** Unpaired groups dropped by strategic default selection. */
  unpairedOmitted: number;
}

export interface NarrativeGroupingLimitation {
  code: "inference_window_limited" | "correlation_actor_mismatch" | "oversized_member_truncated";
  message: string;
}

export interface GroupNarrativeMembersInput {
  members: readonly NarrativeMemberInput[];
  preset: NarrativePreset;
  detail: NarrativeDetail;
  /**
   * Soft-join time proximity window in ms (same actor, phase, round).
   * Default 5s — conservative for dense mingle.
   */
  inferenceWindowMs?: number;
  /** Soft max characters for dialogue text in compact mode. */
  compactDialogueMaxChars?: number;
  /**
   * When false (default for strategic), omit unpaired cognition-only groups
   * that are not action-class decisions. full_cognition / dialogue_only ignore
   * this and keep all groups from the preset filter.
   */
  includeUnpaired?: boolean;
}

export interface GroupNarrativeMembersResult {
  groups: NarrativeGroup[];
  correlationSummary: NarrativeCorrelationSummary;
  limitations: NarrativeGroupingLimitation[];
  contentTrust: typeof NARRATIVE_CONTENT_TRUST;
}

/** Agent actions that are board-linked even without dialogue. */
const ACTION_CLASS_ACTIONS = new Set([
  "vote",
  "empower-revote",
  "power",
  "council-vote",
  "council_vote",
  "endgame-vote",
  "jury-vote",
]);

function memberLaneKinds(group: NarrativeGroup): Set<"dialogue" | "thinking" | "strategy"> {
  const kinds = new Set<"dialogue" | "thinking" | "strategy">();
  for (const m of group.members) {
    kinds.add(m.kind);
  }
  return kinds;
}

function isCrossLane(group: NarrativeGroup): boolean {
  const kinds = memberLaneKinds(group);
  const hasDialogue = kinds.has("dialogue");
  const hasCognition = kinds.has("thinking") || kinds.has("strategy");
  return hasDialogue && hasCognition;
}

function isActionClassGroup(group: NarrativeGroup): boolean {
  if (group.action && ACTION_CLASS_ACTIONS.has(group.action)) return true;
  return group.members.some(
    (m) => m.kind !== "dialogue" && m.action != null && ACTION_CLASS_ACTIONS.has(m.action),
  );
}

function isPairedGroup(group: NarrativeGroup): boolean {
  if (isCrossLane(group)) return true;
  // Action-class cognition with relatedActionRefs or action-class action string.
  if (isActionClassGroup(group) && !memberLaneKinds(group).has("dialogue")) {
    return group.members.some((m) => m.kind === "strategy" || m.kind === "thinking");
  }
  return false;
}

export function summarizeNarrativeGroups(
  groups: readonly NarrativeGroup[],
  unpairedOmitted = 0,
): NarrativeCorrelationSummary {
  let exactCrossLane = 0;
  let idStampedSingleton = 0;
  let inferred = 0;
  let uncorrelated = 0;
  let paired = 0;
  let unpaired = 0;

  for (const g of groups) {
    const kinds = memberLaneKinds(g);
    const cross = isCrossLane(g);
    if (g.correlation.kind === "decision_id") {
      if (cross) exactCrossLane += 1;
      else if (kinds.size === 1) idStampedSingleton += 1;
      else exactCrossLane += 1; // e.g. thinking+strategy without dialogue
    } else if (g.correlation.kind === "inferred") {
      inferred += 1;
    } else {
      uncorrelated += 1;
    }
    if (isPairedGroup(g) || cross) paired += 1;
    else unpaired += 1;
  }

  return {
    exact: exactCrossLane + idStampedSingleton,
    exactCrossLane,
    idStampedSingleton,
    inferred,
    uncorrelated,
    paired,
    unpaired,
    unpairedOmitted,
  };
}

/**
 * Strategic default: drop unpaired cognition-only groups unless includeUnpaired
 * or action-class. dialogue_only / full_cognition keep all groups already filtered
 * by member kind.
 */
export function selectNarrativeGroups(
  groups: readonly NarrativeGroup[],
  preset: NarrativePreset,
  includeUnpaired: boolean,
): { groups: NarrativeGroup[]; unpairedOmitted: number } {
  if (preset !== "strategic" || includeUnpaired) {
    return { groups: [...groups], unpairedOmitted: 0 };
  }

  const kept: NarrativeGroup[] = [];
  let omitted = 0;
  for (const g of groups) {
    if (isCrossLane(g) || isPairedGroup(g) || memberLaneKinds(g).has("dialogue")) {
      kept.push(g);
    } else {
      omitted += 1;
    }
  }
  // Re-number group ids after selection.
  kept.forEach((g, i) => {
    g.groupId = `g${i + 1}`;
  });
  return { groups: kept, unpairedOmitted: omitted };
}

const DEFAULT_INFERENCE_WINDOW_MS = 5_000;
const DEFAULT_COMPACT_DIALOGUE_MAX = 400;

function memberSortKey(member: NarrativeMemberInput): number {
  if (member.kind === "dialogue") {
    if (member.entrySequence != null && member.entrySequence > 0) {
      // Prefer sequence order when present; mix with timestamp scale carefully.
      return member.entrySequence;
    }
    return member.timestampMs;
  }
  return member.createdAtMs;
}

function memberId(member: NarrativeMemberInput): string {
  if (member.kind === "dialogue") return `d:${String(member.rowId)}`;
  return `c:${member.artifactId}`;
}

function filterByPreset(
  members: readonly NarrativeMemberInput[],
  preset: NarrativePreset,
): NarrativeMemberInput[] {
  if (preset === "dialogue_only") {
    return members.filter((m) => m.kind === "dialogue");
  }
  if (preset === "strategic") {
    return members.filter((m) => m.kind === "dialogue" || m.kind === "strategy");
  }
  return [...members];
}

function applyDetail(
  member: NarrativeMemberInput,
  detail: NarrativeDetail,
  compactDialogueMaxChars: number,
): { fields: Record<string, unknown>; truncated: boolean } {
  if (member.kind === "dialogue") {
    const text = member.text;
    if (detail === "compact" && text.length > compactDialogueMaxChars) {
      return {
        fields: {
          text: `${text.slice(0, compactDialogueMaxChars)}…`,
          scope: member.scope,
          dialogueKind: member.dialogueKind,
          visibility: member.visibility ?? null,
          timestampMs: member.timestampMs,
          entrySequence: member.entrySequence,
        },
        truncated: true,
      };
    }
    return {
      fields: {
        text,
        scope: member.scope,
        dialogueKind: member.dialogueKind,
        visibility: member.visibility ?? null,
        timestampMs: member.timestampMs,
        entrySequence: member.entrySequence,
      },
      truncated: false,
    };
  }

  // Cognition: prose is already allowlisted by the cognition read path.
  if (detail === "compact" && member.kind === "strategy") {
    const prose = member.prose;
    const compact: Record<string, unknown> = {};
    for (const key of [
      "decisionLog",
      "strategicLens",
      "strategicLensRationale",
      "strategyPacketSummary",
      "strategicReflectionSummary",
    ] as const) {
      if (prose[key] !== undefined) compact[key] = prose[key];
    }
    return { fields: compact, truncated: Object.keys(prose).length > Object.keys(compact).length };
  }

  return { fields: { ...member.prose }, truncated: false };
}

function toGroupMember(
  member: NarrativeMemberInput,
  detail: NarrativeDetail,
  compactDialogueMaxChars: number,
): NarrativeGroupMember {
  const { fields, truncated } = applyDetail(member, detail, compactDialogueMaxChars);
  return {
    kind: member.kind,
    authority: member.kind === "dialogue" ? "transcript" : "cognition",
    id: memberId(member),
    sortKey: memberSortKey(member),
    phase: member.phase,
    round: member.round,
    action: member.kind === "dialogue" ? null : member.action,
    decisionId: member.decisionId,
    eventSequence: member.eventSequence,
    fields,
    ...(truncated ? { truncated: true } : {}),
  };
}

function actorFromMembers(members: readonly NarrativeMemberInput[]): NarrativeActorRef {
  const first = members[0];
  if (!first) return { playerId: null, name: null };
  return {
    playerId: first.actorPlayerId,
    name: first.actorName,
  };
}

function relatedActionRefs(
  members: readonly NarrativeMemberInput[],
): NarrativeRelatedActionRef[] | undefined {
  const refs: NarrativeRelatedActionRef[] = [];
  const seen = new Set<number>();
  for (const m of members) {
    if (m.kind === "dialogue") continue;
    if (m.eventSequence == null || m.eventSequence <= 0) continue;
    if (seen.has(m.eventSequence)) continue;
    seen.add(m.eventSequence);
    refs.push({
      eventSequence: m.eventSequence,
      phase: m.phase,
      round: m.round,
      action: m.action,
    });
  }
  return refs.length > 0 ? refs : undefined;
}

function groupMeta(members: readonly NarrativeMemberInput[]): {
  phase: string | null;
  round: number | null;
  action: string | null;
  sortKey: number;
  decisionId: string | null;
} {
  let sortKey = Number.POSITIVE_INFINITY;
  let phase: string | null = null;
  let round: number | null = null;
  let action: string | null = null;
  let decisionId: string | null = null;
  for (const m of members) {
    const sk = memberSortKey(m);
    if (sk < sortKey) sortKey = sk;
    if (phase == null && m.phase) phase = m.phase;
    if (round == null && m.round != null) round = m.round;
    if (action == null && m.kind !== "dialogue" && m.action) action = m.action;
    if (decisionId == null && m.decisionId) decisionId = m.decisionId;
  }
  return {
    phase,
    round,
    action,
    sortKey: Number.isFinite(sortKey) ? sortKey : 0,
    decisionId,
  };
}

/**
 * Group authorized narrative members into decision/action records.
 */
export function groupNarrativeMembers(
  input: GroupNarrativeMembersInput,
): GroupNarrativeMembersResult {
  const inferenceWindowMs = input.inferenceWindowMs ?? DEFAULT_INFERENCE_WINDOW_MS;
  const compactDialogueMaxChars =
    input.compactDialogueMaxChars ?? DEFAULT_COMPACT_DIALOGUE_MAX;
  const limitations: NarrativeGroupingLimitation[] = [];

  const filtered = filterByPreset(input.members, input.preset);
  const used = new Set<string>();
  const groups: NarrativeGroup[] = [];
  let groupCounter = 0;

  const nextGroupId = (): string => {
    groupCounter += 1;
    return `g${groupCounter}`;
  };

  const pushGroup = (
    members: NarrativeMemberInput[],
    correlation: NarrativeCorrelation,
  ): void => {
    if (members.length === 0) return;
    // Exact groups require unanimous actorPlayerId when any id is present.
    const actorIds = new Set(
      members.map((m) => m.actorPlayerId).filter((id): id is string => Boolean(id)),
    );
    if (correlation.kind === "decision_id" && actorIds.size > 1) {
      limitations.push({
        code: "correlation_actor_mismatch",
        message: "Exact decisionId members spanned multiple seats; split into uncorrelated groups.",
      });
      for (const m of members) {
        pushGroup([m], { kind: "uncorrelated", basis: "none" });
      }
      return;
    }

    for (const m of members) used.add(memberId(m));
    const meta = groupMeta(members);
    const actor = actorFromMembers(members);
    const groupMembers = members
      .map((m) => toGroupMember(m, input.detail, compactDialogueMaxChars))
      .sort((a, b) => a.sortKey - b.sortKey || a.id.localeCompare(b.id));

    if (groupMembers.some((m) => m.truncated)) {
      limitations.push({
        code: "oversized_member_truncated",
        message: "One or more members were truncated under compact detail.",
      });
    }

    const refs = relatedActionRefs(members);
    groups.push({
      groupId: nextGroupId(),
      decisionId: correlation.kind === "decision_id" ? meta.decisionId : null,
      correlation,
      actor,
      phase: meta.phase,
      round: meta.round,
      action: meta.action,
      sortKey: meta.sortKey,
      members: groupMembers,
      ...(refs ? { relatedActionRefs: refs } : {}),
    });
  };

  // --- Exact path: shared decisionId + same actor seat when known ---
  const byDecisionId = new Map<string, NarrativeMemberInput[]>();
  for (const m of filtered) {
    if (!m.decisionId) continue;
    const list = byDecisionId.get(m.decisionId) ?? [];
    list.push(m);
    byDecisionId.set(m.decisionId, list);
  }
  for (const [, bucket] of byDecisionId) {
    if (bucket.length === 0) continue;
    // Only form exact groups when 2+ members share the id, OR a single member
    // still gets a decisionId label so sparse exact cognition-only groups work.
    pushGroup(bucket, { kind: "decision_id", basis: "decision_id" });
  }

  // Remaining members without exact grouping.
  const remaining = filtered.filter((m) => !used.has(memberId(m)));

  // --- Inferred path: unique soft match on seat + phase + round + time ---
  const remainingIds = new Set(remaining.map(memberId));
  const dialogueLeft = remaining.filter((m) => m.kind === "dialogue");
  const cognitionLeft = remaining.filter((m) => m.kind !== "dialogue");

  for (const dialogue of dialogueLeft) {
    if (!remainingIds.has(memberId(dialogue))) continue;
    if (!dialogue.actorPlayerId || dialogue.phase == null || dialogue.round == null) {
      continue;
    }

    const candidates = cognitionLeft.filter((c) => {
      if (!remainingIds.has(memberId(c))) return false;
      if (c.actorPlayerId !== dialogue.actorPlayerId) return false;
      if (c.phase !== dialogue.phase) return false;
      if (c.round !== dialogue.round) return false;
      const dt = Math.abs(c.createdAtMs - dialogue.timestampMs);
      return dt <= inferenceWindowMs;
    });

    if (candidates.length === 1) {
      const only = candidates[0]!;
      pushGroup([dialogue, only], {
        kind: "inferred",
        basis: "actor_phase_round_time",
      });
      remainingIds.delete(memberId(dialogue));
      remainingIds.delete(memberId(only));
    } else if (candidates.length > 1) {
      // Multi-match → uncorrelated; leave for uncorrelated pass.
    }
  }

  // --- Uncorrelated neighborhood: each leftover member is its own group ---
  for (const m of remaining) {
    if (!remainingIds.has(memberId(m))) continue;
    pushGroup([m], { kind: "uncorrelated", basis: "none" });
    remainingIds.delete(memberId(m));
  }

  groups.sort((a, b) => a.sortKey - b.sortKey || a.groupId.localeCompare(b.groupId));

  // Re-number group ids in sorted order for stable page-local ids.
  groups.forEach((g, i) => {
    g.groupId = `g${i + 1}`;
  });

  const includeUnpaired = input.includeUnpaired === true;
  const selected = selectNarrativeGroups(groups, input.preset, includeUnpaired);
  const correlationSummary = summarizeNarrativeGroups(
    selected.groups,
    selected.unpairedOmitted,
  );

  // Dedupe limitation codes (page-local).
  const seenCodes = new Set<string>();
  const uniqueLimitations = limitations.filter((l) => {
    if (seenCodes.has(l.code)) return false;
    seenCodes.add(l.code);
    return true;
  });

  return {
    groups: selected.groups,
    correlationSummary,
    limitations: uniqueLimitations,
    contentTrust: NARRATIVE_CONTENT_TRUST,
  };
}
