import type {
  FormatPresentationCue,
  FormatPresentationRosterPlayer,
  FormatResolutionPresentation,
} from "./types";
import { getFormatRegistration } from "@influence/engine/format-rules";

export function FormatResolutionStage({
  cue,
  roster,
}: {
  cue: Extract<FormatPresentationCue, { kind: "format_aggregate" }>;
  roster: readonly FormatPresentationRosterPlayer[];
}) {
  const resolution = cue.resolution;
  const aggregate = resolution.aggregate;
  return (
    <section
      data-format-cue="format_aggregate"
      data-ballot-presentation={cue.ballotPresentationStatus}
      className="mx-auto w-full max-w-4xl rounded-2xl border border-white/10 bg-white/[0.035] p-4 sm:p-6"
      aria-live="polite"
    >
      <header className="text-center">
        <p className="text-[10px] uppercase tracking-[0.26em] text-white/35">
          Tally
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">
          Aggregate locked
        </h2>
      </header>

      {aggregate.capability === "sealed_polarity" ? (
        <SaveOrEliminateAggregate resolution={resolution} roster={roster} />
      ) : null}
      {aggregate.capability === "sealed_elim" ? (
        <SealedEliminationAggregate resolution={resolution} roster={roster} />
      ) : null}
      {aggregate.capability === "public_chain" ? (
        <SafetyBounceAggregate
          resolution={resolution}
          roster={roster}
          ballotPresentationStatus={cue.ballotPresentationStatus}
        />
      ) : null}
    </section>
  );
}

function SaveOrEliminateAggregate({
  resolution,
  roster,
}: AggregateProps) {
  const facts = resolution.aggregate;
  if (facts.capability !== "sealed_polarity") return null;
  const lowestNet = Math.min(...Object.values(facts.nets));
  const ids = orderedIds(facts.nets, roster);
  return (
    <AggregateTable
      caption="Save-or-Eliminate aggregate"
      columns={["Agent", "Saves", "Eliminates", "Net", "Status"]}
      rows={ids.map((playerId) => [
        playerName(playerId, roster),
        String(facts.savesReceived[playerId] ?? 0),
        String(facts.eliminateReceived[playerId] ?? 0),
        signed(facts.nets[playerId] ?? 0),
        facts.nets[playerId] === lowestNet ? "Elimination eligible" : "Above the line",
      ])}
      rowIds={ids}
      rowState={(playerId) =>
        facts.nets[playerId] === lowestNet ? "eligible" : "safe"
      }
    />
  );
}

function SealedEliminationAggregate({ resolution, roster }: AggregateProps) {
  const facts = resolution.aggregate;
  if (facts.capability !== "sealed_elim") return null;
  const registration = getFormatRegistration(resolution.formatId);
  if (registration.capability !== "sealed_elim") return null;
  const eligible = new Set(facts.eligiblePlayerIds);
  const eligibleTotals = facts.eligiblePlayerIds.map((id) => facts.totals[id] ?? 0);
  const dangerTotal = registration.presentation.scoring === "highest_total"
    ? Math.max(...eligibleTotals)
    : Math.min(...eligibleTotals);
  const ids = orderedIds(facts.totals, roster);
  const isDanger = (playerId: string) => (
    eligible.has(playerId) && facts.totals[playerId] === dangerTotal
  );
  const status = (playerId: string) => {
    if (!eligible.has(playerId)) return "Zero votes · safe";
    if (isDanger(playerId)) {
      return registration.presentation.scoring === "highest_total"
        ? "Highest total · elimination eligible"
        : "Fewest positive · eligible";
    }
    return registration.presentation.scoring === "highest_total"
      ? "Below the high vote"
      : "Above the line";
  };
  return (
    <AggregateTable
      caption={`${registration.decision.publicName} aggregate`}
      columns={["Agent", "Votes", "Status"]}
      rows={ids.map((playerId) => [
        playerName(playerId, roster),
        String(facts.totals[playerId] ?? 0),
        status(playerId),
      ])}
      rowIds={ids}
      rowState={(playerId) =>
        !eligible.has(playerId)
          ? "safe"
          : isDanger(playerId)
            ? "eligible"
            : "neutral"
      }
    />
  );
}

function SafetyBounceAggregate({
  resolution,
  roster,
  ballotPresentationStatus,
}: AggregateProps & {
  ballotPresentationStatus: "revealed" | "not_applicable";
}) {
  const facts = resolution.aggregate;
  if (facts.capability !== "public_chain") return null;
  const highest = Math.max(
    ...facts.vulnerablePlayerIds.map((id) => facts.voteTotals[id] ?? 0),
    0,
  );
  const ids = facts.vulnerablePlayerIds;
  return (
    <div className="mt-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Pool
          label="Safe"
          lane="safe"
          playerIds={facts.safePlayerIds}
          roster={roster}
        />
        <Pool
          label="Vulnerable"
          lane="vulnerable"
          playerIds={facts.vulnerablePlayerIds}
          roster={roster}
        />
      </div>
      {ballotPresentationStatus === "not_applicable" ? (
        <p
          data-final-ballot="not_applicable"
          className="mt-5 rounded-xl border border-amber-200/20 bg-amber-200/[0.04] px-4 py-3 text-center text-sm text-amber-100/80"
        >
          Final ballot not applicable · the sole Vulnerable agent is automatically eliminated.
        </p>
      ) : (
        <AggregateTable
          caption="Safety Bounce final vote aggregate"
          columns={["Vulnerable agent", "Final votes", "Status"]}
          rows={ids.map((playerId) => [
            playerName(playerId, roster),
            String(facts.voteTotals[playerId] ?? 0),
            facts.voteTotals[playerId] === highest
              ? "Elimination eligible"
              : "Below the high vote",
          ])}
          rowIds={ids}
          rowState={(playerId) =>
            facts.voteTotals[playerId] === highest ? "eligible" : "neutral"
          }
        />
      )}
    </div>
  );
}

function Pool({
  label,
  lane,
  playerIds,
  roster,
}: {
  label: string;
  lane: "safe" | "vulnerable";
  playerIds: readonly string[];
  roster: readonly FormatPresentationRosterPlayer[];
}) {
  return (
    <div
      data-resolution-pool={lane}
      className={`rounded-xl border p-4 ${
        lane === "safe"
          ? "border-emerald-300/20 bg-emerald-300/[0.045]"
          : "border-rose-300/20 bg-rose-300/[0.045]"
      }`}
    >
      <p className="text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45">
        {label}
      </p>
      <ul className="mt-3 flex flex-wrap justify-center gap-2">
        {playerIds.map((playerId) => (
          <li
            key={playerId}
            className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-white/75"
          >
            {playerName(playerId, roster)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AggregateTable({
  caption,
  columns,
  rows,
  rowIds,
  rowState,
}: {
  caption: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
  rowIds: readonly string[];
  rowState(playerId: string): "eligible" | "safe" | "neutral";
}) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[34rem] border-separate border-spacing-y-1 text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-3 py-2 font-medium uppercase tracking-[0.16em] text-white/35"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((cells, rowIndex) => {
            const playerId = rowIds[rowIndex]!;
            const state = rowState(playerId);
            return (
              <tr
                key={playerId}
                data-aggregate-player={playerId}
                data-aggregate-state={state}
                className="bg-black/20 text-white/75"
              >
                {cells.map((cell, cellIndex) => {
                  const isStatus = cellIndex === cells.length - 1;
                  const className = `px-3 py-3 ${
                    isStatus ? AGGREGATE_STATUS_CLASS[state] : ""
                  }`;
                  return cellIndex === 0 ? (
                    <th
                      key={`${cellIndex}-${cell}`}
                      scope="row"
                      className={`${className} font-medium`}
                    >
                      {cell}
                    </th>
                  ) : (
                    <td key={`${cellIndex}-${cell}`} className={className}>
                      {cell}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const AGGREGATE_STATUS_CLASS: Record<
  "eligible" | "safe" | "neutral",
  string
> = {
  eligible: "text-rose-200",
  safe: "text-emerald-200",
  neutral: "text-white/45",
};

interface AggregateProps {
  resolution: FormatResolutionPresentation;
  roster: readonly FormatPresentationRosterPlayer[];
}

function orderedIds(
  record: Readonly<Record<string, number>>,
  roster: readonly FormatPresentationRosterPlayer[],
): string[] {
  const ids = new Set(Object.keys(record));
  return [
    ...roster.filter((player) => ids.has(player.id)).map((player) => player.id),
    ...Object.keys(record).filter(
      (id) => !roster.some((player) => player.id === id),
    ),
  ];
}

function playerName(
  playerId: string,
  roster: readonly FormatPresentationRosterPlayer[],
): string {
  return roster.find((player) => player.id === playerId)?.name ?? playerId;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
