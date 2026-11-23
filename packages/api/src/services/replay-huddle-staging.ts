import { huddleSessionId, type CanonicalGameEvent } from "@influence/engine";
import type { TranscriptSafeContext } from "../db/schema.js";

/** Index the accepted schedule, which freezes the cast before anyone can speak. */
export function replayHuddleSchedules(events: readonly CanonicalGameEvent[]) {
  return new Map(events.flatMap(event => {
    if (event.type !== "alliance.huddle_scheduled" || event.payload.schedule.decision !== "scheduled") return [];
    return [[huddleSessionId(event.payload.schedule.id), event] as const];
  }));
}

export function replayHuddleForDialogue(schedules: ReturnType<typeof replayHuddleSchedules>, row: {
  context: TranscriptSafeContext | null;
  kind: string | null;
  baseEvents: number;
  round: number;
  phase: string;
  speaker: string | null;
  audience: string[] | null;
}) {
  const context = row.context;
  if (row.kind !== "huddle_speech" || !context?.sessionId) return null;
  const event = schedules.get(context.sessionId);
  if (!event || event.sequence > row.baseEvents || event.phase !== row.phase) return null;
  const schedule = event.payload.schedule;
  const members = new Set(schedule.memberIds);
  const exactAudience = (ids: readonly string[] | null | undefined) =>
    ids?.length === members.size && new Set(ids).size === members.size && ids.every(id => members.has(id));
  if (schedule.round !== row.round || context.allianceId !== schedule.allianceId
    || (context.scheduleId !== undefined && context.scheduleId !== schedule.id)
    || !row.speaker || !members.has(row.speaker)
    || !exactAudience(context.sessionAudiencePlayerIds) || !exactAudience(row.audience)) return null;
  return { sessionId: context.sessionId, schedule };
}
