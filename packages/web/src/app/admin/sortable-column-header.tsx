export type SortDirection = "asc" | "desc";

export function compareSortValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function SortableColumnHeader<Key extends string>({
  column,
  label,
  sortKey,
  direction,
  onSort,
  align = "left",
}: {
  column: Key;
  label: string;
  sortKey: Key;
  direction: SortDirection;
  onSort: (column: Key) => void;
  align?: "left" | "center";
}) {
  const active = column === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-3 text-xs font-medium text-white/30 ${align === "center" ? "text-center" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className="inline-flex min-h-8 items-center gap-1 rounded text-inherit hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400"
        aria-label={`Sort by ${label} ${active && direction === "asc" ? "descending" : "ascending"}`}
      >
        {label} <span aria-hidden="true">{active ? (direction === "asc" ? "↑" : "↓") : "↕"}</span>
      </button>
    </th>
  );
}
