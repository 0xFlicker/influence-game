/**
 * Match narrative compact-v2 encoder (token-efficiency).
 *
 * Collapses members[] into group slots (text / thinking / strategy),
 * inherits group-level metadata, omits null/default fields.
 * Authority is implied by slot name.
 */

import type {
  NarrativeCorrelationSummary,
  NarrativeGroup,
  NarrativeGroupMember,
} from "./match-narrative-grouping.js";
import { NARRATIVE_CONTENT_TRUST } from "./match-narrative-grouping.js";

export const MATCH_NARRATIVE_SCHEMA_VERSION_V2 = 2 as const;

export type CompactV2Corr = "exact" | "inferred" | "uncorrelated";

export interface CompactV2Group {
  decisionId?: string;
  corr: CompactV2Corr;
  actor?: string;
  playerId?: string;
  phase?: string;
  round?: number;
  action?: string;
  text?: string;
  thinking?: string;
  strategy?: string;
  lens?: string;
  scope?: string;
  seq?: number;
  actions?: Array<{ seq: number; type: string }>;
  truncated?: boolean;
  refs?: { thinkingId?: string; strategyId?: string; dialogueRowId?: string };
}

export interface CompactV2Page {
  ok: true;
  schemaVersion: typeof MATCH_NARRATIVE_SCHEMA_VERSION_V2;
  game: {
    id: string;
    slug: string;
    status: string;
    transcriptCaptureVersion?: number;
    cognitiveArtifactCaptureVersion?: number;
  };
  surface: "subject_owner" | "producer";
  access?: Record<string, unknown>;
  preset: string;
  detail: string;
  filters?: Record<string, unknown>;
  readThrough: unknown;
  correlationSummary: NarrativeCorrelationSummary;
  limitations?: Array<{ code: string; message: string }>;
  contentTrust: typeof NARRATIVE_CONTENT_TRUST;
  notBoardAuthority: true;
  groups: CompactV2Group[];
  pageSize: number;
  /** Opaque pagination token; explicit null on terminal pages (MCP contract). */
  nextCursor: string | null;
  nextCursorKind: "page" | null;
}

function corrKind(kind: string): CompactV2Corr {
  if (kind === "decision_id") return "exact";
  if (kind === "inferred") return "inferred";
  return "uncorrelated";
}

function pickDialogue(members: readonly NarrativeGroupMember[]): NarrativeGroupMember | undefined {
  return members.find((m) => m.kind === "dialogue");
}

function pickThinking(members: readonly NarrativeGroupMember[]): NarrativeGroupMember | undefined {
  return members.find((m) => m.kind === "thinking");
}

function pickStrategy(members: readonly NarrativeGroupMember[]): NarrativeGroupMember | undefined {
  return members.find((m) => m.kind === "strategy");
}

function strategyString(member: NarrativeGroupMember, detail: string): string | undefined {
  const fields = member.fields;
  if (typeof fields.decisionLog === "string" && fields.decisionLog.length > 0) {
    return fields.decisionLog;
  }
  if (detail === "full") {
    if (typeof fields.strategicReflectionSummary === "string") {
      return fields.strategicReflectionSummary;
    }
    if (typeof fields.strategyPacketSummary === "string") {
      return fields.strategyPacketSummary;
    }
  }
  return undefined;
}

/**
 * Encode domain narrative groups into compact-v2 group objects.
 */
export function encodeCompactV2Groups(
  groups: readonly NarrativeGroup[],
  detail: string,
  options?: { includeThinking: boolean },
): CompactV2Group[] {
  const includeThinking = options?.includeThinking === true;
  const out: CompactV2Group[] = [];

  for (const g of groups) {
    const dialogue = pickDialogue(g.members);
    const thinking = pickThinking(g.members);
    const strategy = pickStrategy(g.members);

    const encoded: CompactV2Group = {
      corr: corrKind(g.correlation.kind),
    };

    if (g.decisionId) encoded.decisionId = g.decisionId;
    if (g.actor.name) encoded.actor = g.actor.name;
    else if (g.actor.playerId) encoded.playerId = g.actor.playerId;
    if (g.phase) encoded.phase = g.phase;
    if (g.round != null) encoded.round = g.round;
    if (g.action) encoded.action = g.action;

    if (dialogue) {
      const text = dialogue.fields.text;
      if (typeof text === "string" && text.length > 0) encoded.text = text;
      if (typeof dialogue.fields.scope === "string") encoded.scope = dialogue.fields.scope;
      if (typeof dialogue.fields.entrySequence === "number") {
        encoded.seq = dialogue.fields.entrySequence;
      }
      if (dialogue.truncated) encoded.truncated = true;
    }

    if (includeThinking && thinking) {
      const t = thinking.fields.thinking;
      if (typeof t === "string" && t.length > 0) encoded.thinking = t;
    }

    if (strategy) {
      const s = strategyString(strategy, detail);
      if (s) encoded.strategy = s;
      if (typeof strategy.fields.strategicLens === "string") {
        encoded.lens = strategy.fields.strategicLens;
      }
    }

    if (g.relatedActionRefs && g.relatedActionRefs.length > 0) {
      // Compact citations: sequence + canonical event type only.
      // Never emit payloads, targets, or source pointers.
      encoded.actions = g.relatedActionRefs.map((r) => ({
        seq: r.eventSequence,
        type: r.eventType,
      }));
    }

    // Optional drill-down refs when bodies present (for full detail clients).
    if (detail === "full") {
      const refs: CompactV2Group["refs"] = {};
      if (thinking) refs.thinkingId = thinking.id.replace(/^c:/, "");
      if (strategy) refs.strategyId = strategy.id.replace(/^c:/, "");
      if (dialogue && typeof dialogue.fields.entrySequence === "number") {
        refs.dialogueRowId = dialogue.id;
      }
      if (Object.keys(refs).length > 0) encoded.refs = refs;
    }

    out.push(encoded);
  }

  return out;
}

/**
 * Build a compact-v2 page envelope from domain page fields.
 */
export function encodeCompactV2Page(input: {
  game: CompactV2Page["game"];
  surface: CompactV2Page["surface"];
  access?: Record<string, unknown>;
  preset: string;
  detail: string;
  filters?: Record<string, unknown>;
  readThrough: unknown;
  correlationSummary: NarrativeCorrelationSummary;
  limitations?: Array<{ code: string; message: string }>;
  groups: readonly NarrativeGroup[];
  nextCursor: string | null;
  nextCursorKind: "page" | null;
}): CompactV2Page {
  const includeThinking = input.preset === "full_cognition";
  const groups = encodeCompactV2Groups(input.groups, input.detail, { includeThinking });

  const page: CompactV2Page = {
    ok: true,
    schemaVersion: MATCH_NARRATIVE_SCHEMA_VERSION_V2,
    game: {
      id: input.game.id,
      slug: input.game.slug,
      status: input.game.status,
      ...(input.game.transcriptCaptureVersion != null
        ? { transcriptCaptureVersion: input.game.transcriptCaptureVersion }
        : {}),
      ...(input.game.cognitiveArtifactCaptureVersion != null
        ? { cognitiveArtifactCaptureVersion: input.game.cognitiveArtifactCaptureVersion }
        : {}),
    },
    surface: input.surface,
    preset: input.preset,
    detail: input.detail,
    readThrough: input.readThrough,
    correlationSummary: input.correlationSummary,
    contentTrust: NARRATIVE_CONTENT_TRUST,
    notBoardAuthority: true,
    groups,
    pageSize: groups.length,
    // Explicit nulls on terminal pages — required by MCP outputSchema.
    nextCursor: input.nextCursor,
    nextCursorKind: input.nextCursorKind,
  };

  if (input.access) page.access = input.access;
  if (input.filters) page.filters = omitNulls(input.filters);
  if (input.limitations && input.limitations.length > 0) {
    page.limitations = input.limitations;
  }

  return page;
}

function omitNulls(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (v === null || v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/** JSON character length for benchmarks. */
export function jsonCharLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
