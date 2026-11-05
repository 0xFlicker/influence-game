/** Keep actionable PostgreSQL diagnostics without SQL, parameters or private bodies. */
export function evidenceDatabaseError(error: unknown): { code?: string; constraint?: string } {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 8 && current && typeof current === "object" && !seen.has(current); depth++) {
    seen.add(current);
    const value = current as Record<string, unknown>;
    if (typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code)) {
      const constraint = value.constraint ?? value.constraint_name;
      return { code: value.code, ...(typeof constraint === "string" && /^[a-zA-Z0-9_]{1,128}$/.test(constraint) && { constraint }) };
    }
    current = value.cause;
  }
  return {};
}

export function safeEvidenceError(error: unknown): string {
  const { code, constraint } = evidenceDatabaseError(error);
  if (code) return `PostgreSQL ${code}${constraint ? ` (${constraint})` : ""}`;
  // These are local invariant failures, never provider/driver messages.
  const message = error instanceof Error ? error.message : "";
  if (/^(durable owner not found|owner (expired|is (active|closed|expired|failed))|evidence manifest event boundary not found|Evidence manifest id (conflict could not be resolved|has conflicting immutable identity))$/.test(message)) return message;
  return "Evidence manifest persistence failed";
}

/** Replay only transactions PostgreSQL guarantees were aborted. Never retry an uncertain commit. */
export async function retryEvidenceTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); } catch (error) {
      if (attempt >= 2 || !["40001", "40P01"].includes(evidenceDatabaseError(error).code ?? "")) throw error;
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
  }
}
