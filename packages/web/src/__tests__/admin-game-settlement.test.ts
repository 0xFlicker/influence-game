import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  RetrySettlementDialog,
  settlementRetryErrorMessage,
  settlementRetryIsAvailable,
  settlementRetrySuccessMessage,
} from "../app/admin/games/game-history-browser";
import {
  ApiError,
  retryGameSettlement,
  setApiBase,
  type AdminGameSummary,
  type RetryGameSettlementResult,
} from "../lib/api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setApiBase("http://127.0.0.1:3000");
});

describe("admin completion settlement retry", () => {
  test("posts the operator reason with the exact confirmation", async () => {
    setApiBase("http://127.0.0.1:3333");
    let request: { url: string; init?: RequestInit } | undefined;
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      request = { url: String(url), init };
      return Response.json(retryResult());
    }) as typeof fetch;

    await retryGameSettlement("sealed game/bay", "Runner is confirmed absent");

    expect(request?.url).toBe(
      "http://127.0.0.1:3333/api/admin/games/sealed%20game%2Fbay/completion-settlement/retry",
    );
    expect(request?.init?.method).toBe("POST");
    expect(JSON.parse(String(request?.init?.body))).toEqual({
      reason: "Runner is confirmed absent",
      confirmation: "RETRY_SETTLEMENT",
    });
  });

  test("reports follow-up reconciliation truthfully", () => {
    expect(settlementRetrySuccessMessage(retryResult())).toBe(
      "Settlement completed from the sealed result. Watch and media state were reconciled.",
    );
    expect(settlementRetrySuccessMessage(retryResult({
      outcome: "already_completed",
      watchRefreshed: false,
      mediaReconciliation: null,
    }))).toBe(
      "Settlement was already completed. The sealed result is complete, but one or more follow-up views still need inspection.",
    );
  });

  test("renders the explicit operator gate and only offers eligible retries", () => {
    const game = adminGame();
    const html = renderToString(createElement(RetrySettlementDialog, {
      game,
      onClose: () => {},
      onSettled: () => {},
    }));

    expect(html).toContain("Retry completion settlement");
    expect(html).toContain("It does not replay gameplay.");
    expect(html).toContain("Operator reason");
    expect(html).toContain("RETRY_SETTLEMENT");
    expect(html).toContain("Retry sealed settlement");
    expect(settlementRetryIsAvailable(game, true)).toBeTrue();
    expect(settlementRetryIsAvailable(game, false)).toBeFalse();
    expect(settlementRetryIsAvailable(adminGame({
      completionSettlement: { ...game.completionSettlement, retryEligible: false },
    }), true)).toBeFalse();
  });

  test("maps stable blocked states to operator-safe copy", () => {
    expect(settlementRetryErrorMessage(new ApiError(409, "blocked", "repair_blocked"))).toBe(
      "Retry is blocked because this settlement requires evidence repair.",
    );
    expect(settlementRetryErrorMessage(new ApiError(409, "changed", "invalid_state"))).toBe(
      "This settlement is no longer ready for retry. Refresh and inspect its current state.",
    );
  });
});

function adminGame(overrides: Partial<AdminGameSummary> = {}): AdminGameSummary {
  return {
    id: "game-id",
    slug: "sealed-result-bay",
    status: "suspended",
    playerCount: 4,
    currentRound: 3,
    maxRounds: 8,
    currentPhase: "jury_vote",
    phaseTimeRemaining: null,
    alivePlayers: 2,
    eliminatedPlayers: 2,
    modelTier: "standard",
    visibility: "public",
    viewerMode: "live",
    trackType: "custom",
    hidden: false,
    completionSettlement: {
      schemaVersion: 1,
      state: "pending",
      retryEligible: true,
      attemptCount: 1,
      resultHash: `sha256:${"a".repeat(64)}`,
      boundary: {
        ownerEpoch: "owner-epoch",
        finalEventSequence: 12,
        finalEventHash: `sha256:${"b".repeat(64)}`,
      },
      failureCode: null,
      capturedAt: "2026-07-15T12:00:00.000Z",
      retryReadyAt: "2026-07-15T12:01:00.000Z",
      lastAttemptedAt: "2026-07-15T12:01:00.000Z",
      completedAt: null,
    },
    createdAt: "2026-07-15T11:00:00.000Z",
    ...overrides,
  };
}

function retryResult(
  overrides: Partial<RetryGameSettlementResult> = {},
): RetryGameSettlementResult {
  return {
    outcome: "completed",
    settlement: {
      schemaVersion: 1,
      state: "completed",
      retryEligible: false,
      attemptCount: 1,
      resultHash: `sha256:${"a".repeat(64)}`,
      boundary: {
        ownerEpoch: "owner-epoch",
        finalEventSequence: 12,
        finalEventHash: `sha256:${"b".repeat(64)}`,
      },
      failureCode: null,
      capturedAt: "2026-07-15T12:00:00.000Z",
      retryReadyAt: null,
      lastAttemptedAt: "2026-07-15T12:01:00.000Z",
      completedAt: "2026-07-15T12:01:00.000Z",
    },
    watchRefreshed: true,
    mediaReconciliation: {
      outcome: "queued",
      gameId: "game-id",
      previousRenderVersion: null,
      currentRenderVersion: 1,
    },
    ...overrides,
  };
}
