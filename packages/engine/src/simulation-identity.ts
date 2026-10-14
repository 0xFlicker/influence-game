/** Explicit adapter identity for fresh local simulation sessions. */
export function simulationIdentity(gameKind: "influence" | "werewolf") {
  return {schema:"house.simulation-session",version:1,gameKind} as const;
}
export function decodeSimulationIdentity(value: unknown): "influence" | "werewolf" {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid simulation identity");
  const row = value as Record<string,unknown>;
  if (Object.keys(row).sort().join() !== "gameKind,schema,version" || row.schema !== "house.simulation-session"
    || row.version !== 1 || row.gameKind !== "influence" && row.gameKind !== "werewolf") throw new Error("Invalid simulation identity");
  return row.gameKind;
}
