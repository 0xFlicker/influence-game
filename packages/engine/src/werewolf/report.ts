import type { WerewolfPublicEntry, WerewolfView } from "./observation";

/** Render accepted audience facts and original player contributions. No inference or prose parsing. */
export function werewolfReportEntry(entry: WerewolfPublicEntry, { players, audience }: Pick<WerewolfView, "players" | "audience">, transcript = false): string | null {
  const name = (id: string) => players.find(player => player.id === id)?.name ?? id;
  const speaker = (id: string) => {
    const player = players.find(player => player.id === id);
    // Completed Mystery views contain roles; only Omniscient labels earlier dialogue.
    return `${player?.name ?? id}${audience === "omniscient" && player?.role ? ` [${player.role}]` : ""}`;
  };
  switch (entry.kind) {
    case "phase": return `\n${entry.phase === "introduction" ? "INTRODUCTIONS" : entry.phase === "night" ? `NIGHT ${entry.day}` : `DAY ${entry.day} · ${entry.phase === "vote" ? "VOTING" : "DISCUSSION"}`}`;
    case "speech": return `${entry.audience === "pack" ? "[Pack] " : ""}${speaker(entry.actorId)}: ${entry.text ?? "[pass]"}${transcript && entry.cue ? ` [production note: ${entry.cue}]` : ""}`;
    case "discussion": {
      const c = entry.contribution;
      const heading = c.stage === "opening" ? `\nDay ${entry.day} · thread ${c.thread} · ${name(c.openerId)} opens${c.recipientIds.length ? ` · invited: ${c.recipientIds.map(name).join(" → ")}` : ""}\n` : "";
      const position = transcript ? ` [${c.stage} · turn ${c.turn}]` : "";
      return `${heading}${speaker(c.actorId)}: ${c.unavailable ? "[unavailable]" : c.text ?? "[pass]"}${position}${transcript && c.cue ? ` [production note: ${c.cue}]` : ""}`;
    }
    case "pack_vote": return `\n[Pack] Night ${entry.day} · ballot ${entry.result.attempt}/3\n  ${entry.result.ballots.map(ballot => `${name(ballot.voterId)} → ${name(ballot.targetId)}`).join("; ")}\n  ${entry.result.targetId !== null ? `Agreed: attack ${name(entry.result.targetId)}.` : entry.result.endReason === "attempt_limit" ? "Three ballots without agreement. No pack attack tonight." : "Disagreement. Swap the opening speaker and propose again."}`;
    case "night": {
      const lines = [`Night ${entry.day}: ${entry.killedId ? `${name(entry.killedId)} died.` : "Everyone survived."}`];
      if (entry.attackTargetId) lines.push(`  Pack targeted ${name(entry.attackTargetId)}.`);
      if (entry.attackTargetId === null) lines.push("  The pack failed to agree; no attack tonight.");
      if (entry.protectedId) lines.push(`  Doctor protected ${name(entry.protectedId)}.`);
      if (entry.investigation) lines.push(`  Seer checked ${name(entry.investigation.targetId)}: ${entry.investigation.isWolf ? "wolf" : "not a wolf"}.`);
      return lines.join("\n");
    }
    case "vote": return `Day ${entry.day} · after thread ${entry.result.thread}: ${entry.result.eliminatedId ? `${name(entry.result.eliminatedId)} voted out. Day ends.` : entry.result.dayEnded ? "No unique leader; day ends without elimination." : "No majority; continue discussion."}\n  ${entry.result.voteMode === "plurality" ? "Final ballot: unique highest vote count wins; ties spare everyone." : `Majority required: ${entry.result.requiredVotes} of ${entry.result.ballots.length} living players.`}\n  Votes: ${Object.entries(entry.result.totals).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).map(([id, count]) => `${name(id)} ${count}`).join(", ") || "none"}\n  Ballots: ${entry.result.ballots.map((ballot) => `${name(ballot.voterId)} → ${ballot.targetId === null ? `Abstain (${ballot.unavailable ? "unavailable" : "hear more"})` : name(ballot.targetId)}`).join("; ")}`;
    case "result": return entry.outcome.faction
      ? `\nResult: ${entry.outcome.faction === "wolves" ? "Wolves" : "Village"} win. ${entry.outcome.reason === "wolves_eliminated" ? "Every wolf has been eliminated." : "The wolves equal or outnumber all other survivors."}\nWinners (including dead teammates): ${entry.outcome.winnerIds.map(name).join(", ")}`
      : "Result: draw at the day limit.";
  }
}
