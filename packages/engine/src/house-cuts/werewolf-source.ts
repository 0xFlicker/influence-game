import type { WerewolfEvent } from "../werewolf/types";
import { walkWerewolfHistory } from "../werewolf/watch";
import { werewolfMomentHref, type ReplayAudience } from "../game-links";
import { cutSource, type CutEvidence } from "./source";

/** Reducer-validated, audience-local evidence. Never serialize private frame state. */
export function werewolfCutSource(events: readonly WerewolfEvent[], slug: string, audience: ReplayAudience) {
  if (audience !== "mystery" && audience !== "omniscient") throw new Error("Invalid Cut audience");
  const evidence: CutEvidence[] = [];
  const resolvedNights = new Set<number>();
  let last;
  for (const frame of walkWerewolfHistory(events, audience)) {
    last = frame;
    const { entry, cursor } = frame;
    if (!entry || entry.kind === "phase") continue;
    // Mystery discovery excludes the terminal result, which would color earlier copy.
    if (audience === "mystery" && entry.kind === "result") continue;
    // Keep the pack's choices, resolved outcome and first morning exchange together.
    // Membership is canonical; no speech text is interpreted as a phase or action.
    if (entry.kind === "night") resolvedNights.add(entry.day);
    const nightPacket = entry.kind === "night" || entry.kind === "pack_vote"
      || (entry.kind === "speech" && entry.audience === "pack")
      || (entry.kind === "discussion" && entry.contribution.thread === 1 && resolvedNights.has(entry.day));
    const group = nightPacket ? `night:${entry.day}` : entry.kind === "discussion" ? `day:${entry.day}:thread:${entry.contribution.thread}`
      : entry.kind === "vote" ? `day:${entry.day}:vote:${entry.result.thread}`
      : entry.kind === "speech" ? `${entry.day}:${entry.audience}` : `${entry.day}:${entry.kind}`;
    const base = { id: `w:${cursor}`, group, label: entry.day === 0 ? "Introductions" : `Day ${entry.day}`, position: cursor,
      replayHref: werewolfMomentHref(slug, audience, cursor) };
    if (entry.kind === "speech" || entry.kind === "discussion") {
      const actorId = entry.kind === "speech" ? entry.actorId : entry.contribution.actorId;
      const text = entry.kind === "speech" ? entry.text : entry.contribution.text;
      if (text?.trim()) evidence.push({ ...base, participantIds: [actorId], content: { kind: "dialogue", speakerId: actorId, text } });
    } else {
      // Public entries are allowlisted by the existing spectator projector.
      const participantIds = entry.kind === "vote" || entry.kind === "pack_vote"
        ? [...new Set(entry.result.ballots.flatMap(b => b.targetId ? [b.voterId, b.targetId] : [b.voterId]))]
        : entry.kind === "night" ? [entry.killedId, entry.attackTargetId, entry.protectedId, entry.investigation?.seerId, entry.investigation?.targetId].filter((id): id is string => Boolean(id))
        : entry.outcome.winnerIds;
      // A save requires an actual attack matching protection, not merely no death.
      // Only Omniscient exposes these resolved fields and the protecting actor.
      const doctorId = audience === "omniscient" && entry.kind === "night"
        && entry.attackTargetId && entry.attackTargetId === entry.protectedId && entry.killedId === null
        ? frame.state.players.find(p => frame.state.roles[p.id] === "doctor")?.id : undefined;
      const doctorSave = doctorId && entry.kind === "night" ? { doctorId, targetId: entry.protectedId! } : undefined;
      if (doctorId) participantIds.push(doctorId);
      evidence.push({ ...base, participantIds: [...new Set(participantIds)],
        content: { kind: "fact", value: doctorSave ? { ...entry, doctorSave } : entry } });
    }
  }
  if (!last?.state.outcome) throw new Error("House Cuts require a complete Werewolf game");
  return cutSource({ game: { id: last.state.gameId, slug, kind: "werewolf" }, audience,
    cast: last.state.players.map(p => ({ id: p.id, name: p.name })), evidence,
    limitations: ["No thinking, raw reasoning or editable profile data included.",
      ...(audience === "mystery" ? ["No terminal result or roles. Each discovery window must be judged only through its own last entry."] : [])] });
}
