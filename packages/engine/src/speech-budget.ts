/** Prompt-only drafting margin. The owning action still enforces its exact byte ceiling. */
export function speechDraftingGuidance(maxBytes: number): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("Speech byte limit must be a positive integer");
  const target = Math.max(1, Math.floor(maxBytes * 0.6));
  return `Aim for ${target} UTF-8 bytes or fewer: one short sentence making one useful point. This is a drafting target; the hard limit remains ${maxBytes} UTF-8 bytes. Leave room for names and punctuation; non-ASCII characters can use several bytes. Do not expand a concise answer just to fill the allowance.`;
}
