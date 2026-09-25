import { requireAccountAdmin } from "../services/account-spending.js";
import { changeInferenceAccount, readInferenceAccount } from "../services/inference-allowances.js";
import { Hono } from "hono";
import { schema, type DrizzleDB } from "../db/index.js";
import { requireAuth, type AuthEnv } from "../middleware/auth.js";
import { readAccountSpending } from "../services/account-spending.js";
import { GenerationAdmissionError } from "../services/account-text-usage.js";
export function createAccountInferenceRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();
  app.use('/api/admin/inference/*', requireAuth(db));
  app.use('/api/admin/inference/*', async (c,next) => { c.header('Cache-Control','private, no-store'); await next(); });
  app.onError((error,c) => {
    if (error instanceof GenerationAdmissionError) return c.json({ error: error.message, code: error.code },error.status);
    console.error('[account-inference]',error);
    return c.json({ error: 'Account inference request failed.' },500);
  });
  app.get('/api/admin/inference/usage', async c => c.json(await readAccountSpending(db,c.get('user').id,c.req.query())));
  app.get('/api/admin/inference/plans',async c=>{ const authority=await requireAccountAdmin(db,c.get('user').id); return c.json({plans:await db.select().from(schema.inferencePlans),...authority}); });
  app.get('/api/admin/inference/accounts/:id',async c=>c.json(await readInferenceAccount(db,c.get('user').id,c.req.param('id'))));
  app.post('/api/admin/inference/actions',async c=>{
    const body:unknown=await c.req.json();
    if(!body||typeof body!=='object'||Array.isArray(body)) throw new GenerationAdmissionError('invalid_command','Invalid account command.',400);
    return c.json(await changeInferenceAccount(db,c.get('user').id,body as Record<string,unknown>));
  });
  return app;
}
