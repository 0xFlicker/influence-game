import { schema, type DrizzleDB } from "../db/index.js";
type Writer = Pick<DrizzleDB, "insert">;
export function parseAgentEntryIntent(
  input: unknown,
): typeof schema.agentEntryIntents.$inferInsert.intent {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("A specific game or season is required");
  const value = input as Record<string, unknown>;
  if (
    value.flow === "join_game" &&
    typeof value.gameId === "string" &&
    value.gameId.length > 0 &&
    value.gameId.length < 200 &&
    Object.keys(value).every((key) => ["flow", "gameId"].includes(key))
  )
    return { flow: "join_game", gameId: value.gameId };
  if (
    value.flow === "daily_free" &&
    typeof value.seasonId === "string" &&
    value.seasonId.length > 0 &&
    value.seasonId.length < 200 &&
    Object.keys(value).every((key) =>
      ["flow", "seasonId", "season"].includes(key),
    ) &&
    (value.season === undefined ||
      (typeof value.season === "string" && value.season.length < 200))
  )
    return {
      flow: "daily_free",
      seasonId: value.seasonId,
      ...(typeof value.season === "string" ? { season: value.season } : {}),
    };
  throw new Error("A specific game or season is required");
}
export async function saveAgentEntryIntent(
  db: Writer,
  userId: string,
  agentId: string,
  input: unknown,
) {
  const intent = parseAgentEntryIntent(input);
  await db
    .insert(schema.agentEntryIntents)
    .values({ userId, agentId, intent })
    .onConflictDoUpdate({
      target: schema.agentEntryIntents.agentId,
      set: { intent },
    });
}
