import { expect, test } from "bun:test";
import { parseGameVisibility } from "../game-visibility";
import { parseWerewolfApiArgs } from "../werewolf/api-simulate";
test("House visibility accepts only Public and Unlisted", () => {
  expect(parseGameVisibility(undefined)).toBe("public");
  for (const value of ["public","unlisted"] as const) expect(parseGameVisibility(value)).toBe(value);
  for (const value of [null,"private",false,{},["public"],""]) expect(()=>parseGameVisibility(value)).toThrow("visibility");
  expect(parseWerewolfApiArgs(["--visibility","unlisted"],{}).visibility).toBe("unlisted");
  expect(()=>parseWerewolfApiArgs(["--visibility","private"],{})).toThrow("visibility");
});
