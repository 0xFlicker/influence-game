/** Preview preferences must never remove media required by the selected export. */
export function productionMediaIds(previewIds: readonly string[], cutIds: readonly string[]): string[] {
  return [...new Set([...previewIds, ...cutIds])];
}
