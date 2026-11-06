/** Stable categories only: error messages, query arguments and identifiers may be private. */
export function playerHistoryFailureCategory(error: unknown): string {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if (current instanceof SyntaxError) return "invalid_json";
    const value = current as { code?: unknown; cause?: unknown };
    if (value.code === "57014") return "database_cancelled_or_timeout";
    if (value.code === "22P02" || value.code === "22023") return "invalid_database_data";
    if (typeof value.code === "string" && /^(08|53|57)[0-9A-Z]{3}$/.test(value.code)) return "database_unavailable";
    current = value.cause;
  }
  return "unknown";
}
