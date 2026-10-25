import { BatchClient, SubmitJobCommand } from "@aws-sdk/client-batch";
import { and, asc, eq, inArray } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { cutoutMode, expireCutoutLeases, prepareCutoutDemands, reserveCutout } from "./character-cutouts.js";

/** One bounded, best-effort loop; database reservations fence multiple API instances. */
export function startCharacterCutoutDispatcher(db: DrizzleDB, canClaimWork: () => boolean) {
  const mode = cutoutMode();
  if (mode === "disabled") return null;
  const client = mode === "aws-batch" ? new BatchClient({ region: process.env.AWS_REGION }) : null;
  let stopped = false;
  let running: Promise<void> | null = null;
  async function tick() {
    if (stopped || !canClaimWork()) return;
    await expireCutoutLeases(db);
    await prepareCutoutDemands(db);
    if (!client || !canClaimWork()) return;
    // Capacity is also bounded by the Batch compute environment. This limit avoids
    // submitting a large backlog whose capabilities would expire in the queue.
    const active = await db.select({ id: schema.characterCutouts.id }).from(schema.characterCutouts)
      .where(inArray(schema.characterCutouts.status, ["submitted", "running"]));
    const pending = await db.select({ id: schema.characterCutouts.id }).from(schema.characterCutouts)
      .where(eq(schema.characterCutouts.status, "pending")).orderBy(asc(schema.characterCutouts.createdAt)).limit(Math.max(0, 2 - active.length));
    for (const row of pending) {
      if (!canClaimWork()) return;
      const reservation = await reserveCutout(db, row.id);
      if (!reservation) continue;
      try {
        const result = await client.send(new SubmitJobCommand({
          jobName: `cutout-${row.id}-${reservation.job.attempts}`, jobQueue: process.env.CUTOUT_BATCH_QUEUE!,
          jobDefinition: process.env.CUTOUT_BATCH_JOB_DEFINITION!,
          containerOverrides: { environment: [
            { name: "CUTOUT_API_URL", value: process.env.CUTOUT_API_URL! },
            { name: "CUTOUT_JOB_ID", value: row.id }, { name: "CUTOUT_JOB_TOKEN", value: reservation.token },
          ] },
        }), { abortSignal: AbortSignal.timeout(30_000) });
        await db.update(schema.characterCutouts).set({ batchJobId: result.jobId ?? null })
          .where(and(eq(schema.characterCutouts.id, row.id), eq(schema.characterCutouts.tokenHash, reservation.job.tokenHash!)));
      } catch (error) {
        // Submission may have succeeded. Keep its fence until lease expiry instead
        // of immediately issuing another paid job with a second valid capability.
        console.error("[character-cutouts] Batch submission unconfirmed", { jobId: row.id, error });
        await db.update(schema.characterCutouts).set({ error: "Batch submission unconfirmed; waiting for claim or expiry" })
          .where(and(eq(schema.characterCutouts.id, row.id), eq(schema.characterCutouts.tokenHash, reservation.job.tokenHash!)));
      }
    }
  }
  const launch = () => {
    if (!running) running = tick().catch(error => console.error("[character-cutouts] Dispatcher failed", error)).finally(() => { running = null; });
  };
  const timer = setInterval(launch, 15_000);
  launch();
  return { async stop() { stopped = true; clearInterval(timer); await running; client?.destroy(); } };
}
