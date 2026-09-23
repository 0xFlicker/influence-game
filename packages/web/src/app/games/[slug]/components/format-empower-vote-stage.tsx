import type { FormatPresentationRosterPlayer } from "./types";

export function FormatEmpowerVoteStage({
  empoweredId,
  counts,
  roster,
  tiedPlayerIds = [],
  resolutionMethod,
}: {
  empoweredId: string | null;
  counts: Readonly<Record<string, number>>;
  roster: readonly FormatPresentationRosterPlayer[];
  tiedPlayerIds?: readonly string[];
  resolutionMethod?: "revote" | "wheel" | "manual";
}) {
  const names = new Map(roster.map((player) => [player.id, player.name]));
  const isRevote = resolutionMethod === "revote" || resolutionMethod === "wheel";
  const orderedCounts = roster.filter((player) => player.id in counts);
  const hasRevoters = orderedCounts.some(player => !tiedPlayerIds.includes(player.id));

  return (
    <section
      data-format-cue={empoweredId ? "empowered_tally" : "empowered_tie"}
      aria-labelledby="format-empowered-heading"
      className="mx-auto w-full max-w-2xl px-4 py-3"
    >
      <div className="text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-100/45">
          {isRevote ? "Empower revote" : "Standard vote"}
        </p>
        <h2
          id="format-empowered-heading"
          className="mt-2 text-2xl font-semibold text-white sm:text-3xl"
        >
          {empoweredId ? "Empowered tally" : "A tie for Empower"}
        </h2>
        <p className="mt-2 text-sm text-white/55">
          {empoweredId
            ? `${playerName(empoweredId, names)} is Empowered.`
            : `${tiedPlayerIds.map(id => playerName(id, names)).join(" · ")} are tied. ${hasRevoters ? "The other players revote between them." : "A tiebreak will decide who is Empowered."}`}
        </p>
        {resolutionMethod === "wheel" && <p className="mt-2 text-sm text-amber-200">The revote stayed tied. The wheel decided.</p>}
        {resolutionMethod === "manual" && <p className="mt-2 text-sm text-amber-200">Manual decision · Original vote totals shown.</p>}
      </div>

      <dl
        aria-label="Empowered vote totals"
        className="mt-5 flex flex-wrap justify-center gap-x-8 gap-y-4"
      >
        {orderedCounts.map((player) => {
          const isWinner = player.id === empoweredId;
          return (
            <div
              key={player.id}
              data-empower-total={player.id}
              data-empowered={isWinner ? "true" : "false"}
              className={`min-w-0 text-center ${isWinner || tiedPlayerIds.includes(player.id) ? "text-amber-200" : "text-white/70"}`}
            >
              <dt className="break-words text-xs font-medium text-white/75">
                {player.name}
              </dt>
              <dd className="mt-1 flex items-baseline justify-center gap-1 text-2xl font-semibold">
                {counts[player.id] ?? 0}
                <span className="text-[9px] uppercase tracking-[0.13em] text-white/35">
                  votes
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function playerName(
  playerId: string,
  names: ReadonlyMap<string, string>,
): string {
  return names.get(playerId) ?? playerId;
}
