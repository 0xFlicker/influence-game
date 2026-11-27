const endpoints = new Set([
  "/api/agent-profiles/anonymous", "/api/agent-profiles/generate", "/api/agent-profiles/creation-assistant",
  "/api/agent-profiles/edit-assistant", "/api/agent-profiles/avatar/generate-draft", "/api/agent-profiles",
  "/api/free-queue/join", "/api/share-links", "/runtime-config",
]);
const groups = new Set(["agent-profiles", "auth", "games", "game-entries", "werewolf", "public-games", "profile", "seasons",
  "free-queue", "championships", "models", "uploads", "audio", "public-players", "config", "health", "admin"]);

export function diagnosticEndpoint(path: string): string {
  const clean = path.split("?", 1)[0];
  if (endpoints.has(clean)) return clean;
  const group = clean.match(/^\/api\/([a-z-]+)(?:\/|$)/)?.[1];
  return group && groups.has(group) ? `/api/${group}/:operation` : "other";
}
