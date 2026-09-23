import type { VisualImageReceipt } from "./visual-image-provider.js";

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
/** Published standard rates, checked 2026-09-21. Missing usage remains unpriced. */
export function visualReceiptCostMicrousd(receipt: VisualImageReceipt): number | null {
  if (receipt.chargeUncertain || receipt.status === null) return null;
  if (receipt.status < 200 || receipt.status >= 300) return 0;
  if (receipt.provider === "xai" && receipt.model === "grok-imagine-image-2.0" && receipt.imageInputs !== undefined) {
    // Fixed production request: one 2K/medium output, $0.01 per reference.
    return 80_000 + receipt.imageInputs * 10_000;
  }
  const usage = record(receipt.usage);
  if (!usage) return null;
  const output = count(usage.output_tokens), input = count(usage.input_tokens);
  if (output === null || input === null) return null;
  const details = record(usage.input_tokens_details);
  const cached = count(details?.cached_tokens ?? 0);
  if (cached === null || cached > input) return null;
  if (receipt.model === "gpt-5.6-luna" || receipt.model === "gpt-5.6-sol") {
    const writes = count(details?.cache_write_tokens ?? 0);
    if (writes === null || writes + cached > input) return null;
    const rates = receipt.model === "gpt-5.6-sol" ? { input: 4, write: 5, cached: 0.4, output: 20 } : { input: 0.20, write: 0.25, cached: 0.02, output: 1.20 };
    return Math.round((input - cached - writes) * rates.input + writes * rates.write + cached * rates.cached + output * rates.output);
  }
  if (receipt.model !== "gpt-image-2") return null;
  const text = count(details?.text_tokens), image = count(details?.image_tokens);
  if (text === null || image === null || text + image !== input) return null;
  const cacheDetails = record(details?.cached_tokens_details);
  const cachedText = count(cacheDetails?.text_tokens ?? (cached === 0 ? 0 : undefined));
  const cachedImage = count(cacheDetails?.image_tokens ?? (cached === 0 ? 0 : undefined));
  if (cachedText === null || cachedImage === null || cachedText + cachedImage !== cached || cachedText > text || cachedImage > image) return null;
  return Math.round((text - cachedText) * 5 + cachedText * 1.25 + (image - cachedImage) * 8 + cachedImage * 2 + output * 30);
}
