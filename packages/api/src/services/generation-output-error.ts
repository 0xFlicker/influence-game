/** Only wrap output validation, so storage and application failures stay separate. */
export class GenerationOutputError extends Error {
  constructor(cause: unknown) {
    super("Unusable generation output", { cause });
  }
}

export function decodeGenerationOutput<T>(decode: () => T): T {
  try { return decode(); }
  catch (error) { throw new GenerationOutputError(error); }
}
