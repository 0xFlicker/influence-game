import { HouseInspectionError } from "./house-game-access.js";
export interface HouseCursor {
  version: 1;
  gameId: string;
  gameKind: "influence" | "werewolf";
  audience: "public" | "mystery" | "omniscient";
  lane: "history" | "thinking";
  after: number[];
  through: number[];
  poll: boolean;
  cutoff: number[];
  actorId: string | null;
}
function invalid(): never {
  throw new HouseInspectionError(
    "invalid_cursor",
    "Invalid or mismatched cursor; restart this traversal",
  );
}
export function encodeHouseCursor(cursor: HouseCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
export function decodeHouseCursor(
  token: string,
  binding: Pick<
    HouseCursor,
    "gameId" | "gameKind" | "audience" | "lane" | "actorId"
  >,
): HouseCursor {
  if (token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token)) return invalid();
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    return invalid();
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalid();
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).sort().join() !==
      [
        "version",
        "gameId",
        "gameKind",
        "audience",
        "lane",
        "after",
        "through",
        "poll",
        "cutoff",
        "actorId",
      ]
        .sort()
        .join() ||
    v.version !== 1 ||
    typeof v.poll !== "boolean"
  )
    return invalid();
  for (const key of [
    "gameId",
    "gameKind",
    "audience",
    "lane",
    "actorId",
  ] as const)
    if (v[key] !== binding[key]) return invalid();
  for (const key of ["after", "through", "cutoff"] as const)
    if (
      !Array.isArray(v[key]) ||
      v[key].length > 2 ||
      v[key].some((n) => !Number.isSafeInteger(n) || n < 0)
    )
      return invalid();
  const c = v as unknown as HouseCursor;
  if (
    !c.after.length ||
    c.after.length !== c.through.length ||
    c.after.some((n, i) => n > c.through[i]!) ||
    (c.poll && c.after.some((n, i) => n !== c.through[i]))
  )
    return invalid();
  return c;
}
export function assertHouseCursorHead(cursor: HouseCursor, head: number[]) {
  if (
    cursor.through.length !== head.length ||
    cursor.through.some((n, i) => n > head[i]!)
  )
    invalid();
}
export const HOUSE_PAGE_BYTES = 64 * 1024;
export function houseJsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
