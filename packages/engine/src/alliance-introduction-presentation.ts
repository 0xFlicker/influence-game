import type { CanonicalGameEvent } from "./canonical-events";
import { visualSpeechDurationMs } from "./visual-speech";

export const ALLIANCE_MEMBERS_PER_PAGE = 4;
export function allianceIntroductionDurationMs(text: string, memberCount: number): number {
  return Math.max(visualSpeechDurationMs(text) + 2000, Math.ceil(memberCount / ALLIANCE_MEMBERS_PER_PAGE) * 3500 + 600);
}
export function allianceMemberPage(elapsedMs: number, durationMs: number, memberCount: number): number {
  const pages = Math.max(1, Math.ceil(memberCount / ALLIANCE_MEMBERS_PER_PAGE));
  return Math.min(pages - 1, Math.max(0, Math.floor((elapsedMs - 300) / Math.max(1, durationMs - 600) * pages)));
}

/** Browser-safe viewer metadata, independent of House providers and context compilation. */
export interface AllianceIntroduction {
  sessionId: string;
  allianceId: string;
  allianceName: string;
  memberIds: string[];
  beforeEntrySequence: number;
}

export interface AllianceSessionPresentation {
  sessionId: string;
  allianceId: string;
  allianceName?: string;
  memberIds: string[];
}

/** Reposition saved editorial copy without changing its durable transcript identity. */
export function orderAllianceIntroductions<T extends { entrySequence?: number | null; allianceIntroduction?: AllianceIntroduction }>(rows: readonly T[]): T[] {
  const before = new Map<number, T[]>();
  const available = new Set(rows.map(row => row.entrySequence));
  for (const row of rows) if (row.allianceIntroduction && available.has(row.allianceIntroduction.beforeEntrySequence)) {
    const anchor = row.allianceIntroduction.beforeEntrySequence;
    before.set(anchor, [...(before.get(anchor) ?? []), row]);
  }
  return rows.flatMap(row => row.allianceIntroduction ? [] : [...(before.get(row.entrySequence ?? -1) ?? []), row]);
}

/** Session-time name for historical recordings, never the alliance's final membership. */
export function allianceSessionPresentation(context: { sessionId?: string; allianceId?: string; allianceName?: string; sessionAudiencePlayerIds?: string[] } | null | undefined,
  events: readonly CanonicalGameEvent[] = [], throughSequence = Infinity): AllianceSessionPresentation | undefined {
  if (!context?.sessionId || !context.allianceId || !context.sessionAudiencePlayerIds) return undefined;
  let allianceName = context.allianceName;
  if (!allianceName) for (const event of events) {
    if (event.sequence > throughSequence) break;
    if ((event.type === "alliance.activated" || event.type === "alliance.amendment_resolved" || event.type === "alliance.closed" || event.type === "alliance.archived")
      && event.payload.alliance.id === context.allianceId) allianceName = event.payload.alliance.name;
  }
  return { sessionId: context.sessionId, allianceId: context.allianceId, allianceName, memberIds: [...context.sessionAudiencePlayerIds] };
}
