import { randomUUID } from "node:crypto";
import { schema, type DrizzleDB } from "../db/index.js";
import { SCREENING_POLICY_VERSION } from "./agent-screening-policy.js";

type Writer = Pick<DrizzleDB, "insert">;
/** The outbox is committed with the content revision; no provider work on save. */
export async function enqueueAgentScreening(db: Writer, contentRevisionId: string) {
  await db.insert(schema.agentScreenings).values({ id: randomUUID(), contentRevisionId, policyVersion: SCREENING_POLICY_VERSION }).onConflictDoNothing();
}
