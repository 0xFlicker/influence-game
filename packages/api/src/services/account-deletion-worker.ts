import { PrivyClient } from "@privy-io/server-auth";
import { and, eq, isNull, sql } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";

type Task = typeof schema.accountDeletionTasks.$inferSelect;
export type AccountDeletionExecutor = (task: Task) => Promise<void>;

/** A row lock makes retries safe across workers; crashes roll back the claim. */
export async function processAccountDeletionTask(db: DrizzleDB, execute: AccountDeletionExecutor = eraseProviderAccount): Promise<boolean> {
  return db.transaction(async tx => {
    const [task] = await tx.select().from(schema.accountDeletionTasks)
      .where(and(isNull(schema.accountDeletionTasks.completedAt), sql`next_attempt_at <= now()`))
      .orderBy(schema.accountDeletionTasks.nextAttemptAt).limit(1).for("update", { skipLocked: true });
    if (!task) return false;
    try {
      await execute(task);
      await tx.update(schema.accountDeletionTasks).set({ target: null, completedAt: new Date(), lastError: null, attempts: task.attempts + 1 })
        .where(eq(schema.accountDeletionTasks.id, task.id));
    } catch {
      // Provider errors can contain the deleted identity or credentials.
      await tx.update(schema.accountDeletionTasks).set({ attempts: task.attempts + 1, lastError: "provider_cleanup_failed",
        nextAttemptAt: new Date(Date.now() + Math.min(3600, 30 * 2 ** Math.min(task.attempts, 7)) * 1000) })
        .where(eq(schema.accountDeletionTasks.id, task.id));
      console.warn(`[account-deletion] ${task.provider} cleanup deferred`);
    }
    return true;
  });
}

async function eraseProviderAccount(task: Task): Promise<void> {
  if (!task.target) throw new Error("Missing erasure target");
  try {
    if (task.provider === "clerk") {
      if (!process.env.CLERK_SECRET_KEY) throw new Error("Clerk cleanup is not configured");
      // The installed backend SDK does not expose a request AbortSignal.
      const response = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(task.target)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}` },
        signal: AbortSignal.timeout(10_000), redirect: "error",
      });
      if (!response.ok && response.status !== 404) throw new Error("Clerk deletion failed");
    } else if (task.provider === "privy") {
      if (!process.env.PRIVY_APP_ID || !process.env.PRIVY_APP_SECRET) throw new Error("Privy cleanup is not configured");
      await new PrivyClient(process.env.PRIVY_APP_ID, process.env.PRIVY_APP_SECRET).deleteUser(task.target);
    } else {
      await erasePosthogPerson(task.target);
    }
  } catch (error) {
    // A completed DELETE whose response was lost is still complete on retry.
    if (task.provider !== "posthog" && error && typeof error === "object" && "status" in error && error.status === 404) return;
    throw error;
  }
}

async function erasePosthogPerson(publicId: string) {
  const key = process.env.POSTHOG_PERSONAL_API_KEY;
  const project = process.env.POSTHOG_PROJECT_ID;
  if (!key || !project) throw new Error("PostHog cleanup is not configured");
  const origin = process.env.POSTHOG_API_HOST ?? "https://us.posthog.com";
  const base = new URL(`/api/projects/${encodeURIComponent(project)}/persons/`, origin);
  const lookup = new URL(base);
  lookup.searchParams.set("distinct_id", publicId);
  const headers = { Authorization: `Bearer ${key}` };
  const response = await fetch(lookup, { headers, signal: AbortSignal.timeout(10_000), redirect: "error" });
  if (!response.ok) throw new Error("PostHog lookup failed");
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("results" in body) || !Array.isArray(body.results)) throw new Error("Invalid PostHog response");
  for (const person of body.results) {
    if (!person || typeof person !== "object" || typeof person.id !== "string" || !Array.isArray(person.distinct_ids) || !person.distinct_ids.includes(publicId)) {
      throw new Error("PostHog returned an unrelated person");
    }
    const url = new URL(`${encodeURIComponent(person.id)}/`, base);
    url.searchParams.set("delete_events", "true");
    url.searchParams.set("delete_recordings", "true");
    const deleted = await fetch(url, { method: "DELETE", headers, signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!deleted.ok && deleted.status !== 404) throw new Error("PostHog deletion failed");
  }
  if ("next" in body && body.next) throw new Error("Unexpected additional PostHog identities; retry cleanup");
}
