import Link from "next/link";
import type { HouseParticipation, ParticipationFilter } from "@influence/engine/house-participation";
import { participationOutcome } from "@/lib/participation";

export function ParticipationRow({ entry }: { entry: HouseParticipation }) {
  return <div className="influence-panel-muted min-w-0 rounded-lg p-4">
    <p className="text-xs influence-copy-muted">{entry.gameKind === "werewolf" ? "Werewolf" : "Influence"} · {new Date(entry.completedAt).toLocaleDateString("en-US", {timeZone:"UTC"})}</p>
    <Link className="influence-link break-words font-semibold" href={`/games/${entry.gameSlug}`}>{entry.gameTitle}</Link>
    <p className="mt-1 break-words text-sm">{entry.agentName} · {participationOutcome(entry)}</p>
    <Link className="influence-link mt-2 inline-block text-xs" href={`/games/${entry.gameSlug}/results`}>Results · Spoilers</Link>
  </div>;
}
export function ParticipationRows({ entries }: { entries: HouseParticipation[] }) {
  return entries.length ? <ol className="mt-4 space-y-3">{entries.map(entry => <li key={`${entry.gameId}:${entry.playerId}`}><ParticipationRow entry={entry}/></li>)}</ol>
    : <p className="influence-copy-muted mt-4 text-sm">No completed games in this history yet.</p>;
}
export const participationFilters: {kind: ParticipationFilter; label: string}[] = [
  {kind:"all",label:"All games"}, {kind:"influence",label:"Influence"}, {kind:"werewolf",label:"Werewolf"},
];
