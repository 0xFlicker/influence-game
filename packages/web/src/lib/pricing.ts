/**
 * Client-side pricing utilities.
 * Maps game model tiers to display pricing based on backend pricing tiers.
 */

import type { ModelTier, PricingTier } from "./api";

/**
 * Derive the most likely pricing tier ID from a game's model tier.
 * Used when the game doesn't have an explicit pricingTierId.
 */
export function modelTierToPricingId(modelTier: ModelTier): string {
  switch (modelTier) {
    case "budget":
      return "free";
    case "standard":
      return "standard";
    case "premium":
      return "premium";
    default:
      return "free";
  }
}

/**
 * Format a cents amount as a display price.
 */
export function formatPrice(cents: number): string {
  if (cents === 0) return "Free";
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Find the matching pricing tier for a game's model tier.
 */
export function getTierForModel(
  modelTier: ModelTier,
  tiers: PricingTier[],
): PricingTier | undefined {
  const id = modelTierToPricingId(modelTier);
  return tiers.find((t) => t.id === id);
}
