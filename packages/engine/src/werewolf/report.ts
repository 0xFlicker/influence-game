import type { WerewolfPublicEntry, WerewolfView } from "./observation";

/** Render accepted audience facts directly. No model summary or prose parsing. */
export function werewolfReportEntry(entry: WerewolfPublicEntry, players: WerewolfView["players"], transcript = false): string | null {
  const name = (id: string) => players.find(player => player.id === id)?.name ?? id;
  switch (entry.kind) {
    case "phase": return `\n${entry.phase === "introduction" ? "INTRODUCTIONS" : entry.phase === "night" ? `NIGHT ${entry.day}` : `DAY ${entry.day} · ${entry.phase === "vote" ? "VOTING" : "DISCUSSION"}`}`;
    case "speech": return `${entry.audience === "pack" ? "[Pack] " : ""}${name(entry.actorId)}: ${entry.text}`;
    case "discussion": {
      const lines = [`\nDay ${entry.day} · discussion beat ${entry.result.beat}/6 (shared reveal)`];
      for (const contribution of entry.result.contributions) {
        if (!transcript && contribution.text === null) continue;
        const remaining = entry.result.messagesRemaining[contribution.actorId];
        lines.push(`  ${name(contribution.actorId)}: ${contribution.unavailable ? "[unavailable]" : contribution.text ?? "[pass]"}${transcript ? ` (${remaining}/4 messages left)` : ""}`);
      }
      if (!transcript) {
        const passed = entry.result.contributions.filter((entry) => entry.text === null && !entry.unavailable).map((entry) => name(entry.actorId));
        const unavailable = entry.result.contributions.filter((entry) => entry.unavailable).map((entry) => name(entry.actorId));
        if (passed.length) lines.push(`  Passed: ${passed.join(", ")}.`);
        if (unavailable.length) lines.push(`  Unable to respond: ${unavailable.join(", ")}.`);
      }
      if (entry.result.endReason) lines.push(`  ${entry.result.endReason === "all_passed" ? "Nobody added a message." : entry.result.endReason === "message_limit" ? "Everyone has used their four messages." : "Six discussion beats are complete."} Voting follows.`);
      else if (entry.result.beat === 1 && entry.result.contributions.every((entry) => entry.text === null)) lines.push("  Quiet opening; everyone gets another beat.");
      return lines.join("\n");
    }
    case "night": {
      const lines = [`Night ${entry.day}: ${entry.killedId ? `${name(entry.killedId)} died.` : "Everyone survived."}`];
      if (entry.attackTargetId) lines.push(`  Pack targeted ${name(entry.attackTargetId)}.`);
      if (entry.protectedId) lines.push(`  Doctor protected ${name(entry.protectedId)}.`);
      if (entry.investigation) lines.push(`  Seer checked ${name(entry.investigation.targetId)}: ${entry.investigation.isWolf ? "wolf" : "not a wolf"}.`);
      return lines.join("\n");
    }
    case "vote": return `Day ${entry.day}: ${entry.result.eliminatedId ? `${name(entry.result.eliminatedId)} voted out.` : "Tie; nobody voted out."}\n  Votes: ${Object.entries(entry.result.totals).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).map(([id, count]) => `${name(id)} ${count}`).join(", ")}\n  Ballots: ${entry.result.ballots.map((ballot) => `${name(ballot.voterId)} → ${name(ballot.targetId)}`).join("; ")}`;
    case "result": return entry.outcome.faction
      ? `\nResult: ${entry.outcome.faction === "wolves" ? "Wolves" : "Village"} win. ${entry.outcome.reason === "wolves_eliminated" ? "Every wolf has been eliminated." : "The wolves equal or outnumber all other survivors."}\nWinners (including dead teammates): ${entry.outcome.winnerIds.map(name).join(", ")}`
      : "Result: draw at the day limit.";
  }
}
