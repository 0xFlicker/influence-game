/** Product-wide hosted OpenAI baseline for new games and generation helpers. */
export const DEFAULT_MODEL_ID = "gpt-6-luna";
export const DEFAULT_MODEL_CATALOG_ID = `openai:${DEFAULT_MODEL_ID}`;

export const DEFAULT_GAME_FALLBACK = {
  catalogId: "katana:grok-4-6",
  reasoningPolicy: "action-policy",
  maxCallsPerGame: 24,
} as const;
