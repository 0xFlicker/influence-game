export function isPostgresUniqueViolation(
  error: unknown,
  constraint: string,
): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const candidate = current as {
      code?: unknown;
      constraint_name?: unknown;
      constraint?: unknown;
      cause?: unknown;
    };
    if (candidate.code === "23505"
      && (candidate.constraint_name === constraint || candidate.constraint === constraint)) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
