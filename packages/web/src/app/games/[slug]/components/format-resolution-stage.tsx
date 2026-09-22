import type {
  FormatPresentationCue,
  FormatPresentationRosterPlayer,
  FormatResolutionPresentation,
} from "./types";
import {
  displayNameForFormat,
  getFormatRegistration,
} from "@influence/engine/format-rules";

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
      className="mx-auto w-full max-w-2xl px-4 py-3"
      aria-live="polite"
    >
      <header className="text-center">
        <p className="text-[10px] uppercase tracking-[0.26em] text-white/35">
          Tally
        </p>
        <h2 className="mt-2 text-xl font-semibold text-white sm:text-2xl">
          Vote totals
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
    <AggregateTotals
      caption="Save-or-Exit aggregate"
      columns={["Agent", "Saves", "Exits", "Net", "Status"]}
      rows={ids.map((playerId) => [
        playerName(playerId, roster),
        String(facts.savesReceived[playerId] ?? 0),
        String(facts.eliminateReceived[playerId] ?? 0),
        signed(facts.nets[playerId] ?? 0),
        facts.nets[playerId] === lowestNet ? "Exit eligible" : "Above the line",
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
  const highestWins = registration.presentation.scoring !== "fewest_positive";
  const allOdd = registration.presentation.scoring === "highest_even"
    && Object.values(facts.totals).every((total) => total % 2 !== 0);
  const dangerTotal = highestWins
    ? Math.max(...eligibleTotals)
    : Math.min(...eligibleTotals);
  const ids = orderedIds(facts.totals, roster);
  const isDanger = (playerId: string) => (
    eligible.has(playerId)
    && (allOdd || facts.totals[playerId] === dangerTotal)
  );
  const status = (playerId: string) => {
    if (allOdd) return "Odd total · empowered choice";
    if (!eligible.has(playerId)) {
      return registration.presentation.scoring === "highest_even"
        ? "Odd total · safe"
        : "Zero votes · safe";
    }
    if (isDanger(playerId)) {
      if (registration.presentation.scoring === "highest_total") {
        return "Highest total · exit eligible";
      }
      if (registration.presentation.scoring === "highest_even") {
        return "Highest even total · exit eligible";
      }
      return "Fewest positive · eligible";
    }
    if (registration.presentation.scoring === "highest_total") return "Below the high vote";
    if (registration.presentation.scoring === "highest_even") return "Even total · below danger";
    return "Above the line";
  };
  return (
    <AggregateTotals
      caption={`${displayNameForFormat(resolution.formatId)} aggregate`}
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
        <AggregateTotals
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

function AggregateTotals({
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
    <dl aria-label={caption} className="mt-5 flex flex-col gap-4">
      {rows.map((cells, rowIndex) => {
        const playerId = rowIds[rowIndex]!;
        const state = rowState(playerId);
        return <div key={playerId} data-aggregate-player={playerId} data-aggregate-state={state}
          className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-white/10 pb-3 last:border-0">
          <dt className="font-medium text-white">{cells[0]}</dt>
          <dd className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-white/75">
            {cells.slice(1, -1).map((cell, index) => <span key={columns[index + 1]}><strong className="text-xl font-semibold">{cell}</strong> <span className="text-xs text-white/45">{columns[index + 1]}</span></span>)}
            <span className={`text-xs ${AGGREGATE_STATUS_CLASS[state]}`}>{cells.at(-1)}</span>
          </dd>
        </div>;
      })}
    </dl>
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
