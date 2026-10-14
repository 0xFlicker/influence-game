/** Shared defaults for the mandatory speech tail, including structured retries. */
import { MAX_NEW_GAME_PLAYERS } from "./types";
export const RETROSPECTIVE_OUTPUT_TOKEN_LIMIT = 16_384;
export const RETROSPECTIVE_MAX_SPEECH_CHARACTERS = 2000;
export function retrospectiveAttemptsPerModel(gameKind: "influence" | "werewolf") { return gameKind === "werewolf" ? 3 : 2; }

export function forecastRetrospectiveBudget(gameKind: "influence" | "werewolf", originalPlayers: number,
  entries: readonly { catalogId: string; maxCallsPerGame?: number }[]) {
  if (!Number.isSafeInteger(originalPlayers) || originalPlayers < 1 || originalPlayers > MAX_NEW_GAME_PLAYERS || !entries.length) throw new Error("Invalid retrospective forecast roster or route");
  const attempts = retrospectiveAttemptsPerModel(gameKind);
  return { version: 1 as const, requiredSpeechCalls: originalPlayers, attemptsPerModelPerSpeech: attempts,
    outputTokenLimitPerAttempt: RETROSPECTIVE_OUTPUT_TOKEN_LIMIT,
    // Speech appears in both the request and explicit quoted-prior lane. This
    // bounds escaped speech text only; whole-game context/metadata are additional.
    maxAccumulatedPriorSpeechTextBytes: originalPlayers * (originalPlayers - 1) * RETROSPECTIVE_MAX_SPEECH_CHARACTERS * 6,
    entries: entries.map(entry => ({ catalogId: entry.catalogId, maxRetrospectiveDispatches: Math.min(originalPlayers * attempts, entry.maxCallsPerGame ?? Infinity),
      sharedGameDispatchCap: entry.maxCallsPerGame ?? null })) };
}
