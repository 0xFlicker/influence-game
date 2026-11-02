import type { FormatEmpowerVoteReceipt, FormatPresentationRosterPlayer } from "./types";
import { VoteLedger } from "./vote-presentation";

export function FormatEmpowerVoteStage({
  compact = false,
  empoweredId,
  counts,
  roster,
  tiedPlayerIds = [],
  resolutionMethod,
  countedVotes,
  receipts,
}: {
  compact?: boolean;
  empoweredId: string | null;
  counts: Readonly<Record<string, number>>;
  roster: readonly FormatPresentationRosterPlayer[];
  tiedPlayerIds?: readonly string[];
  resolutionMethod?: "revote" | "wheel" | "manual";
  countedVotes?: readonly { voterId: string; targetId: string }[];
  receipts: readonly FormatEmpowerVoteReceipt[];
}) {
  const names = new Map(roster.map((player) => [player.id, player.name]));
  const isRevote = resolutionMethod === "revote" || resolutionMethod === "wheel";
  const orderedCounts = roster.filter((player) => player.id in counts);
  const hasRevoters = orderedCounts.some(player => !tiedPlayerIds.includes(player.id));
  const ledgerVotes = countedVotes ?? receipts.flatMap(receipt => {
    const targetId = isRevote ? receipt.revoteTargetId : receipt.targetId;
    return targetId ? [{ voterId: receipt.voterId, targetId }] : [];
  });

  if (compact) {
    const featuredIds = empoweredId ? [empoweredId] : tiedPlayerIds;
    const featured = roster.filter(player => featuredIds.includes(player.id));
    const otherVotes = Object.entries(counts).reduce((total, [id, count]) => total + (featuredIds.includes(id) ? 0 : count), 0);
    return <section data-format-cue={empoweredId ? "empowered_tally" : "empowered_tie"} data-compact-empower aria-label="Empower result" className="mx-auto w-full max-w-xl text-center">
      <p className="text-xs uppercase tracking-widest text-amber-100/60">{empoweredId ? isRevote ? "Runoff result" : "Vote result" : "Runoff"}</p>
      <h2 className="mt-2 text-xl font-semibold sm:text-2xl">{empoweredId ? `${playerName(empoweredId, names)} is Empowered` : "Tied for Empower"}</h2>
      <dl aria-label="Empowered vote totals" className="mt-4 flex flex-wrap justify-center gap-4">
        {featured.map(player => <div key={player.id} data-empower-total={player.id} className="min-w-0 rounded-xl bg-white/5 px-4 py-2">
          <dt className="text-sm">{player.name}</dt><dd className="text-2xl font-semibold text-amber-200">{counts[player.id] ?? 0} <span className="text-xs font-normal">votes</span></dd>
        </div>)}
      </dl>
      {otherVotes > 0 && <p className="mt-3 text-sm text-white/60">Other votes: {otherVotes}</p>}
      {!empoweredId && <p className="mt-3 text-xs text-white/60">{hasRevoters ? "Runoff pending" : "Wheel pending"}</p>}
      {resolutionMethod === "wheel" && <p className="mt-3 text-sm text-amber-200">Decided by the wheel</p>}
      {resolutionMethod === "manual" && <p className="mt-3 text-sm text-white/60">Manual decision · original totals</p>}
    </section>;
  }

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
        {resolutionMethod === "wheel" && <p className="mt-2 text-sm text-amber-200">The vote stayed tied. The wheel decided.</p>}
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
      <div className="mt-6 rounded-xl border border-white/10 bg-black/30 p-3">
        <VoteLedger title={isRevote ? "Empower revote" : "Empower vote"} roster={roster}
          votes={ledgerVotes.map(vote => ({ ...vote, choice: "empower" as const }))}
          total={ledgerVotes.length} />
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
