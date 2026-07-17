export function isPostgresUniqueViolation(
  error: unknown,
  constraint: string,
): boolean {
  return isPostgresConstraintViolation(error, {
    code: "23505",
    constraint,
  });
}

export function isPostgresCheckViolation(
  error: unknown,
  constraint: string,
): boolean {
  return isPostgresConstraintViolation(error, {
    code: "23514",
    constraint,
  });
}

export function getPostgresConstraintName(error: unknown): string | null {
  for (const candidate of postgresErrorChain(error)) {
    if (typeof candidate.constraint_name === "string") {
      return candidate.constraint_name;
    }
    if (typeof candidate.constraint === "string") {
      return candidate.constraint;
    }
  }
  return null;
}

export function isPostgresConstraintViolation(
  error: unknown,
  expected: {
    code: string;
    constraint: string;
  },
): boolean {
  return postgresErrorChain(error).some((candidate) => (
    candidate.code === expected.code
    && (candidate.constraint_name === expected.constraint
      || candidate.constraint === expected.constraint)
  ));
}

function postgresErrorChain(error: unknown): PostgresErrorCandidate[] {
  const chain: PostgresErrorCandidate[] = [];
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const candidate = current as PostgresErrorCandidate;
    chain.push(candidate);
    current = candidate.cause;
  }
  return chain;
}

interface PostgresErrorCandidate {
  code?: unknown;
  constraint_name?: unknown;
  constraint?: unknown;
  cause?: unknown;
}
