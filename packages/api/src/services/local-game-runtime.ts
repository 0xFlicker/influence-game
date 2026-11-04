/** Local adapters are permitted only in development/tests or an unlabelled loopback database setup. */
export function isLocalGameRuntime() {
  const environment = process.env.NODE_ENV;
  if (environment === "development" || environment === "test") return true;
  if (environment) return false;
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL ?? "").hostname); }
  catch { return false; }
}
