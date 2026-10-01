import type { WerewolfView } from "@influence/engine/werewolf/observation";
import { sceneSpeechDurationMs } from "../games/[slug]/components/scene-speech-timing";

/** Presentation language comes from typed accepted entries, never parsed dialogue. */
export function replayMoment(view: WerewolfView) {
  const entry = view.entries.at(-1);
  const name = (id: string | null) => view.players.find(p => p.id === id)?.name ?? "Nobody";
  let title = "Meet the village", text = "", actorId: string | null = null, cue: string | null = null;
  let spoken = false, pack = false;
  const details: string[] = [];
  if (entry) switch (entry.kind) {
    case "phase": title = entry.phase === "introduction" ? "Meet the village" : `${entry.phase === "night" ? "Night" : entry.phase === "vote" ? "Voting" : "Day"} ${entry.day}`; text = entry.phase === "night" ? "The village sleeps." : entry.phase === "vote" ? "The ballots are sealed until everyone has decided." : "The floor is open."; break;
    case "speech": actorId = entry.actorId; text = entry.text ?? "Pass"; spoken = entry.text !== null; cue = entry.cue; pack = entry.audience === "pack"; title = pack ? "Private pack room" : "Introductions"; break;
    case "discussion": actorId = entry.contribution.actorId; text = entry.contribution.unavailable ? "Unable to respond" : entry.contribution.text ?? "Pass"; spoken = entry.contribution.text !== null; cue = entry.contribution.cue; title = `Day ${entry.day} · Thread ${entry.contribution.thread} · ${name(entry.contribution.openerId)} opens`; if (entry.contribution.stage === "opening" && entry.contribution.recipientIds.length) details.push(`Invited: ${entry.contribution.recipientIds.map(name).join(" → ")}`); if (entry.contribution.stage === "answer") details.push("Reply to respondent"); break;
    case "pack_vote": pack = true; title = `Pack ballot ${entry.result.attempt} of 3`; text = entry.result.targetId ? `The pack agrees on ${name(entry.result.targetId)}.` : entry.result.endReason === "attempt_limit" ? "No agreement. No attack tonight." : "No agreement. The pack will try again."; details.push(...entry.result.ballots.map(b => `${name(b.voterId)} → ${name(b.targetId)}`)); break;
    case "night": title = `Dawn · Day ${entry.day}`; actorId = entry.killedId; text = actorId ? `${name(actorId)} died during the night.` : "Everyone survived the night."; if (entry.attackTargetId !== undefined) details.push(`Pack target: ${name(entry.attackTargetId)}`, `Doctor protected: ${name(entry.protectedId ?? null)}`); if (entry.investigation) details.push(`${name(entry.investigation.seerId)} investigated ${name(entry.investigation.targetId)}: ${entry.investigation.isWolf ? "wolf" : "not a wolf"}`); break;
    case "vote": title = `Day ${entry.day} · Vote after thread ${entry.result.thread}`; actorId = entry.result.eliminatedId; text = actorId ? `${name(actorId)} is eliminated.` : entry.result.dayEnded ? "No unique vote leader. Nobody is eliminated." : "No majority. Discussion continues."; details.push(entry.result.voteMode === "plurality" ? "Final ballot: unique most votes wins; ties spare everyone." : `Majority required: ${entry.result.requiredVotes} of ${entry.result.ballots.length} living players.`, ...entry.result.ballots.map(b => `${name(b.voterId)} → ${b.targetId ? name(b.targetId) : b.unavailable ? "Abstain (unavailable)" : "Abstain (hear more)"}`)); break;
    case "result": title = "Game complete"; text = entry.outcome.faction === "village" ? "The village wins" : entry.outcome.faction === "wolves" ? "The wolves win" : "The game ends in a draw"; details.push(...view.players.map(p => `${p.name} · ${p.role ?? "Unknown role"}${entry.outcome.winnerIds.includes(p.id) ? " · Winner" : ""}`)); break;
  }
  const actor = view.players.find(p => p.id === actorId);
  const speaker = actor ? `${actor.name}${view.audience === "omniscient" && actor.role ? ` · ${actor.role}` : ""}` : "The House";
  return { title, text, actor, speaker, spoken, cue, pack, details, duration: spoken ? sceneSpeechDurationMs(text) : actorId && entry?.kind !== "night" && entry?.kind !== "vote" ? 2200 : 4200 };
}
