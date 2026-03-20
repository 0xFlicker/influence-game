"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe, type Stripe as StripeType } from "@stripe/stripe-js";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt } from "wagmi";
import { parseUnits, type Hex } from "viem";
import {
  createPaymentIntent,
  verifyCryptoPayment,
  getPricingTiers,
  type GameSummary,
  type PricingTier,
} from "@/lib/api";
import { getTierForModel, formatPrice } from "@/lib/pricing";

// ---------------------------------------------------------------------------
// Stripe singleton
// ---------------------------------------------------------------------------

let stripePromise: Promise<StripeType | null> | null = null;

function getStripePromise() {
  if (!stripePromise) {
    const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    stripePromise = key ? loadStripe(key) : Promise.resolve(null);
  }
  return stripePromise;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CheckoutModalProps {
  game: GameSummary;
  onClose: () => void;
  onSuccess: (paymentId: string) => void;
}

// ---------------------------------------------------------------------------
// Stripe card form (rendered inside <Elements>)
// ---------------------------------------------------------------------------

function StripeCardForm({
  onSuccess,
  onError,
  submitting,
  setSubmitting,
}: {
  onSuccess: (paymentId: string) => void;
  onError: (msg: string) => void;
  submitting: boolean;
  setSubmitting: (s: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    onError("");

    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (result.error) {
      onError(result.error.message ?? "Payment failed.");
      setSubmitting(false);
    } else if (result.paymentIntent?.status === "succeeded") {
      onSuccess(result.paymentIntent.id);
    } else {
      onError("Payment not completed. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />
      <button
        type="submit"
        disabled={!stripe || !elements || submitting}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-lg font-medium transition-colors"
      >
        {submitting ? "Processing..." : "Pay with Card"}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Crypto payment form
// ---------------------------------------------------------------------------

const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const PAYMENT_RECIPIENT = process.env.NEXT_PUBLIC_PAYMENT_RECIPIENT_ADDRESS ?? "";

function CryptoPaymentForm({
  tier,
  gameId,
  onSuccess,
  onError,
}: {
  tier: PricingTier;
  gameId: string;
  onSuccess: (paymentId: string) => void;
  onError: (msg: string) => void;
}) {
  const { address, isConnected } = useAccount();
  const [currency, setCurrency] = useState<"usdc" | "eth">("usdc");
  const [verifying, setVerifying] = useState(false);
  const usdAmount = tier.buyinCents / 100;

  const { sendTransaction, data: txHash, isPending: isSending } = useSendTransaction();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  // Verify on-chain payment once confirmed
  useEffect(() => {
    if (!isConfirmed || !txHash || verifying) return;
    setVerifying(true);

    verifyCryptoPayment(txHash, tier.id, currency, gameId)
      .then((res) => onSuccess(res.paymentId))
      .catch((err) => {
        onError(err instanceof Error ? err.message : "Verification failed.");
        setVerifying(false);
      });
  }, [isConfirmed, txHash, tier.id, currency, gameId, onSuccess, onError, verifying]);

  function handleSend() {
    if (!isConnected || !address) {
      onError("Please connect your wallet first.");
      return;
    }

    if (!PAYMENT_RECIPIENT) {
      onError("Payment recipient not configured.");
      return;
    }

    if (currency === "usdc") {
      // ERC-20 transfer
      const amount = parseUnits(usdAmount.toString(), 6);
      const data = encodeFunctionData(PAYMENT_RECIPIENT as `0x${string}`, amount);
      sendTransaction({
        to: USDC_BASE_ADDRESS,
        data,
      });
    } else {
      // Native ETH transfer — approximate USD to ETH
      // In production, this would use a price feed
      onError("ETH payments require a price feed. Please use USDC.");
    }
  }

  if (!isConnected) {
    return (
      <div className="border border-dashed border-white/10 rounded-lg p-6 text-center">
        <p className="text-white/40 text-sm">Connect your wallet to pay with crypto.</p>
      </div>
    );
  }

  const isProcessing = isSending || isConfirming || verifying;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="text-white/50">Amount</span>
        <span className="text-white font-medium">${usdAmount.toFixed(2)} USDC</span>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-white/50">Network</span>
        <span className="text-white/70">Base L2</span>
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-white/50">From</span>
        <span className="text-white/70 font-mono text-xs">
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </span>
      </div>

      {/* Currency selector */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setCurrency("usdc")}
          className={`flex-1 text-xs py-2 rounded-lg border transition-all ${
            currency === "usdc"
              ? "border-indigo-500 bg-indigo-600/20 text-white"
              : "border-white/10 text-white/40 hover:border-white/20"
          }`}
        >
          USDC
        </button>
        <button
          type="button"
          onClick={() => setCurrency("eth")}
          disabled
          className="flex-1 text-xs py-2 rounded-lg border border-white/5 text-white/20 cursor-not-allowed"
          title="ETH payments coming soon"
        >
          ETH (soon)
        </button>
      </div>

      {txHash && (
        <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
          <p className="text-xs text-white/40 mb-1">Transaction</p>
          <p className="text-xs text-white/70 font-mono break-all">{txHash}</p>
          {isConfirming && (
            <p className="text-xs text-amber-400 mt-1">Confirming on-chain...</p>
          )}
          {verifying && (
            <p className="text-xs text-indigo-400 mt-1">Verifying payment...</p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={handleSend}
        disabled={isProcessing}
        className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm py-2.5 rounded-lg font-medium transition-colors"
      >
        {isSending
          ? "Sending..."
          : isConfirming
            ? "Confirming..."
            : verifying
              ? "Verifying..."
              : `Pay ${usdAmount.toFixed(2)} USDC`}
      </button>
    </div>
  );
}

// ERC-20 transfer function selector + encoded args
function encodeFunctionData(to: `0x${string}`, amount: bigint): Hex {
  // transfer(address,uint256) selector = 0xa9059cbb
  const selector = "0xa9059cbb";
  const paddedTo = to.slice(2).padStart(64, "0");
  const paddedAmount = amount.toString(16).padStart(64, "0");
  return `${selector}${paddedTo}${paddedAmount}` as Hex;
}

// ---------------------------------------------------------------------------
// Main checkout modal
// ---------------------------------------------------------------------------

export function CheckoutModal({ game, onClose, onSuccess }: CheckoutModalProps) {
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"card" | "crypto">("card");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [loadingIntent, setLoadingIntent] = useState(false);

  // Fetch pricing tiers
  useEffect(() => {
    getPricingTiers()
      .then((tiers) => {
        setPricingTiers(tiers);
        const gameTier = getTierForModel(game.modelTier, tiers);
        if (gameTier) setSelectedTierId(gameTier.id);
      })
      .catch(() => setError("Failed to load pricing."));
  }, [game.modelTier]);

  const selectedTier = pricingTiers.find((t) => t.id === selectedTierId);

  // Create Stripe payment intent when card is selected
  const initStripeIntent = useCallback(async () => {
    if (!selectedTierId || paymentMethod !== "card" || !selectedTier || selectedTier.buyinCents === 0) return;

    setLoadingIntent(true);
    setError("");
    try {
      const result = await createPaymentIntent(selectedTierId, game.id);
      setClientSecret(result.clientSecret);
      setPaymentId(result.paymentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize payment.");
    } finally {
      setLoadingIntent(false);
    }
  }, [selectedTierId, paymentMethod, selectedTier, game.id]);

  useEffect(() => {
    if (paymentMethod === "card" && selectedTier && selectedTier.buyinCents > 0) {
      setClientSecret(null);
      initStripeIntent();
    }
  }, [paymentMethod, selectedTier, initStripeIntent]);

  function handlePaymentSuccess(id: string) {
    onSuccess(paymentId ?? id);
  }

  // If the game's tier is free, this modal shouldn't be shown
  if (selectedTier && selectedTier.buyinCents === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative bg-[#111] border border-white/15 rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-white">Buy In</h2>
              <p className="text-white/40 text-sm mt-1">
                Game #{game.gameNumber} · {selectedTier?.name ?? "Loading..."}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white/30 hover:text-white/70 transition-colors text-xl leading-none"
            >
              x
            </button>
          </div>

          {/* Tier selector */}
          {pricingTiers.length > 0 && (
            <div className="mb-6">
              <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider mb-2">
                Game Tier
              </label>
              <div className="grid grid-cols-2 gap-2">
                {pricingTiers
                  .filter((t) => t.buyinCents > 0)
                  .map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelectedTierId(t.id)}
                      className={`text-left px-3 py-2.5 rounded-lg border text-xs transition-all ${
                        selectedTierId === t.id
                          ? "border-indigo-500 bg-indigo-600/20 text-white"
                          : "border-white/10 text-white/40 hover:border-white/20 hover:text-white/60"
                      }`}
                    >
                      <div className="font-medium mb-0.5">{t.name}</div>
                      <div className="flex items-center justify-between">
                        <span className="text-white/30">{t.model}</span>
                        <span className={selectedTierId === t.id ? "text-indigo-400" : "text-white/50"}>
                          {t.buyinDisplay}
                        </span>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          )}

          {/* Amount summary */}
          {selectedTier && (
            <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-white/50 text-sm">Buy-in</span>
                <span className="text-white font-semibold text-lg">
                  {formatPrice(selectedTier.buyinCents)}
                </span>
              </div>
              <p className="text-white/25 text-xs mt-1">{selectedTier.description}</p>
            </div>
          )}

          {/* Payment method tabs */}
          <div className="flex rounded-lg overflow-hidden border border-white/10 mb-5">
            <button
              onClick={() => setPaymentMethod("card")}
              className={`flex-1 text-xs px-3 py-2 transition-colors ${
                paymentMethod === "card"
                  ? "bg-indigo-600 text-white"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              Card
            </button>
            <button
              onClick={() => setPaymentMethod("crypto")}
              className={`flex-1 text-xs px-3 py-2 transition-colors border-l border-white/10 ${
                paymentMethod === "crypto"
                  ? "bg-indigo-600 text-white"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              }`}
            >
              Crypto
            </button>
          </div>

          {/* Payment form */}
          {paymentMethod === "card" && (
            <>
              {loadingIntent && (
                <div className="text-center text-white/30 text-sm py-8">
                  Initializing payment...
                </div>
              )}
              {clientSecret && (
                <Elements
                  stripe={getStripePromise()}
                  options={{
                    clientSecret,
                    appearance: {
                      theme: "night",
                      variables: {
                        colorPrimary: "#6366f1",
                        colorBackground: "#1a1a1a",
                        colorText: "#ffffff",
                        colorTextSecondary: "#ffffff80",
                        borderRadius: "8px",
                      },
                    },
                  }}
                >
                  <StripeCardForm
                    onSuccess={handlePaymentSuccess}
                    onError={setError}
                    submitting={submitting}
                    setSubmitting={setSubmitting}
                  />
                </Elements>
              )}
            </>
          )}

          {paymentMethod === "crypto" && selectedTier && (
            <CryptoPaymentForm
              tier={selectedTier}
              gameId={game.id}
              onSuccess={handlePaymentSuccess}
              onError={setError}
            />
          )}

          {/* Error */}
          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-2.5 mt-4">
              {error}
            </p>
          )}

          {/* Cancel */}
          <button
            type="button"
            onClick={onClose}
            className="w-full mt-4 border border-white/10 hover:border-white/20 text-white/60 hover:text-white text-sm py-2.5 rounded-lg transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
