import { describe, expect, test } from "bun:test";
import { CREATION_COMMANDS, decodeCreationCommand, isCreationStage, type CreationStage } from "../agent-creation-assistant";

describe("bounded character assistant", () => {
  for (const stage of Object.keys(CREATION_COMMANDS) as CreationStage[]) {
    test(`${stage} accepts only its current commands`, () => {
      for (const command of CREATION_COMMANDS[stage]) expect(decodeCreationCommand(JSON.stringify({ command }), stage)).toBe(command);
      for (const command of new Set(Object.values(CREATION_COMMANDS).flat())) {
        if (!(CREATION_COMMANDS[stage] as readonly string[]).includes(command)) expect(() => decodeCreationCommand(JSON.stringify({ command }), stage)).toThrow();
      }
    });
    for (const malformed of ["Hello", "{}", "null", "[]", '{"message":"hello"}', '{"command":"clarify","message":"hello"}', '```json\n{"command":"clarify"}\n```', 'Here: {"command":"clarify"}', '{"command":"create_agent"}']) {
      test(`${stage} rejects ${malformed}`, () => expect(() => decodeCreationCommand(malformed, stage)).toThrow());
    }
  }
  test("rejects prototype names as stages", () => {
    expect(isCreationStage("constructor")).toBe(false);
    expect(isCreationStage("__proto__")).toBe(false);
    expect(isCreationStage("review")).toBe(true);
  });
});
