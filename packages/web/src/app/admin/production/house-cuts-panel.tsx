"use client";

import { useAdminRead, useAdminSession, useAdminValue, type Operation } from "../admin-session";
import styles from "./workspace.module.css";

interface CutStatus {
  audience: "public" | "mystery" | "omniscient";
  status: "missing" | "queued" | "running" | "ready" | "failed";
  action: "backfill" | "recover" | null;
  expectedUpdatedAt?: string;
  failure?: string | null;
  blockedReason?: string | null;
  cardCount?: number;
  budgetUsd: number;
  spentUsd: number;
}

export function HouseCutsPanel({ gameId, slug }: { gameId: string; slug: string }) {
  const root = `/api/games/${encodeURIComponent(gameId)}/cuts`;
  const diagnostics = useAdminRead<CutStatus[]>(`${root}/diagnostics`, 3000);
  if (diagnostics.error) return <p role="alert">{diagnostics.error}</p>;
  if (!diagnostics.data) return <p role="status">Loading House Cuts…</p>;
  return <section className={styles.cutsPanel} aria-label="House Cuts">
    <p className={styles.dialogIntro}>Generate highlights for completed games or retry a failed generation. Each audience has a $1 total generation budget; retries use the remaining budget.</p>
    {diagnostics.data.map(job => <CutAudience key={job.audience} job={job} root={root} slug={slug} refresh={async () => { await diagnostics.refresh(); }} />)}
  </section>;
}

function CutAudience({ job, root, slug, refresh }: { job: CutStatus; root: string; slug: string; refresh: () => Promise<void> }) {
  const session = useAdminSession();
  const key = `operation:${root}:${job.audience}`;
  const [operation] = useAdminValue<Operation | undefined>(key, undefined);
  const pending = operation?.phase === "submitting";
  const unknown = operation?.phase === "unknown";
  async function submit() {
    if (pending || (!unknown && !job.action)) return;
    try {
      await session.execute(key, `${root}/${job.action}`, job.action === "recover"
        ? { audience: job.audience, expectedUpdatedAt: job.expectedUpdatedAt, idempotencyKey: crypto.randomUUID() }
        : { audience: job.audience }, unknown);
    } catch { /* AdminSession retains the error and exact request for safe retry. */ }
    await refresh();
  }
  const label = job.audience === "public" ? "Influence" : job.audience === "mystery" ? "Mystery" : "Omniscient";
  return <section className={styles.cutsAudience} aria-label={`${label} Cuts`}>
    <h3>{label}</h3>
    <p role="status">{job.status === "missing" ? "No Cuts generated" : job.status === "ready" ? `${job.cardCount ?? 0} cards ready` : job.status === "queued" ? "Queued" : job.status === "running" ? "Generating…" : "Generation failed"}</p>
    <p className={styles.dialogIntro}>${job.spentUsd.toFixed(4)} spent · ${Math.max(0, job.budgetUsd - job.spentUsd).toFixed(4)} remaining</p>
    {job.failure && <p>{job.failure}</p>}
    {job.blockedReason && <p>{job.blockedReason}</p>}
    {(job.action || unknown || pending) && <button disabled={pending} onClick={() => void submit()}>
      {pending ? "Submitting…" : unknown ? "Retry pending request" : job.action === "recover" ? "Retry failed Cuts" : "Generate missing Cuts"}
    </button>}
    {operation?.error && (unknown || operation.phase === "rejected") && <p role="alert">{operation.error}</p>}
    {job.status === "ready" && <a href={`/games/${encodeURIComponent(slug)}/highlights?audience=${job.audience}`}>View Cuts</a>}
  </section>;
}
