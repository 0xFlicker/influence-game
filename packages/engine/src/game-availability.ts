export type HouseGameKind = "influence" | "werewolf";
/** Set the same public build/runtime value in web and API. Existing game URLs remain usable. */
export function enabledGameKinds(value = process.env.NEXT_PUBLIC_ENABLED_GAMES): HouseGameKind[] {
  const names = (value ?? "influence,werewolf").split(",").map(name => name.trim()).filter(Boolean);
  if (names.some(name => name !== "influence" && name !== "werewolf")) throw new Error("NEXT_PUBLIC_ENABLED_GAMES must contain only influence and/or werewolf");
  return [...new Set(names)] as HouseGameKind[];
}
