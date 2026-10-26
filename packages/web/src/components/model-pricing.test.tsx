import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { modelCatalogEntryById } from "@influence/engine/model-catalog";
import { ModelPricing } from "./model-pricing";

test("formats provider prices without floating-point artifacts and preserves accounting precision", () => {
  const card = modelCatalogEntryById("katana:kimi-k3")!.metadata.rateCard!;
  const input = card.rates.inputPer1M;
  const html = renderToStaticMarkup(<ModelPricing rateCard={card} />);
  expect(html).toContain("$0.244 input / $11.016 output per 1M tokens (USD)");
  expect(html).toContain("text-sm");
  expect(html).not.toContain("999999");
  expect(card.rates.inputPer1M).toBe(input);
});

test("Luna displays Flex prices; missing prices never display zero or a default model price", () => {
  expect(renderToStaticMarkup(<ModelPricing rateCard={modelCatalogEntryById("openai:gpt-6-luna")!.metadata.rateCard} />))
    .toContain("$0.05 input / $0.25 output");
  expect(renderToStaticMarkup(<ModelPricing rateCard={null} />)).toContain("Pricing unavailable");
  const card = modelCatalogEntryById("openai:gpt-6-luna")!.metadata.rateCard!;
  const tiny = { ...card, rates: { ...card.rates, inputPer1M: 0.00001, outputPer1M: 0 } };
  expect(renderToStaticMarkup(<ModelPricing rateCard={tiny} />)).toContain("&lt;$0.001 input / $0.00 output");
});
