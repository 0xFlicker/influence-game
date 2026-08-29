import type {
  FormatPresentationCue,
  FormatPresentationRosterPlayer,
} from "./types";

export function FormatBallotReveal({
  cue,
  roster,
}: {
  cue: Extract<FormatPresentationCue, { kind: "format_roll_call" }>;
  roster: readonly FormatPresentationRosterPlayer[];
}) {
  return (
    <section
      data-format-cue="format_roll_call"
      data-roll-call-pacing={cue.pacing}
      className="mx-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-white/[0.035] p-6 text-center"
      aria-live="polite"
    >
      <p className="text-[10px] uppercase tracking-[0.26em] text-white/35">
        Roll call · {cue.rollCallIndex + 1} of {cue.rollCallCount}
      </p>
      <div
        data-ballot-receipt={cue.ballot.voterId}
        className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3"
      >
        <BallotName
          label="Voter"
          name={playerName(cue.ballot.voterId, roster)}
        />
        <span className="text-xl text-white/35" aria-hidden="true">→</span>
        <BallotName
          label="Target"
          name={cue.ballot.targetId === null ? "FORFEIT" : playerName(cue.ballot.targetId, roster)}
        />
      </div>
      {cue.ballot.targetId === null ? (
        <div className="format-ballot-reveal__polarity" data-ballot-polarity="forfeit">
          no legal target
        </div>
      ) : cue.ballot.polarity ? (
        <p
          data-ballot-polarity={cue.ballot.polarity}
          className={`mt-4 text-sm font-semibold uppercase tracking-[0.18em] ${
            cue.ballot.polarity === "save"
              ? "text-emerald-300"
              : "text-rose-300"
          }`}
        >
          {displayBallotPolarity(cue.ballot.polarity)}
        </p>
      ) : null}
      <div className="mt-5 overflow-x-auto">
        <table
          data-roll-call-ledger
          className="w-full min-w-[28rem] border-separate border-spacing-y-1 text-left text-xs"
        >
          <caption className="sr-only">Revealed format ballot ledger</caption>
          <thead>
            <tr>
              <th className="px-3 py-2 font-medium uppercase tracking-[0.16em] text-white/35">
                Voter
              </th>
              <th className="px-3 py-2 font-medium uppercase tracking-[0.16em] text-white/35">
                Ballot
              </th>
              <th className="px-3 py-2 font-medium uppercase tracking-[0.16em] text-white/35">
                Target
              </th>
            </tr>
          </thead>
          <tbody>
            {cue.after.revealedBallots.map((ballot) => {
              const current = ballot.voterId === cue.ballot.voterId;
              return (
                <tr
                  key={ballot.voterId}
                  data-ledger-voter={ballot.voterId}
                  data-ledger-current={current ? "true" : "false"}
                  className={
                    current
                      ? "bg-fuchsia-300/[0.09] text-white"
                      : "bg-black/20 text-white/60"
                  }
                >
                  <th scope="row" className="px-3 py-3 font-medium">
                    {playerName(ballot.voterId, roster)}
                  </th>
                  <td className="px-3 py-3 uppercase tracking-[0.14em]">
                    {ballot.targetId === null
                      ? "forfeit"
                      : ballot.polarity
                        ? displayBallotPolarity(ballot.polarity)
                        : "vote"}
                  </td>
                  <td className="px-3 py-3">
                    {ballot.targetId === null ? "FORFEIT" : playerName(ballot.targetId, roster)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function displayBallotPolarity(polarity: "save" | "eliminate"): "save" | "exit" {
  return polarity === "eliminate" ? "exit" : polarity;
}

function BallotName({ label, name }: { label: string; name: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/20 px-3 py-4">
      <p className="text-[10px] uppercase tracking-[0.2em] text-white/35">
        {label}
      </p>
      <p className="mt-2 break-words text-sm font-semibold text-white">{name}</p>
    </div>
  );
}

function playerName(
  playerId: string,
  roster: readonly FormatPresentationRosterPlayer[],
): string {
  return roster.find((player) => player.id === playerId)?.name ?? playerId;
}
