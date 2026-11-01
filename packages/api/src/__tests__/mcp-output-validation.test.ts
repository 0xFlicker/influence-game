import { expect, test } from "bun:test";
import { assertMcpOutputSchema, assertMcpToolResult } from "../game-mcp/output-validation.js";

const schema = {
  type: "object", additionalProperties: false, required: ["counts"],
  properties: { counts: { type: "object", additionalProperties: { $ref: "#/definitions/count" } } },
  definitions: { count: { type: "integer", minimum: 0, maximum: 10 } },
};

test("MCP output validation resolves nested references, typed maps, bounds and closed objects", () => {
  expect(() => assertMcpOutputSchema("counts", schema, { counts: { a: 1 } })).not.toThrow();
  for (const value of [{}, { counts: { a: "1" } }, { counts: { a: 1.5 } },
    { counts: { a: -1 } }, { counts: { a: 11 } }, { counts: {}, unexpected: true }]) {
    expect(() => assertMcpOutputSchema("counts", schema, value)).toThrow("Invalid counts output");
  }
});

test("typed successful tool results require structured output; challenges do not", () => {
  expect(() => assertMcpToolResult("counts", schema, { content: [] })).toThrow("missing structuredContent");
  expect(() => assertMcpToolResult("counts", schema, { content: [], isError: true })).not.toThrow();
  expect(() => assertMcpToolResult("counts", schema, { content: [], structuredContent: { counts: { a: 1 } } })).not.toThrow();
  expect(() => assertMcpToolResult("counts", schema, { isError: true, structuredContent: {} })).toThrow("Invalid counts output");
});

test("output contract diagnostics are bounded and exclude rejected values", () => {
  try {
    assertMcpOutputSchema("counts", schema, { counts: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [String(i), "PRIVATE_RESPONSE"])) });
    throw new Error("Expected schema rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("Invalid counts output");
    expect(message).not.toContain("PRIVATE_RESPONSE");
    expect(message.length).toBeLessThan(256);
  }
});
