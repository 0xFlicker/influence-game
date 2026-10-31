/** Product-wide hosted OpenAI baseline for new games and generation helpers. */
export const DEFAULT_MODEL_ID = "gpt-6-luna";
export const DEFAULT_MODEL_CATALOG_ID = `openai:${DEFAULT_MODEL_ID}`;

/** Ordered economical native routes, frozen when a new game is created. */
export const DEFAULT_GAME_FALLBACKS = [
  { catalogId: "anthropic:claude-haiku-5-5", reasoningPolicy: "action-policy", maxCallsPerGame: 1000 },
  { catalogId: "xai:grok-4.3", reasoningPolicy: "action-policy", maxCallsPerGame: 1000 },
] as const;
