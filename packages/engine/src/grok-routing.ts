/** Explicit same-generation cutover. Never apply this to frozen runtime reads. */
export const NATIVE_GROK_SELECTIONS: Readonly<Record<string, string>> = {
  "katana:grok-4-6": "xai:grok-4.6",
  "katana:grok-4-5": "xai:grok-4.5",
  "katana:grok-4-3": "xai:grok-4.3",
  "katana:grok-4-20-multi-agent": "xai:grok-4.20-multi-agent-0309",
};

export function isKatanaGrokSelection(catalogId: string): boolean {
  return catalogId.startsWith("katana:grok-");
}

export function assertCurrentGrokSelection(catalogId: string): void {
  if (!isKatanaGrokSelection(catalogId)) return;
  const replacement = NATIVE_GROK_SELECTIONS[catalogId];
  throw new Error(replacement ? `Grok selections must use ${replacement}`
    : `Katana Grok selection ${catalogId} needs an audited native xAI equivalent`);
}
