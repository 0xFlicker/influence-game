/** Current selection policy only. Historical catalog IDs remain readable verbatim. */
export function preferredClaudeCatalogId(catalogId: string): string {
  const match = /^(?:katana|anthropic):claude-(haiku|sonnet|opus|fable)-[0-9][a-zA-Z0-9.-]*$/.exec(catalogId);
  if (!match) return catalogId;
  const family = match[1]!;
  return `anthropic:claude-${family}-${family === "fable" ? "5-1" : "5-5"}`;
}

export function assertCurrentClaudeSelection(catalogId: string): void {
  const preferred = preferredClaudeCatalogId(catalogId);
  if (preferred !== catalogId) throw new Error(`Claude selections must use ${preferred}`);
}
