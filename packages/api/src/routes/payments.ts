/**
 * Payment REST API routes.
 *
 * Endpoints:
 *   POST /api/payments/create-intent    — create a Stripe payment intent
 *   POST /api/webhooks/stripe           — Stripe webhook handler
 *   POST /api/payments/verify-crypto    — verify an on-chain crypto payment
 *   GET  /api/games/pricing             — list pricing tiers
 */

import { Hono } from "hono";
import { randomUUID } from "crypto";
import Stripe from "stripe";
import { type PublicClient, createPublicClient, http, parseAbi, isHash } from "viem";
import { base } from "viem/chains";
import { eq } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import {
  PRICING_TIERS,
  getTierById,
  USDC_BASE_ADDRESS,
  USDC_DECIMALS,
  getPaymentRecipient,
} from "../lib/pricing.js";

// ---------------------------------------------------------------------------
// Stripe client (lazy singleton)
// ---------------------------------------------------------------------------

let _stripe: Stripe | null = null;

function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY must be set");
    }
    _stripe = new Stripe(key);
  }
  return _stripe;
}

function getStripeWebhookSecret(): string {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("STRIPE_WEBHOOK_SECRET must be set");
  }
  return secret;
}

// ---------------------------------------------------------------------------
// Viem public client for Base L2 (lazy singleton)
// ---------------------------------------------------------------------------

let _baseClient: PublicClient | null = null;

function getBaseClient(): PublicClient {
  if (!_baseClient) {
    const rpcUrl = process.env.BASE_RPC_URL;
    _baseClient = createPublicClient({
      chain: base,
      transport: http(rpcUrl), // undefined = default public RPC
    }) as PublicClient;
  }
  return _baseClient;
}

// ---------------------------------------------------------------------------
// ERC-20 Transfer event ABI (for USDC verification)
// ---------------------------------------------------------------------------

const erc20TransferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPaymentRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  // -------------------------------------------------------------------------
  // GET /api/games/pricing — list pricing tiers (public)
  // -------------------------------------------------------------------------

  app.get("/api/games/pricing", (c) => {
    return c.json({
      tiers: PRICING_TIERS.map((t) => ({
        id: t.id,
        name: t.name,
        buyinCents: t.buyin,
        buyinDisplay: t.buyin === 0 ? "Free" : `$${(t.buyin / 100).toFixed(2)}`,
        model: t.model,
        description: t.description,
        maxSlots: t.maxSlots,
      })),
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/payments/create-intent — create Stripe payment intent
  // -------------------------------------------------------------------------

  app.post(
    "/api/payments/create-intent",
    requireAuth(db),
    async (c) => {
      const user = c.get("user");
      const body = await c.req.json().catch(() => null);
      if (!body) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      const { tierId, gameId } = body as {
        tierId?: string;
        gameId?: string;
      };

      if (!tierId) {
        return c.json({ error: "tierId is required" }, 400);
      }

      const tier = getTierById(tierId);
      if (!tier) {
        return c.json({ error: "Invalid pricing tier" }, 400);
      }

      if (tier.buyin === 0) {
        return c.json({ error: "Free tier does not require payment" }, 400);
      }

      // Validate game exists if provided
      if (gameId) {
        const game = db
          .select({ id: schema.games.id })
          .from(schema.games)
          .where(eq(schema.games.id, gameId))
          .all()[0];
        if (!game) {
          return c.json({ error: "Game not found" }, 404);
        }
      }

      const stripe = getStripe();

      const paymentIntent = await stripe.paymentIntents.create({
        amount: tier.buyin,
        currency: "usd",
        metadata: {
          userId: user.id,
          tierId: tier.id,
          ...(gameId ? { gameId } : {}),
        },
      });

      // Record payment as pending
      const paymentId = randomUUID();
      db.insert(schema.payments)
        .values({
          id: paymentId,
          userId: user.id,
          gameId: gameId ?? null,
          amount: tier.buyin / 100, // Store as dollars
          currency: "usd",
          method: "stripe",
          stripePaymentIntentId: paymentIntent.id,
          status: "pending",
        })
        .run();

      return c.json({
        clientSecret: paymentIntent.client_secret,
        paymentId,
        amount: tier.buyin,
        currency: "usd",
      });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/webhooks/stripe — Stripe webhook handler
  // -------------------------------------------------------------------------

  app.post("/api/webhooks/stripe", async (c) => {
    const stripe = getStripe();
    const sig = c.req.header("stripe-signature");
    if (!sig) {
      return c.json({ error: "Missing stripe-signature header" }, 400);
    }

    // Stripe SDK needs the raw body for signature verification
    const rawBody = await c.req.text();

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(
        rawBody,
        sig,
        getStripeWebhookSecret(),
      );
    } catch (err) {
      console.error("[payments] Stripe webhook signature verification failed:", err);
      return c.json({ error: "Invalid webhook signature" }, 400);
    }

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;

      db.update(schema.payments)
        .set({ status: "confirmed" as const })
        .where(
          eq(
            schema.payments.stripePaymentIntentId,
            paymentIntent.id,
          ),
        )
        .run();

      console.log(
        `[payments] Stripe payment confirmed: ${paymentIntent.id} ($${(paymentIntent.amount / 100).toFixed(2)})`,
      );
    }

    // Acknowledge receipt
    return c.json({ received: true });
  });

  // -------------------------------------------------------------------------
  // POST /api/payments/verify-crypto — verify on-chain crypto payment
  // -------------------------------------------------------------------------

  app.post(
    "/api/payments/verify-crypto",
    requireAuth(db),
    async (c) => {
      const user = c.get("user");
      const body = await c.req.json().catch(() => null);
      if (!body) {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      const { txHash, tierId, gameId, currency } = body as {
        txHash?: string;
        tierId?: string;
        gameId?: string;
        currency?: string;
      };

      if (!txHash || !tierId) {
        return c.json({ error: "txHash and tierId are required" }, 400);
      }

      if (!isHash(txHash)) {
        return c.json({ error: "Invalid transaction hash" }, 400);
      }

      const tier = getTierById(tierId);
      if (!tier) {
        return c.json({ error: "Invalid pricing tier" }, 400);
      }

      if (tier.buyin === 0) {
        return c.json({ error: "Free tier does not require payment" }, 400);
      }

      const paymentCurrency = currency === "eth" ? "eth" : "usdc";

      // Check for duplicate tx hash
      const existing = db
        .select({ id: schema.payments.id })
        .from(schema.payments)
        .where(eq(schema.payments.txHash, txHash))
        .all()[0];

      if (existing) {
        return c.json({ error: "Transaction already used for a payment" }, 409);
      }

      const client = getBaseClient();
      const recipient = getPaymentRecipient().toLowerCase();

      const receipt = await client.getTransactionReceipt({ hash: txHash });

      if (receipt.status !== "success") {
        return c.json({ error: "Transaction failed or is still pending" }, 400);
      }

      let verified = false;
      let verifiedAmount = 0;

      if (paymentCurrency === "eth") {
        // Native ETH transfer — check tx value and recipient
        const tx = await client.getTransaction({ hash: txHash });
        if (tx.to?.toLowerCase() !== recipient) {
          return c.json({ error: "Transaction recipient does not match" }, 400);
        }

        // Convert wei to USD cents (requires price feed — for now accept any ETH amount)
        // The tier.buyin is in cents. We store the ETH amount directly.
        verifiedAmount = Number(tx.value) / 1e18;
        verified = tx.value > 0n;
      } else {
        // USDC ERC-20 transfer — parse Transfer logs
        const logs = await client.getLogs({
          address: USDC_BASE_ADDRESS,
          event: erc20TransferAbi[0],
          args: { to: recipient as `0x${string}` },
          fromBlock: receipt.blockNumber,
          toBlock: receipt.blockNumber,
        });

        const matchingLog = logs.find(
          (log) => log.transactionHash === txHash,
        );

        if (!matchingLog || !matchingLog.args.value) {
          return c.json({ error: "No matching USDC transfer found in transaction" }, 400);
        }

        const usdcAmount = Number(matchingLog.args.value) / 10 ** USDC_DECIMALS;
        const expectedUsd = tier.buyin / 100;

        // Allow 1% tolerance for rounding
        if (usdcAmount < expectedUsd * 0.99) {
          return c.json(
            {
              error: `Insufficient USDC amount: sent $${usdcAmount.toFixed(2)}, required $${expectedUsd.toFixed(2)}`,
            },
            400,
          );
        }

        verifiedAmount = usdcAmount;
        verified = true;
      }

      if (!verified) {
        return c.json({ error: "Could not verify payment" }, 400);
      }

      // Record confirmed payment
      const paymentId = randomUUID();
      db.insert(schema.payments)
        .values({
          id: paymentId,
          userId: user.id,
          gameId: gameId ?? null,
          amount: verifiedAmount,
          currency: paymentCurrency,
          method: "crypto",
          txHash,
          status: "confirmed",
        })
        .run();

      console.log(
        `[payments] Crypto payment verified: ${txHash} (${verifiedAmount} ${paymentCurrency.toUpperCase()})`,
      );

      return c.json({
        paymentId,
        status: "confirmed",
        amount: verifiedAmount,
        currency: paymentCurrency,
      });
    },
  );

  return app;
}
