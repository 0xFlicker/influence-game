import { createHash } from "node:crypto";

export interface PublicGamesFilter {
  kind: "all" | "influence" | "werewolf";
  status: "all" | "waiting" | "in_progress" | "suspended" | "completed" | "cancelled" | "nonwaiting";
  collection: "all" | "public" | "season";
  season: string | null;
  category: "all" | "free" | "custom" | `season:${string}`;
  excludeSeason: string | null;
}
export interface PublicGamesPosition { rank: number; time: string | null; id: string }

function fingerprint(filter: PublicGamesFilter): string {
  return createHash("sha256").update(JSON.stringify([filter.kind,filter.status,filter.collection,filter.season,filter.category,filter.excludeSeason])).digest("base64url");
}

export function encodePublicGamesCursor(filter: PublicGamesFilter, position: PublicGamesPosition): string {
  if (!validPosition(position)) throw new Error("Invalid game cursor");
  return Buffer.from(JSON.stringify([1,fingerprint(filter),position])).toString("base64url");
}

export function decodePublicGamesCursor(filter: PublicGamesFilter, cursor: string): PublicGamesPosition | null {
  if (!cursor || cursor.length>8192 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  try {
    const bytes = Buffer.from(cursor,"base64url");
    if (bytes.toString("base64url")!==cursor) return null;
    const value: unknown = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    return Array.isArray(value) && value.length===3 && value[0]===1 && value[1]===fingerprint(filter) && validPosition(value[2]) ? value[2] : null;
  } catch { return null; }
}

function validPosition(value: unknown): value is PublicGamesPosition {
  if (!value || typeof value!=="object" || Array.isArray(value) || Object.keys(value).sort().join(",")!=="id,rank,time") return false;
  const row = value as Record<string,unknown>;
  if (!Number.isInteger(row.rank) || (row.rank as number)>0 || (row.rank as number)<-4) return false;
  if (typeof row.id!=="string" || !row.id || Buffer.byteLength(row.id)>4096 || row.id.includes("\0") || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(row.id)) return false;
  if (row.time===null) return true;
  if (typeof row.time!=="string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{6}Z$/.test(row.time) || row.time.startsWith("0000")) return false;
  const date = new Date(row.time);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,23)===row.time.slice(0,23);
}
