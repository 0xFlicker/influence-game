import type {WerewolfWatchMoment} from "@influence/engine/werewolf/watch-contract";
import {werewolfOutcomeReason, werewolfOutcomeTitle} from "@influence/engine/werewolf/results-contract";
import {FitPresentation} from "@/app/games/[slug]/components/fit-presentation";
import {RoomBackdrop} from "@/app/games/[slug]/components/stage-backdrop";

/** Final audience-safe snapshot owns roles and elimination coordinates, even on a direct seek. */
export function WerewolfEnding({snapshot, backgroundUrl}: {snapshot: WerewolfWatchMoment["snapshot"]; backgroundUrl: string}) {
  const {outcome,players} = snapshot;
  if (!outcome) return null;
  const exits = players.filter(player => player.elimination).sort((a,b) =>
    a.elimination!.day - b.elimination!.day || Number(a.elimination!.kind === "vote") - Number(b.elimination!.kind === "vote"));
  return <section className="relative flex min-h-0 flex-1 flex-col overflow-hidden" data-werewolf-ending>
    <RoomBackdrop source={backgroundUrl} />
    <div className="absolute inset-0 bg-black/75" />
    <div className="absolute inset-6">
      <FitPresentation enabled>
        <div className="mx-auto max-w-6xl p-4 text-xl text-white">
          <header className="mb-6 text-center"><p className="text-xs uppercase tracking-[.2em] text-amber-100">Final results</p>
            <h2 className="mt-2 text-4xl font-semibold">{werewolfOutcomeTitle(outcome)}</h2>
            <p className="mt-2 text-lg text-white/65">{werewolfOutcomeReason(outcome)}</p>
          </header>
          <div className="grid grid-cols-2 gap-6">
            <section aria-label="Final cast"><h3 className="mb-3 text-2xl text-amber-100">The cast</h3>
              <ul className="space-y-2">{[...players].sort((a,b) => Number(outcome.winnerIds.includes(b.id)) - Number(outcome.winnerIds.includes(a.id))).map(player =>
                <li key={player.id} className="rounded-lg border border-white/15 bg-black/50 px-4 py-2">
                  <p className="break-words font-semibold">{player.name}<span className="ml-2 text-lg font-normal capitalize text-white/65">{player.role}</span></p>
                  <p className="text-base text-amber-100/80">{outcome.winnerIds.includes(player.id) ? "Winner" : outcome.faction === null ? "Draw" : "Defeated"}{player.alive ? " · Survived" : ""}</p>
                </li>)}</ul>
            </section>
            <section aria-label="Recorded eliminations"><h3 className="mb-3 text-2xl text-amber-100">How the game unfolded</h3>
              <ol className="space-y-3">{exits.map(player => <li key={player.id} className="border-l-2 border-amber-100/40 pl-4">
                <p className="text-base text-white/60">{player.elimination!.kind === "night" ? "Night" : "Day"} {player.elimination!.day}</p>
                <p className="break-words">{player.name} · {player.elimination!.kind === "night" ? "Killed at night" : "Voted out"}</p>
              </li>)}</ol>
              <p className="mt-5 text-base text-white/65">Survivors: {players.filter(player => player.alive).map(player => player.name).join(", ") || "None"}</p>
            </section>
          </div>
        </div>
      </FitPresentation>
    </div>
  </section>;
}
