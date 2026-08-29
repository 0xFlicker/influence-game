import Ajv, {
  type ErrorObject,
  type ValidateFunction,
} from "ajv";

export type StructuredDomainDecodeResult<TValue> =
  | { status: "valid"; value: TValue }
  | { status: "invalid"; message: string };

export interface ExactStructuredOutputArtifactInput<TProviderPayload, TValue> {
  /** Stable semantic action identity, independent of provider transport. */
  action: string;
  /** Provider-visible schema/tool name. */
  name: string;
  /** Exact provider-payload JSON Schema. */
  schema: Record<string, unknown>;
  /** Context-aware live payload decoder, called only after schema validation. */
  decodeProviderPayload(
    payload: TProviderPayload,
  ): StructuredDomainDecodeResult<TValue>;
  /** Decoder for the already-decoded domain value persisted by the journal. */
  decodeAcceptedValue(value: unknown): StructuredDomainDecodeResult<TValue>;
  /**
   * The accepted value has the same structural representation as the provider
   * payload. When true, replay applies the provider schema before the accepted
   * value decoder. Domain-mapped values leave this false and validate through
   * their dedicated decoder instead.
   */
  acceptedValueUsesProviderSchema?: boolean;
}

const EXACT_STRUCTURED_OUTPUT_ARTIFACT = Symbol("exact-structured-output-artifact");

export interface ExactStructuredOutputArtifact<TValue> {
  readonly [EXACT_STRUCTURED_OUTPUT_ARTIFACT]: true;
  readonly action: string;
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly decodeProviderPayload: (
    payload: unknown,
  ) => StructuredDomainDecodeResult<TValue>;
  readonly decodeAcceptedValue: (
    value: unknown,
  ) => StructuredDomainDecodeResult<TValue>;
  readonly acceptedValueUsesProviderSchema: boolean;
}

export interface StructuredOutputValidationIssue {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message: string | null;
  params: Readonly<Record<string, unknown>>;
}

export type ExactStructuredOutputResult<TValue> =
  | { status: "valid"; value: TValue }
  | {
      status: "invalid";
      kind: "undecodable_document" | "schema_mismatch" | "semantic_mismatch";
      message: string;
      issues: readonly StructuredOutputValidationIssue[];
    };

const ajv = new Ajv({
  strict: true,
  strictSchema: true,
  allErrors: true,
  coerceTypes: false,
  useDefaults: false,
  removeAdditional: false,
  validateFormats: true,
});

const compiledValidators = new WeakMap<object, ValidateFunction>();
const compiledShapeValidators = new WeakMap<object, ValidateFunction>();

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Array.isArray(value)
      ? value
      : Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function requireIdentity(label: "action" | "name", value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Exact structured output ${label} must be non-empty.`);
  return normalized;
}

/**
 * Creates one immutable schema/decoder artifact and compiles its schema once.
 * Ajv strict-mode compilation errors are programming defects and propagate.
 */
export function createExactStructuredOutputArtifact<TProviderPayload, TValue>(
  input: ExactStructuredOutputArtifactInput<TProviderPayload, TValue>,
): ExactStructuredOutputArtifact<TValue> {
  const schema = deepFreeze(structuredClone(input.schema));
  const artifact: ExactStructuredOutputArtifact<TValue> = Object.freeze({
    [EXACT_STRUCTURED_OUTPUT_ARTIFACT]: true as const,
    action: requireIdentity("action", input.action),
    name: requireIdentity("name", input.name),
    schema,
    decodeProviderPayload: (payload: unknown) => input.decodeProviderPayload(payload as TProviderPayload),
    decodeAcceptedValue: input.decodeAcceptedValue,
    acceptedValueUsesProviderSchema: input.acceptedValueUsesProviderSchema ?? false,
  });
  compiledValidators.set(artifact, ajv.compile(schema));
  return artifact;
}

function copyIssues(errors: readonly ErrorObject[] | null | undefined): readonly StructuredOutputValidationIssue[] {
  return deepFreeze((errors ?? []).map((error) => ({
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message ?? null,
    params: structuredClone(error.params) as Record<string, unknown>,
  })));
}

/**
 * Validate an already-decoded domain representation against its own exact
 * schema. This is deliberately separate from an artifact's provider schema:
 * accepted journal values use the schema for the domain shape they persist.
 */
export function validateExactStructuredValue(
  schema: Readonly<Record<string, unknown>>,
  value: unknown,
  label: string,
): StructuredDomainDecodeResult<unknown> {
  let validate = compiledShapeValidators.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    compiledShapeValidators.set(schema, validate);
  }
  if (validate(value)) return { status: "valid", value };
  const issues = copyIssues(validate.errors);
  return {
    status: "invalid",
    message: issues.length > 0
      ? `${label} failed exact shape validation (${issues.length} issue${issues.length === 1 ? "" : "s"}: ${issues
          .slice(0, 3)
          .map((issue) => `${issue.instancePath || "/"} ${issue.keyword}`)
          .join(", ")}).`
      : `${label} failed exact shape validation.`,
  };
}

function semanticResult<TValue>(
  result: StructuredDomainDecodeResult<TValue>,
): ExactStructuredOutputResult<TValue> {
  if (result.status === "valid") return result;
  const message = result.message.trim();
  if (!message) throw new Error("Structured semantic decoder returned an empty failure message.");
  return {
    status: "invalid",
    kind: "semantic_mismatch",
    message,
    issues: [],
  };
}

export class ExactStructuredOutputRegistry {
  private readonly seenArtifacts = new WeakSet<object>();
  private observedCount = 0;

  get observedArtifactCount(): number {
    return this.observedCount;
  }

  private validator<TValue>(
    artifact: ExactStructuredOutputArtifact<TValue>,
  ): ValidateFunction {
    const validator = compiledValidators.get(artifact);
    if (!validator) {
      throw new Error("Structured output artifact was not created by createExactStructuredOutputArtifact().");
    }
    if (!this.seenArtifacts.has(artifact)) {
      this.seenArtifacts.add(artifact);
      this.observedCount += 1;
    }
    return validator;
  }

  decodeJsonDocument<TValue>(
    artifact: ExactStructuredOutputArtifact<TValue>,
    document: string,
  ): ExactStructuredOutputResult<TValue> {
    let payload: unknown;
    try {
      payload = JSON.parse(document);
    } catch {
      return {
        status: "invalid",
        kind: "undecodable_document",
        message: "Structured output was not one complete JSON document.",
        issues: [],
      };
    }
    return this.decodeProviderPayload(artifact, payload);
  }

  decodeProviderPayload<TValue>(
    artifact: ExactStructuredOutputArtifact<TValue>,
    payload: unknown,
  ): ExactStructuredOutputResult<TValue> {
    return this.decodeSemantic(artifact, payload, "provider");
  }

  decodeAcceptedValue<TValue>(
    artifact: ExactStructuredOutputArtifact<TValue>,
    value: unknown,
  ): ExactStructuredOutputResult<TValue> {
    return this.decodeSemantic(artifact, value, "accepted");
  }

  private decodeSemantic<TValue>(
    artifact: ExactStructuredOutputArtifact<TValue>,
    value: unknown,
    representation: "provider" | "accepted",
  ): ExactStructuredOutputResult<TValue> {
    if (
      representation === "provider"
      || artifact.acceptedValueUsesProviderSchema
    ) {
      const schemaResult = this.validateProviderSchema(artifact, value);
      if (schemaResult) return schemaResult;
    }
    const decode = representation === "provider"
      ? artifact.decodeProviderPayload
      : artifact.decodeAcceptedValue;
    return semanticResult(decode(value));
  }

  private validateProviderSchema<TValue>(
    artifact: ExactStructuredOutputArtifact<TValue>,
    payload: unknown,
  ): Extract<ExactStructuredOutputResult<TValue>, { status: "invalid" }> | undefined {
    const validate = this.validator(artifact);
    if (validate(payload)) return undefined;
    const issues = copyIssues(validate.errors);
    return {
      status: "invalid",
      kind: "schema_mismatch",
      message: issues.length > 0
        ? `Structured output failed exact schema validation (${issues.length} issue${issues.length === 1 ? "" : "s"}: ${issues
            .slice(0, 3)
            .map((issue) => `${issue.instancePath || "/"} ${issue.keyword}`)
            .join(", ")}).`
        : "Structured output failed exact schema validation.",
      issues,
    };
  }
}

export const exactStructuredOutputRegistry = new ExactStructuredOutputRegistry();
