import type {
  FormatEmpowerVoteReceipt,
  FormatPresentationRosterPlayer,
} from "./types";

export function FormatEmpowerVoteStage({
  empoweredId,
  counts,
  receipts,
  roster,
}: {
  empoweredId: string;
  counts: Readonly<Record<string, number>>;
  receipts: readonly FormatEmpowerVoteReceipt[];
  roster: readonly FormatPresentationRosterPlayer[];
}) {
  const names = new Map(roster.map((player) => [player.id, player.name]));
  const orderedCounts = roster.filter((player) => player.id in counts);

  return (
    <section
      data-format-cue="empowered_tally"
      aria-labelledby="format-empowered-heading"
      className="mx-auto w-full max-w-3xl rounded-xl border border-amber-200/15 bg-amber-200/[0.035] p-4 sm:p-6"
    >
      <div className="text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-amber-100/45">
          Standard vote
        </p>
        <h2
          id="format-empowered-heading"
          className="mt-2 text-2xl font-semibold text-white sm:text-3xl"
        >
          Empowered tally
        </h2>
        <p className="mt-2 text-sm text-white/55">
          {playerName(empoweredId, names)} is Empowered.
        </p>
      </div>

      <dl
        aria-label="Empowered vote totals"
        className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3"
      >
        {orderedCounts.map((player) => {
          const isWinner = player.id === empoweredId;
          return (
            <div
              key={player.id}
              data-empower-total={player.id}
              data-empowered={isWinner ? "true" : "false"}
              className={`min-w-0 rounded-lg border px-3 py-3 ${
                isWinner
                  ? "border-amber-200/40 bg-amber-200/[0.12]"
                  : "border-white/10 bg-white/[0.025]"
              }`}
            >
              <dt className="break-words text-xs font-medium text-white/75">
                {player.name}
              </dt>
              <dd className="mt-1 flex items-baseline gap-1 text-2xl font-semibold text-white">
                {counts[player.id] ?? 0}
                <span className="text-[9px] uppercase tracking-[0.13em] text-white/35">
                  votes
                </span>
              </dd>
            </div>
          );
        })}
      </dl>

      <div className="mt-6 border-t border-white/10 pt-4">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
          Named Empowered votes
        </h3>
        <ol
          aria-label="Voter to Empowered target receipts"
          className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2"
        >
          {receipts.map((receipt) => (
            <li
              key={receipt.voterId}
              data-empower-receipt={receipt.voterId}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-md border border-white/[0.08] bg-black/20 px-3 py-2 text-xs"
            >
              <span className="min-w-0 break-words text-right text-white/65">
                {playerName(receipt.voterId, names)}
              </span>
              <span aria-hidden="true" className="text-amber-200/60">→</span>
              <span className="min-w-0 break-words font-medium text-white/90">
                {playerName(receipt.targetId, names)}
                {receipt.revoteTargetId ? (
                  <span className="mt-0.5 block text-[10px] font-normal text-cyan-100/65">
                    Revote → {playerName(receipt.revoteTargetId, names)}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function playerName(
  playerId: string,
  names: ReadonlyMap<string, string>,
): string {
  return names.get(playerId) ?? playerId;
}
