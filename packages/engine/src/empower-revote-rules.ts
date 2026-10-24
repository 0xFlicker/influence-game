/** Frozen per game: v1 counts active ballots; v2 counts only new revote ballots. */
export type EmpowerRevoteVersion = 1 | 2;
export const CURRENT_EMPOWER_REVOTE_VERSION: EmpowerRevoteVersion = 2;

/** Unversioned stored games predate the new-ballot rule. Never infer from results. */
export function resolveEmpowerRevoteVersion(value: unknown): EmpowerRevoteVersion {
  if (value === undefined) return 1;
  if (value === 1 || value === 2) return value;
  throw new Error(`Unsupported empower revote version: ${String(value)}`);
}

/** Shared by execution and presentation; winner selection is deliberately separate. */
export function tallyEmpowerRevote(
  version: EmpowerRevoteVersion,
  tied: readonly string[],
  activeVotes: ReadonlyMap<string, string>,
  revotes: ReadonlyMap<string, string>,
): { counts: Record<string, number>; countedVotes: { voterId: string; targetId: string }[] } {
  const votes = resolveEmpowerRevoteVersion(version) === 1 ? activeVotes : revotes;
  const counts = Object.fromEntries(tied.map((id) => [id, 0]));
  const countedVotes = [...votes].flatMap(([voterId, targetId]) => {
    if (!tied.includes(targetId)) return [];
    counts[targetId]! += 1;
    return [{ voterId, targetId }];
  });
  return { counts, countedVotes };
}
