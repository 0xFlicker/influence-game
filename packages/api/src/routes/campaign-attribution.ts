/**
 * Campaign attribution routes.
 *
 * POST /api/attribution/retain — authenticated account linking for the
 * browser-retained first/last-non-direct touches. This is how attribution
 * survives signup, redirects and return visits, and how an account created
 * through a tagged landing keeps its acquisition source on the server.
 * MCP-created accounts have no landing touch; their channel is recorded as
 * mcp on conversion events instead of inventing a campaign touch.
 *
 * GET /api/admin/campaign-report — internal campaign/creative/landing-variant
 * reporting from authoritative conversion events. Spend is supplied by the
 * caller from the ad platform export (`?spend={"campaign":123.45}`); it is
 * never invented, stored as revenue, or blended with platform-reported
 * results. Generation/service costs are tracked outside advertising spend.
 */
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";
import type { DrizzleDB } from "../db/index.js";
import { requireAuth, requirePermission, type AuthEnv } from "../middleware/auth.js";
import { parseJsonBody } from "../lib/parse-json-body.js";
import {
  getCampaignReport,
  retainUserAttribution,
  retainBrowserUserAgent,
  syncAnalyticsPreference,
} from "../services/campaign-conversions.js";

export function createCampaignAttributionRoutes(db: DrizzleDB) {
  const app = new Hono<AuthEnv>();

  app.post("/api/attribution/retain", requireAuth(db), async (c) => {
    const user = c.get("user");
    const body = await parseJsonBody(c, "POST /api/attribution/retain");
    if (typeof body?.analytics !== "boolean" || typeof body?.advertising !== "boolean" || (body.advertisingExplicit !== undefined && typeof body.advertisingExplicit !== "boolean") || (body.analyticsExplicit !== undefined && typeof body.analyticsExplicit !== "boolean") || (body.explicitChoice !== undefined && typeof body.explicitChoice !== "boolean") || (body.expectedVersion !== undefined && typeof body.expectedVersion !== "string")) {
      return c.json({ error: "analytics and advertising must be booleans; preference metadata must have valid types" }, 400);
    }
    const preference = await db.transaction(async tx => {
      const allowed = await syncAnalyticsPreference(tx, user.id, body.analytics === true && c.req.header("Sec-GPC") !== "1" && c.req.header("DNT") !== "1", body.explicitChoice === true, typeof body.expectedVersion === "string" ? body.expectedVersion : undefined, body.analyticsExplicit === true, body.advertising === true && c.req.header("Sec-GPC") !== "1" && c.req.header("DNT") !== "1", body.advertisingExplicit === true);
      const [saved] = await tx.select().from(schema.userAnalyticsPreferences).where(eq(schema.userAnalyticsPreferences.userId, user.id));
      // A delayed touch from before withdrawal cannot reappear after re-enabling.
      // Initial sync returns the version; the next browser write supplies it.
      if ((allowed || saved!.advertising) && body.expectedVersion === saved!.updatedAt) {
        await retainBrowserUserAgent(tx, user.id, c.req.header("User-Agent"));
        await retainUserAttribution(tx, {
          userId: user.id, channel: "web", firstTouch: body.firstTouch, lastTouch: body.lastTouch,
        });
      }
      return { analytics: allowed, advertising: saved!.advertising === true, version: saved!.updatedAt };
    });
    return c.json(preference);
  });

  app.get("/api/admin/campaign-report", requireAuth(db), requirePermission("view_admin"), async (c) => {
    let spendByCampaign: Record<string, number> | undefined;
    const spendParam = c.req.query("spend");
    if (spendParam) {
      try {
        const parsed: unknown = JSON.parse(spendParam);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
          Object.values(parsed).some(value => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
          return c.json({ error: "spend must contain nonnegative finite campaign amounts" }, 400);
        }
        spendByCampaign = Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, number] =>
              typeof entry[1] === "number" && Number.isFinite(entry[1]),
          ),
        );
      } catch {
        return c.json({ error: "spend must be a JSON object of campaign to amount" }, 400);
      }
    }
    return c.json({ rows: await getCampaignReport(db, { spendByCampaign }) });
  });

  return app;
}
