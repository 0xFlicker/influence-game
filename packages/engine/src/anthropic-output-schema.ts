import Ajv from "ajv";
import { parseStructuredDocument } from "./structured-output";

type Schema = Record<string, unknown>;
interface Codec { schema: Schema; decode(value: unknown): unknown }
const record = (value: unknown): Schema => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a schema object");
  return value as Schema;
};

/** Lossless wire encoding, never a schema simplifier. Unsupported contracts fail closed.
 * Bounded arrays use required numbered properties, since Anthropic rejects maxItems.
 * Native wire validation precedes decoding; the original schema is validated again.
 */
export function compileAnthropicOutputSchema(original: Schema) {
  // Validators live with this invocation; a global Ajv cache would retain every
  // dynamically generated legal-target schema for the lifetime of the worker.
  const ajv = new Ajv({ strict: false, allErrors: true, allowUnionTypes: true });
  const codec = compile(original, ajv);
  const wireValid = ajv.compile(codec.schema);
  const originalValid = ajv.compile(original);
  return { schema: codec.schema, decode(document: string): string {
    const wire = parseStructuredDocument(document);
    if (!wireValid(wire)) throw new Error("Anthropic response violates its exact wire schema");
    const value = codec.decode(wire);
    if (!originalValid(value)) throw new Error("Anthropic response violates its original decision schema");
    return JSON.stringify(value);
  } };
}

function compile(input: Schema, ajv: Ajv): Codec {
  const schema = structuredClone(input);
  const identity = (value: unknown) => value;
  for (const unsupported of ["$ref", "$defs", "definitions", "oneOf", "not", "if", "contains", "uniqueItems", "multipleOf", "exclusiveMinimum", "exclusiveMaximum"]) {
    if (schema[unsupported] !== undefined && schema[unsupported] !== false) throw new Error(`Anthropic exact schema does not support ${unsupported}`);
  }
  // Preserve native nullable primitives instead of multiplying anyOf branches.
  // JSON Schema string/numeric constraints do not apply to the null alternative.
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const nullable = types.includes("null");
  const nonNullTypes = types.filter(type => type !== "null");
  if (nonNullTypes.length > 1 || nullable && nonNullTypes.some(type => type === "object" || type === "array")) throw new Error("Unsupported native type union");
  const type = nonNullTypes[0] ?? "null";
  if (nullable && Array.isArray(schema.enum)) {
    const valid = ajv.compile(input);
    const allowed = schema.enum.filter(value => valid(value));
    const values = new Map(allowed.map(value => [value === null ? "" : String(value), value]));
    if (!values.size || values.size !== allowed.length) throw new Error("Ambiguous or unsatisfiable nullable enum encoding");
    return { schema: { type: "string", enum: [...values.keys()],
      description: `${schema.description ?? "Choose an exact allowed value"}. An empty string encodes null; numeric choices are encoded as decimal strings.` },
      decode: value => values.get(value as string) };
  }
  if (nullable && type === "string" && schema.minLength === 1 && schema.pattern === undefined) {
    // This is a bijection: the domain excludes empty text, so the empty wire
    // string can represent null without a union or any loss of valid content.
    const child = compile({ ...schema, type: "string", minLength: 0,
      description: `${schema.description ?? "Optional text"}. Use an empty string to encode null.` }, ajv);
    return { schema: child.schema, decode: value => value === "" ? null : child.decode(value) };
  }
  if (Array.isArray(schema.anyOf)) {
    const branches = schema.anyOf.map(value => compile(record(value), ajv));
    const validators = branches.map(branch => ajv.compile(branch.schema));
    schema.anyOf = branches.map(branch => branch.schema);
    return { schema, decode: value => {
      const candidates = branches.flatMap((branch, i) => validators[i]!(value) ? [branch.decode(value)] : []);
      if (!candidates.length || candidates.some(v => JSON.stringify(v) !== JSON.stringify(candidates[0]))) throw new Error("Ambiguous native schema union");
      return candidates[0];
    } };
  }
  if (schema.allOf !== undefined) throw new Error("Anthropic exact schema does not support transformed allOf");
  if (type === "null") {
    delete schema.minLength; delete schema.maxLength; delete schema.minimum; delete schema.maximum;
    return { schema, decode: identity };
  }
  if (type === "object") {
    if (schema.additionalProperties !== false) throw new Error("Anthropic requires closed objects");
    const properties = Object.entries(record(schema.properties ?? {})).map(([key, child]) => [key, compile(record(child), ajv)] as const);
    schema.properties = Object.fromEntries(properties.map(([key, child]) => [key, child.schema]));
    return { schema, decode: value => {
      const object = record(value);
      return Object.fromEntries(properties.filter(([key]) => Object.hasOwn(object, key)).map(([key, child]) => [key, child.decode(object[key])]));
    } };
  }
  if (type === "string" && (schema.minLength !== undefined || schema.maxLength !== undefined)) {
    const min = schema.minLength ?? 0, max = schema.maxLength ?? "";
    // Avoid Unicode-category complement expansion (\s|\S), which makes even
    // five-field native schemas exceed Anthropic's grammar complexity limit.
    const character = "(.|[\\n\\r\\u2028\\u2029])";
    const pattern = max === "" && min === 1 ? character
      : max === "" && min === 0 ? undefined
      : `^${character}{${min},${max}}$`;
    if (pattern !== undefined && schema.pattern !== undefined) {
      schema.allOf = [{ pattern: schema.pattern }, { pattern }];
      delete schema.pattern;
    } else if (pattern !== undefined) schema.pattern = pattern;
    delete schema.minLength; delete schema.maxLength;
  }
  if ((type === "integer" || type === "number") && (schema.minimum !== undefined || schema.maximum !== undefined)) {
    const min = schema.minimum, max = schema.maximum;
    if (type === "integer" && typeof min === "number" && typeof max === "number" && Number.isSafeInteger(min) && Number.isSafeInteger(max) && max >= min && max - min <= 1000) {
      const range = Array.from({ length: max - min + 1 }, (_, i) => min + i);
      schema.enum = Array.isArray(schema.enum) ? range.filter(n => (schema.enum as unknown[]).includes(n)) : range;
      if (nullable && (!Array.isArray(input.enum) || input.enum.includes(null))) (schema.enum as unknown[]).push(null);
      delete schema.minimum; delete schema.maximum;
    } else if (type === "number" && min === 0 && max === 1 && schema.enum === undefined) {
      delete schema.minimum; delete schema.maximum;
      return { schema: { ...schema, type: nullable ? ["string", "null"] : "string", pattern: "^(?:0(?:\\.[0-9]+)?|1(?:\\.0+)?)$",
        description: `${schema.description ?? "Coordinate"}. Encode the number from 0 to 1 as a decimal string.` }, decode: value => value === null ? null : Number(value) };
    } else throw new Error("Anthropic requires an explicit exact encoding for this numeric range");
  }
  if (type === "array") {
    const child = compile(record(schema.items), ajv);
    const min = typeof schema.minItems === "number" ? schema.minItems : 0;
    const max = schema.maxItems;
    if (typeof max === "number") {
      if (schema.enum !== undefined || schema.const !== undefined) throw new Error("Anthropic bounded array encoding does not support whole-array enum or const");
      if (!Number.isSafeInteger(max) || max < min || max > 32) throw new Error("Anthropic bounded array encoding supports at most 32 items");
      const variants = Array.from({ length: max - min + 1 }, (_, offset) => {
        const keys = Array.from({ length: min + offset }, (_, i) => `item_${i + 1}`);
        return { type: "object", properties: Object.fromEntries(keys.map(key => [key, child.schema])), required: keys, additionalProperties: false };
      });
      return { schema: { description: `${schema.description ?? "Ordered collection"}. Encode items as numbered properties item_1, item_2, etc.; use an empty object for zero items.`,
        anyOf: variants }, decode: value => {
        const object = record(value);
        return Array.from({ length: Object.keys(object).length }, (_, i) => child.decode(object[`item_${i + 1}`]));
      } };
    }
    if (min > 1) throw new Error("Anthropic unbounded arrays support minItems of zero or one");
    schema.items = child.schema;
    return { schema, decode: value => {
      if (!Array.isArray(value)) throw new Error("Expected native array");
      return value.map(child.decode);
    } };
  }
  // An enum already fixes value types. Anthropic rejects a heterogeneous enum
  // paired with type:["string","null"], despite accepting each independently.
  if (Array.isArray(schema.enum) && Array.isArray(schema.type)) delete schema.type;
  return { schema, decode: identity };
}
