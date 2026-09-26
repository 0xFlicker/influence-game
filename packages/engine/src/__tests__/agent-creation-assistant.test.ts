import { describe, expect, test } from "bun:test";
import { CREATION_COMMANDS, decodeCreationTurn, isCreationStage, type CreationStage } from "../agent-creation-assistant";

describe("bounded character assistant", () => {
  for (const stage of Object.keys(CREATION_COMMANDS) as CreationStage[]) {
    test(`${stage} accepts only its current commands`, () => {
      for (const command of CREATION_COMMANDS[stage]) {
        const reply = command === "clarify" ? "The format changes each round. Which kind of adaptable player appeals to you?" : "";
        expect(decodeCreationTurn(JSON.stringify({ command, reply }), stage)).toEqual({ command, reply });
      }
      for (const command of new Set(Object.values(CREATION_COMMANDS).flat())) {
        if (!(CREATION_COMMANDS[stage] as readonly string[]).includes(command)) expect(() => decodeCreationTurn(JSON.stringify({ command, reply: "" }), stage)).toThrow();
      }
    });
    for (const malformed of ["Hello", "{}", "null", "[]", '{"message":"hello"}', '{"command":"clarify"}', '{"command":"clarify","reply":""}', '{"command":"clarify","reply":"   "}', '{"command":"clarify","reply":"hello","extra":true}', '```json\n{"command":"clarify","reply":"hello"}\n```', 'Here: {"command":"clarify","reply":"hello"}', '{"command":"create_agent","reply":""}', '{"command":"end_abuse","reply":"hello"}']) {
      test(`${stage} rejects ${malformed}`, () => expect(() => decodeCreationTurn(malformed, stage)).toThrow());
    }
  }
  test("rejects an overlong clarification", () => {
    expect(() => decodeCreationTurn(JSON.stringify({ command: "clarify", reply: "a".repeat(651) }), "character")).toThrow();
  });
  test("rejects prototype names as stages", () => {
    expect(isCreationStage("constructor")).toBe(false);
    expect(isCreationStage("__proto__")).toBe(false);
    expect(isCreationStage("review")).toBe(true);
  });
});
