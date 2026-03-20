/**
 * Game pricing tiers — in-code constants for initial launch.
 *
 * Each tier maps to a model quality level and buy-in amount.
 */

export interface PricingTier {
  id: string;
  name: string;
  buyin: number; // USD cents (0 = free)
  model: string;
  description: string;
  maxSlots: number;
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "free",
    name: "Free",
    buyin: 0,
    model: "gpt-4o-mini",
    description: "Free tier with limited slots",
    maxSlots: 6,
  },
  {
    id: "standard",
    name: "Standard",
    buyin: 100, // $1.00
    model: "gpt-4o-mini",
    description: "Standard game with gpt-4o-mini agents",
    maxSlots: 12,
  },
  {
    id: "premium",
    name: "Premium",
    buyin: 500, // $5.00
    model: "gpt-4o",
    description: "Premium game with gpt-4o agents",
    maxSlots: 12,
  },
  {
    id: "showcase",
    name: "Showcase",
    buyin: 1500, // $15.00
    model: "gpt-5",
    description: "Showcase game with gpt-5 agents (when available)",
    maxSlots: 12,
  },
];

export function getTierById(id: string): PricingTier | undefined {
  return PRICING_TIERS.find((t) => t.id === id);
}

/** House rake percentage (0–1). 15% of total buy-ins. */
export const RAKE_PERCENTAGE = 0.15;

/** Maximum free games per day across the platform. */
export const MAX_FREE_GAMES_PER_DAY = 6;

/** Premium model upgrade fee in USD cents. */
export const MODEL_UPGRADE_FEE_CENTS = 400; // $4.00

/** Model used for upgraded agents. */
export const UPGRADE_MODEL = "gpt-4o";

/** USDC uses 6 decimals on Base L2. */
export const USDC_DECIMALS = 6;

/** Well-known USDC contract on Base mainnet. */
export const USDC_BASE_ADDRESS =
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

/** Whether payment infrastructure (Stripe) is configured. */
export function isPaymentsEnabled(): boolean {
  return !!process.env.STRIPE_SECRET_KEY;
}

/** Expected payment recipient address — loaded from env at runtime. */
export function getPaymentRecipient(): string {
  const addr = process.env.PAYMENT_RECIPIENT_ADDRESS;
  if (!addr) {
    throw new Error("PAYMENT_RECIPIENT_ADDRESS must be set");
  }
  return addr;
}
