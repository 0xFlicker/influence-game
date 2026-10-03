/** House discovery policy; audience and evidence permissions are separate. */
export type GameVisibility = "public" | "unlisted";
export function parseGameVisibility(value: unknown): GameVisibility {
  if (value === undefined) return "public";
  if (value === "public" || value === "unlisted") return value;
  throw new Error("Game visibility must be public or unlisted");
}
