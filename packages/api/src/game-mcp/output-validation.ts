import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map<string, { schema: string; validate: ValidateFunction }>();

/** Report contract coordinates, never response values or the entire union error tree. */
export function outputContractError(tool: string, errors: readonly ErrorObject[] | null | undefined): Error {
  const details = [...(errors ?? [])]
    .filter(error => error.keyword !== "anyOf" && error.keyword !== "oneOf")
    .sort((left, right) => right.instancePath.length - left.instancePath.length)
    .map(error => `${(error.instancePath || "/").slice(0, 160)}: ${error.keyword}`);
  return new Error(`Invalid ${tool} output (${[...new Set(details)].slice(0, 3).join("; ") || "schema mismatch"}).`);
}

/** Validate the exact advertised schema, including nested references and typed maps. */
export function assertMcpOutputSchema(tool: string, schema: object, value: unknown): void {
  const encoded = JSON.stringify(schema);
  let cached = validators.get(tool);
  if (!cached || cached.schema !== encoded) {
    cached = { schema: encoded, validate: ajv.compile(schema) };
    validators.set(tool, cached);
  }
  if (!cached.validate(value)) throw outputContractError(tool, cached.validate.errors);
}

/** Error/challenge envelopes may omit structuredContent; successful typed tools may not. */
export function assertMcpToolResult(tool: string, schema: object, result: unknown): void {
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error(`Invalid ${tool} output (missing tool result).`);
  if (!("structuredContent" in result)) {
    if ("isError" in result && result.isError === true) return;
    throw new Error(`Invalid ${tool} output (missing structuredContent).`);
  }
  assertMcpOutputSchema(tool, schema, result.structuredContent);
}
