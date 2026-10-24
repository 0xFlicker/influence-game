import { expect, test } from "bun:test";
import { parseArgs, buildGameCreateBody } from "../api-simulate";
import { parseWerewolfApiArgs } from "../werewolf/api-simulate";
import { parseMixedModelArgs } from "../mixed-model-simulate";

test("API simulations require an explicit flag to be unlisted", () => {
  const oldEnvironment = {INFLUENCE_API_SIM_VISIBILITY: "unlisted"};
  expect(parseArgs([], oldEnvironment).visibility).toBe("public");
  expect(parseWerewolfApiArgs([], oldEnvironment).visibility).toBe("public");
  expect(parseMixedModelArgs([]).visibility).toBe("public");
  for (const visibility of ["public", "unlisted"] as const) {
    const argv = ["--visibility", visibility];
    const influence = parseArgs(argv, oldEnvironment);
    expect(buildGameCreateBody(influence, "openai:gpt-6-luna").visibility).toBe(visibility);
    expect(parseWerewolfApiArgs(argv, oldEnvironment).visibility).toBe(visibility);
    expect(parseMixedModelArgs(argv).visibility).toBe(visibility);
  }
  for (const parse of [parseArgs, parseWerewolfApiArgs, parseMixedModelArgs]) {
    expect(() => parse(["--visibility", "private"])).toThrow();
  }
});
