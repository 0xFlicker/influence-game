import type { CompletedResultsVoteColumn, CompletedResultsVoteRow } from "./completed-results-model";

export function CompletedResultsVoteMatrix({
  columns,
  rows,
}: {
  columns: CompletedResultsVoteColumn[];
  rows: CompletedResultsVoteRow[];
}) {
  if (columns.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-sm text-white/45">
        Vote history is unavailable for this game.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-white/10">
      <table className="min-w-full border-collapse text-left text-xs">
        <thead className="bg-white/[0.04] text-white/45">
          <tr>
            <th className="sticky left-0 z-10 min-w-36 bg-[#080c13] px-3 py-3 font-medium">Agent</th>
            {columns.map((column) => (
              <th key={column.id} className="min-w-24 px-2 py-3 font-medium" title={column.label}>
                {column.shortLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.player.id} className="border-t border-white/10">
              <th className="sticky left-0 z-10 bg-[#080c13] px-3 py-2 font-medium text-white/80">
                {row.player.name}
              </th>
              {row.cells.map((cell, index) => (
                <td key={`${row.player.id}:${columns[index]?.id ?? index}`} className="px-2 py-2">
                  <span className={`inline-flex min-w-16 max-w-28 justify-center truncate rounded-md border px-2 py-1 ${cell.colorClass}`}>
                    {cell.targetName}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
