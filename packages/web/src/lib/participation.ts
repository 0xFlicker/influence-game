import type { HouseParticipation } from "@influence/engine/house-participation";
export function participationOutcome(entry: HouseParticipation): string {
  if (!entry.result) return "Result unavailable";
  if (entry.gameKind === "werewolf") {
    const r = entry.result;
    const faction = r.faction === "wolves" ? "Wolves" : "Village";
    const outcome = r.outcome === "draw" ? "Draw" : `${faction} ${r.outcome === "win" ? "victory" : "defeated"}`;
    return `${outcome} · ${r.alive ? "Survived" : r.eliminationDay !== null ? `Eliminated day ${r.eliminationDay}` : "Eliminated"}`;
  }
  const r = entry.result;
  const outcome = r.placement !== null ? `#${r.placement} of ${entry.totalPlayers}` : r.outcome === "win" ? "Winner" : r.outcome === "loss" ? "Defeated" : "Result unavailable";
  return `${outcome}${r.totalPoints !== null ? ` · ${r.totalPoints} pts` : ""}`;
}
