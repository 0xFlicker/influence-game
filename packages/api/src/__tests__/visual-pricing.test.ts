import { expect, test } from "bun:test";
import { visualReceiptCostMicrousd } from "../services/visual-pricing";
import type { VisualImageReceipt } from "../services/visual-image-provider";
const receipt: VisualImageReceipt = { provider: "openai", model: "gpt-image-2", requestHash: "test", requestId: null, status: 200, elapsedMs: 1, chargeUncertain: false, usage: null };
test("image token costs distinguish text, images and cached inputs", () => {
  expect(visualReceiptCostMicrousd({ ...receipt, usage: { input_tokens: 1000, output_tokens: 200, input_tokens_details: { text_tokens: 200, image_tokens: 800, cached_tokens: 100, cached_tokens_details: { text_tokens: 20, image_tokens: 80 } } } })).toBe(12845);
  expect(visualReceiptCostMicrousd({ ...receipt, provider: "xai", model: "grok-imagine-image-2.0", imageInputs: 3 })).toBe(110000);
});
test("unknown and inconsistent receipts stay unpriced and rejected requests cost zero", () => {
  expect(visualReceiptCostMicrousd(receipt)).toBeNull();
  expect(visualReceiptCostMicrousd({ ...receipt, chargeUncertain: true, status: 503 })).toBeNull();
  expect(visualReceiptCostMicrousd({ ...receipt, status: 400 })).toBe(0);
  expect(visualReceiptCostMicrousd({ ...receipt, usage: { input_tokens: 10, output_tokens: 10, input_tokens_details: { image_tokens: 20, text_tokens: 1 } } })).toBeNull();
});
test("vision usage accounts for cache reads and writes", () => {
  expect(visualReceiptCostMicrousd({ ...receipt, model: "gpt-5.6-luna", usage: { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 100 } } })).toBe(307);
});
