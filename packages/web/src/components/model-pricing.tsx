import type { ModelRateCard } from "@influence/engine/model-route-metadata";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 3 });

function rate(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "Unavailable";
  return value > 0 && value < 0.001 ? "<$0.001" : usd.format(value);
}

/** Shared presentation only: retain full precision in catalog rates and accounting. */
export function ModelPricing({ rateCard }: { rateCard: ModelRateCard | null | undefined }) {
  return <span className="mt-2 block text-sm leading-6 text-white/70">
    {rateCard
      ? `Estimated provider cost: ${rate(rateCard.rates.inputPer1M)} input / ${rate(rateCard.rates.outputPer1M)} output per 1M tokens (USD)`
      : "Pricing unavailable"}
  </span>;
}
