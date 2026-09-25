import { expect, test } from "bun:test";
import { CHARACTER_FIELDS, characterEditFields, decodeCharacterEditTool } from "./agent-creation-assistant";

test("visual tool selects only visual fields and empty fields are added deterministically", () => {
  const command = decodeCharacterEditTool("update_visuals", "{}");
  expect(command).toEqual({ tool: "update_visuals", fields: ["performanceInstructions", "visualDesign"] });
  const profile = Object.fromEntries(CHARACTER_FIELDS.map(field => [field, "Existing"]));
  expect(characterEditFields(profile, ["visualDesign"])).toEqual(["visualDesign"]);
  expect(characterEditFields({ ...profile, backstory: "", performanceInstructions: "  " }, ["visualDesign"])).toEqual(["backstory", "performanceInstructions", "visualDesign"]);
});
test("tool decoder rejects malformed, permissive, unknown and extra arguments", () => {
  for (const [tool, args] of [["update_visuals", '{"fields":["name"]}'], ["update_character", "{}"], ["update_character", '{"fields":[]}'], ["update_character", '{"fields":["unknown"]}'], ["update_character", '{"fields":["name","name"]}'], ["update_character", '{"fields":["name"],"extra":true}'], ["clarify", '{"message":""}'], ["publish", "{}"], ["update_visuals", "```json\n{}\n```"], ["update_visuals", "text {}"], ["update_visuals", "not json"]]) {
    expect(() => decodeCharacterEditTool(tool!, args!)).toThrow();
  }
});
