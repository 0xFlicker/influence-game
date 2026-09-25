import { sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { userHasRole } from "../db/rbac.js";
import { GenerationAdmissionError } from "./generation-admission-error.js";

export async function requireAccountAdmin(db: Pick<DrizzleDB, "select">, userId: string) {
  const sysop = await userHasRole(db, userId, "sysop");
  if (!sysop && !await userHasRole(db, userId, "admin")) throw new GenerationAdmissionError("admin_required", "Admin access is required.", 403);
  return { sysop };
}

/** Source identities are disjoint; game spend is deliberately absent. No raw prompts or responses. */
const sources = sql`WITH usage AS (
 SELECT 'text:' || id AS id, 'text:' || id AS operation_id, user_id, kind, model, state,
 created_at, estimated_cost_microusd AS estimated, NULL::bigint AS actual,
 prompt_tokens, completion_tokens, pricing_source,
 CASE WHEN state = 'reserved' OR result->'failure'->>'beforeDispatch' = 'true' THEN 0 ELSE 1 END AS attempts
 FROM account_text_operations
 UNION ALL
 SELECT 'avatar:' || id, 'avatar:' || id, user_id, 'portrait', model, status, created_at::timestamptz,
 CASE WHEN status IN ('queued','skipped') OR failure_code LIKE 'generation_%' THEN NULL ELSE estimated_cost_microusd END, NULL::bigint, NULL::integer, NULL::integer, 'legacy_avatar_estimate',
 CASE WHEN status IN ('queued','skipped') OR failure_code LIKE 'generation_%' THEN 0 ELSE 1 END
 FROM avatar_generation_requests
 UNION ALL
 SELECT 'visual:' || a.id, 'visual:' || o.id, o.user_id,
 CASE WHEN o.operation_key LIKE 'full-body:%' THEN 'full_body' ELSE 'image_localization' END,
 a.model, CASE WHEN a.finished_at IS NULL OR coalesce((a.receipt->>'chargeUncertain')::boolean,false) THEN 'uncertain'
 WHEN a.image IS NOT NULL OR a.localization IS NOT NULL THEN 'succeeded' ELSE 'failed' END,
 a.created_at::timestamptz, a.cost_microusd, NULL::bigint, NULL::integer, NULL::integer, 'visual_pricing:2026-09-21', 1
 FROM visual_render_attempts a JOIN visual_render_operations o ON o.id = a.operation_id WHERE o.user_id IS NOT NULL
 UNION ALL
 SELECT 'learning:' || c.id, 'learning:' || c.review_id || ':' || c.ordinal, r.owner_user_id, 'learning', r.selected_model,
 c.state, c.reserved_at::timestamptz, c.estimated_cost_microusd, c.actual_cost_microusd, NULL::integer, NULL::integer,
 c.pricing_source_id, CASE WHEN c.dispatched_at IS NULL THEN 0 ELSE greatest(1,jsonb_array_length(c.transport_receipts)) END
 FROM agent_learning_review_calls c JOIN agent_learning_reviews r ON r.id = c.review_id
)`;
const totals = sql`count(DISTINCT operation_id) FILTER (WHERE kind IN ('creation_assistant','profile_creation','profile_refinement'))::int AS text_requests,
 count(DISTINCT operation_id) FILTER (WHERE kind IN ('portrait','full_body'))::int AS images,
 coalesce(sum(attempts),0)::int AS attempts, count(*) FILTER (WHERE state = 'failed')::int AS failures,
 count(actual)::int AS actual_cost_records, coalesce(sum(actual),0)::float8 AS actual_microusd, coalesce(sum(estimated),0)::float8 AS estimated_microusd,
 count(*) FILTER (WHERE attempts > 0 AND actual IS NULL AND estimated IS NULL)::int AS unpriced,
 max(created_at) AS last_activity`;
export async function readAccountSpending(db: DrizzleDB, actor: string, query: Record<string, string>) {
  await requireAccountAdmin(db, actor);
  const windows: Record<string, number | null> = { '24h': 1, '7d': 7, '30d': 30, all: null };
  const sorts: Record<string, ReturnType<typeof sql>> = { spend: sql`(actual_microusd + estimated_microusd)`, text: sql`text_requests`, images: sql`images`, attempts: sql`attempts`, failures: sql`failures`, activity: sql`last_activity`, pending: sql`pending_generations` };
  const window = query.window ?? '30d'; const sort = query.sort ?? 'spend';
  const offset = Number(query.offset ?? 0);
  const status = query.status ?? 'all';
  if (!['all','paused','pending'].includes(status)) throw new GenerationAdmissionError('invalid_query','Invalid account status filter.',400);
  if (!(window in windows) || !(sort in sorts) || !Number.isSafeInteger(offset) || offset < 0 || (query.search?.length ?? 0) > 200) throw new GenerationAdmissionError('invalid_query','Invalid usage filters.',400);
  const since = windows[window] === null ? null : new Date(Date.now() - windows[window]! * 86400000).toISOString();
  const filter = sql`(${since}::timestamptz IS NULL OR created_at >= ${since}::timestamptz)`;
  const coverage = 'Character text collection starts with this release. Earlier text usage is unavailable; image and learning coverage depends on retained journals. Game spend is separate.';
  if (query.userId) {
    const summary = await db.execute(sql`${sources} SELECT ${totals} FROM usage WHERE user_id = ${query.userId} AND ${filter}`);
    const operations = await db.execute(sql`${sources} SELECT operation_id, kind, model, ${totals} FROM usage WHERE user_id = ${query.userId} AND ${filter} GROUP BY operation_id, kind, model ORDER BY max(created_at) DESC, operation_id LIMIT 26 OFFSET ${offset}`);
    const attempts = query.operationId ? await db.execute(sql`${sources} SELECT id, operation_id, kind, model, state, created_at, estimated, actual, prompt_tokens, completion_tokens, pricing_source FROM usage WHERE user_id = ${query.userId} AND operation_id = ${query.operationId} ORDER BY created_at, id LIMIT 100`) : [];
    return { summary: summary[0], operations: operations.slice(0,25), nextOffset: operations.length > 25 ? offset + 25 : null, attempts, coverage, asOf: new Date().toISOString() };
  }
  const rows = await db.execute(sql`${sources}, totals AS (SELECT user_id, ${totals} FROM usage WHERE ${filter} GROUP BY user_id)
 SELECT u.id, coalesce(p.name,'Free') AS plan_name, coalesce(a.paused,false) AS generation_paused,
 coalesce(r.pending_generations,0) AS pending_generations, coalesce(r.uncertain_generations,0) AS uncertain_generations,
 coalesce(u.display_name,u.handle,u.email,u.wallet_address,u.id) AS label,
 coalesce(t.text_requests,0) AS text_requests, coalesce(t.images,0) AS images, coalesce(t.attempts,0) AS attempts,
 coalesce(t.actual_cost_records,0) AS actual_cost_records, coalesce(t.failures,0) AS failures, coalesce(t.actual_microusd,0) AS actual_microusd, coalesce(t.estimated_microusd,0) AS estimated_microusd,
 coalesce(t.unpriced,0) AS unpriced, t.last_activity
 FROM users u LEFT JOIN totals t ON t.user_id = u.id
 LEFT JOIN inference_accounts a ON a.user_id = u.id
 LEFT JOIN inference_plans p ON p.id = a.plan_id
 LEFT JOIN (SELECT user_id, count(*)::int AS pending_generations, count(*) FILTER (WHERE state = 'uncertain')::int AS uncertain_generations
 FROM inference_reservations WHERE state IN ('reserved','dispatched','uncertain') GROUP BY user_id) r ON r.user_id = u.id
 WHERE (${query.search ?? ''} = '' OR concat_ws(' ',u.id,u.display_name,u.handle,u.email,u.wallet_address) ILIKE ${'%' + (query.search ?? '') + '%'})
 AND (${status} = 'all' OR (${status} = 'paused' AND a.paused) OR (${status} = 'pending' AND r.pending_generations > 0))
 ORDER BY ${sorts[sort]} DESC NULLS LAST, u.id LIMIT 26 OFFSET ${offset}`);
  return { accounts: rows.slice(0,25), nextOffset: rows.length > 25 ? offset + 25 : null, coverage, asOf: new Date().toISOString() };
}
