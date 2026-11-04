/** Local adapters are permitted only in development/tests or an unlabelled loopback database setup. */
export function isLocalGameRuntime(env: NodeJS.ProcessEnv = process.env) {
  // Read runtime configuration indirectly: Bun folds direct process.env.NODE_ENV reads at build time.
  const environment = env.NODE_ENV;
  if (environment === "development" || environment === "test") return true;
  if (environment) return false;
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.DATABASE_URL ?? "").hostname); }
  catch { return false; }
}
