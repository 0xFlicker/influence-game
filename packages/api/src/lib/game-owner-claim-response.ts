import type { GameOwnerClaimResult } from "../services/game-ownership.js";

type FailedGameOwnerClaim = Extract<GameOwnerClaimResult, { ok: false }>;

export function gameOwnerClaimErrorBody(claim: FailedGameOwnerClaim): {
  error: string;
  code?: string;
  reason?: string;
  retryable?: boolean;
} {
  return {
    error: claim.error,
    ...(claim.code && { code: claim.code }),
    ...(claim.reason && { reason: claim.reason }),
    ...(claim.retryable !== undefined && { retryable: claim.retryable }),
  };
}
