import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { readJson, storeJson } from "./payload-storage.js";
export class AgentDraftConflict extends Error {}
const drafts = schema.agentEditorDrafts;
// Include the row identity so deleting/recreating a scope cannot reuse an old CAS token.
const token = (row: { id: string; version: number }) =>
  `${row.id}:${row.version}`;
function parseToken(value: string) {
  const match = value.match(/^([a-f0-9-]{36}):([1-9][0-9]*)$/i);
  if (!match || !Number.isSafeInteger(Number(match[2])))
    throw new AgentDraftConflict(
      "Reload to recover the current draft version.",
    );
  return { id: match[1]!, version: Number(match[2]) };
}
export async function readAgentDraft(
  db: DrizzleDB,
  userId: string,
  scope: string,
) {
  const [row] = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.userId, userId), eq(drafts.scope, scope)));
  return row
    ? { version: token(row), document: await readJson(row.document) }
    : null;
}
export async function saveAgentDraft(
  db: DrizzleDB,
  userId: string,
  scope: string,
  version: string | null,
  document: Record<string, unknown>,
) {
  if (
    !scope.trim() ||
    scope.length > 250 ||
    document.version !== 4 ||
    !document.current ||
    typeof document.current !== "object"
  )
    throw new Error("Invalid agent draft");
  const current = document.current as Record<string, unknown>;
  const stored = await storeJson(document);
  return db.transaction(async (tx) => {
    if (version === null) {
      const [row] = await tx
        .insert(drafts)
        .values({
          id: randomUUID(),
          userId,
          scope,
          name:
            typeof current.name === "string" ? current.name.slice(0, 100) : "",
          document: stored,
        })
        .onConflictDoNothing()
        .returning();
      if (!row)
        throw new AgentDraftConflict(
          "This draft changed in another session. Reload to review it.",
        );
      return token(row);
    }
    const expected = parseToken(version);
    const [row] = await tx
      .update(drafts)
      .set({
        name:
          typeof current.name === "string" ? current.name.slice(0, 100) : "",
        document: stored,
        version: expected.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(drafts.id, expected.id),
          eq(drafts.userId, userId),
          eq(drafts.scope, scope),
          eq(drafts.version, expected.version),
        ),
      )
      .returning();
    if (!row)
      throw new AgentDraftConflict(
        "This draft changed in another session. Reload to review it.",
      );
    return token(row);
  });
}
export async function deleteAgentDraft(
  db: DrizzleDB,
  userId: string,
  scope: string,
  version: string | null,
) {
  const expected = version === null ? null : parseToken(version);
  const removed = expected
    ? await db
        .delete(drafts)
        .where(
          and(
            eq(drafts.id, expected.id),
            eq(drafts.userId, userId),
            eq(drafts.scope, scope),
            eq(drafts.version, expected.version),
          ),
        )
        .returning({ id: drafts.id })
    : [];
  if (!removed.length && (await readAgentDraft(db, userId, scope)))
    throw new AgentDraftConflict(
      "This draft changed in another session. Reload before discarding it.",
    );
}
