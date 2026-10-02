import { expect, test } from "bun:test";
import { enabledGameKinds } from "../game-availability";
test("the deployment catalogue accepts only explicit game kinds",()=>{
  expect(enabledGameKinds("influence,werewolf")).toEqual(["influence","werewolf"]);
  expect(enabledGameKinds(" werewolf,werewolf ")).toEqual(["werewolf"]);
  expect(enabledGameKinds("influence")).toEqual(["influence"]);
  expect(enabledGameKinds("")).toEqual([]);
  expect(()=>enabledGameKinds("werewulf")).toThrow("NEXT_PUBLIC_ENABLED_GAMES");
});
