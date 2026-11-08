import { createHash } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";

/**
 * Paid-campaign attribution and authoritative conversion events.
 *
 * Definitions (see docs/product-analytics.md):
 * - Acquisition counts unique NEW accounts reaching an outcome. Additional
 *   agents are tracked separately and never inflate account conversions.
 * - season_entry is enrollment in the intended season; game_placed is the
 *   separate later placement in a game. Never count one as the other.
 * - signup_completed fires only when a new account row was created
 *   (created === true). Existing-account sign-in is reactivation, not signup.
 * - Events are written in the same transaction as the successful mutation
 *   where the mutation owns a transaction, with deterministic IDs, so
 *   retries, switches and repeated requests cannot duplicate a conversion.
 * - Delivery to PostHog / ad platforms happens after commit from the outbox
 *   columns on campaign_conversion_events; a failed delivery never rolls
 *   back or blocks the product mutation.
 */

export type CampaignChannel = "web" | "mcp" | "api";

export interface CampaignTouchInput {
  source?: string;
  medium?: string;
  campaign?: string;
  creative?: string;
  audience?: string;
  clickId?: string;
  clickIdParam?: string;
  landingVariant?: string;
  onboardingVariant?: string;
  starterPromptId?: string;
  starterSkillId?: string;
  touchedAt?: string;
}

const LABEL_VALUE = /^[a-zA-Z0-9_. -]{1,100}$/;
const CLICK_ID_VALUE = /^[a-zA-Z0-9_.-]{1,512}$/;
const CLICK_ID_PARAMS = new Set(["gclid", "fbclid", "msclkid", "ttclid", "dclid", "gbraid", "wbraid"]);

/** 90-day attribution window for acquisition reporting. */
export const ATTRIBUTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function cleanLabel(value: unknown): string | undefined {
  return typeof value === "string" && LABEL_VALUE.test(value) ? value : undefined;
}

/**
 * Validate an untrusted attribution payload. Only supported campaign fields
 * survive; credentials, OAuth codes, prompt text and arbitrary keys are
 * dropped by construction because no supported field can carry them.
 */
export function validateCampaignTouch(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const touch: Record<string, string> = {};
  const put = (key: string, value?: string) => {
    if (value) touch[key] = value;
  };
  put("utm_source", cleanLabel(raw.source ?? raw.utm_source));
  put("utm_medium", cleanLabel(raw.medium ?? raw.utm_medium));
  put("utm_campaign", cleanLabel(raw.campaign ?? raw.utm_campaign));
  put("utm_content", cleanLabel(raw.creative ?? raw.utm_content));
  put("utm_term", cleanLabel(raw.audience ?? raw.utm_term));
  put("landing_variant", cleanLabel(raw.landingVariant ?? raw.landing_variant));
  put("onboarding_variant", cleanLabel(raw.onboardingVariant ?? raw.onboarding_variant));
  put("starter_prompt", cleanLabel(raw.starterPromptId ?? raw.starter_prompt));
  put("starter_skill", cleanLabel(raw.starterSkillId ?? raw.starter_skill));
  const clickId = raw.clickId;
  const clickIdParam = raw.clickIdParam;
  if (
    typeof clickId === "string" && CLICK_ID_VALUE.test(clickId)
    && typeof clickIdParam === "string" && CLICK_ID_PARAMS.has(clickIdParam)
  ) {
    touch[clickIdParam] = clickId;
  }
  if (typeof raw.touchedAt === "string" && !Number.isNaN(Date.parse(raw.touchedAt))) {
    touch.touch_at = raw.touchedAt;
  }
  return Object.keys(touch).length ? touch : null;
}

export function isNonDirectTouch(touch: Record<string, string> | null): boolean {
  if (!touch) return false;
  return Boolean(
    touch.utm_source || touch.utm_campaign || touch.utm_content || touch.utm_term
    || [...CLICK_ID_PARAMS].some((param) => touch[param]),
  );
}

type Tx = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
type DbOrTx = DrizzleDB | Tx;

/** Serialize tracking without conflicting with product inserts holding FK key-share locks. */
async function lockAccount(db: DbOrTx, userId: string): Promise<void> {
  await db.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.id, userId)).for("no key update");
}

export async function accountAnalyticsAllowed(db: DbOrTx, userId: string): Promise<boolean> {
  const [preference] = await db.select().from(schema.userAnalyticsPreferences)
    .where(eq(schema.userAnalyticsPreferences.userId, userId));
  return preference?.analytics === true;
}

/** Existing denials survive automatic sync; only a fresh explicit choice can re-enable. */
export async function syncAnalyticsPreference(
  db: DbOrTx, userId: string, analytics: boolean, explicitChoice = false, expectedVersion?: string,
): Promise<boolean> {
  await lockAccount(db, userId);
  const [previous] = await db.select().from(schema.userAnalyticsPreferences)
    .where(eq(schema.userAnalyticsPreferences.userId, userId));
  const allowed = analytics && (previous?.analytics !== false || (explicitChoice && expectedVersion === previous.updatedAt));
  // updatedAt is also the opaque preference version. Advance it even when two
  // changes share a clock millisecond, including a repeated explicit rejection.
  if (!previous || previous.analytics !== allowed || (!analytics && explicitChoice)) {
    await db.insert(schema.userAnalyticsPreferences).values({ userId, analytics: allowed })
      .onConflictDoUpdate({ target: schema.userAnalyticsPreferences.userId,
        set: { analytics: allowed, updatedAt: new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt ?? "") + 1 || 0)).toISOString() } });
  }
  if (!allowed) {
    await db.delete(schema.userCampaignAttribution).where(eq(schema.userCampaignAttribution.userId, userId));
    await db.update(schema.campaignConversionEvents).set({
      attribution: null,
      posthogStatus: sql`CASE WHEN posthog_status = 'delivered' THEN posthog_status ELSE 'suppressed' END`,
      platformStatus: sql`CASE WHEN platform_status = 'delivered' THEN platform_status ELSE 'suppressed' END`,
    }).where(eq(schema.campaignConversionEvents.userId, userId));
  }
  return allowed;
}

/**
 * Retain first acquisition and the latest non-direct touch for an account.
 * First touch is written once and never overwritten; a direct/empty touch
 * never replaces the last non-direct touch. Unknown attribution stays absent.
 */
export async function retainUserAttribution(
  db: DbOrTx,
  input: {
    userId: string;
    channel: CampaignChannel;
    firstTouch?: unknown;
    lastTouch?: unknown;
  },
): Promise<void> {
  if (!await accountAnalyticsAllowed(db, input.userId)) return;
  const firstTouch = validateCampaignTouch(input.firstTouch);
  const lastTouch = validateCampaignTouch(input.lastTouch);
  if (!isNonDirectTouch(firstTouch) && !isNonDirectTouch(lastTouch)) return;
  const now = new Date().toISOString();
  const effectiveFirst = isNonDirectTouch(firstTouch) ? firstTouch : lastTouch;
  const effectiveLast = isNonDirectTouch(lastTouch) ? lastTouch : firstTouch;
  await db
    .insert(schema.userCampaignAttribution)
    .values({
      userId: input.userId,
      channel: input.channel,
      firstTouch: effectiveFirst,
      lastTouch: effectiveLast,
      firstTouchAt: effectiveFirst?.touch_at ?? now,
      lastTouchAt: effectiveLast?.touch_at ?? now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.userCampaignAttribution.userId,
      set: {
        // First touch and its timestamp are intentionally not in this set:
        // acquisition history is immutable once retained.
        lastTouch: effectiveLast,
        lastTouchAt: effectiveLast?.touch_at ?? now,
        updatedAt: now,
      },
    });
}

export interface ConversionInput {
  eventName:
    | "signup_completed"
    | "agent_creation_started"
    | "agent_created"
    | "agent_ready"
    | "season_entry"
    | "game_placed"
    | "mcp_linked"
    | "owner_returned";
  /** Deterministic deduplication ID, e.g. `signup:{userId}`. */
  id: string;
  userId: string;
  publicId: string;
  agentProfileId?: string | null;
  seasonId?: string | null;
  channel: CampaignChannel;
  mcpClientId?: string | null;
  occurredAt?: string;
  suppressDelivery?: boolean;
}

/** Insert a conversion once. Returns true only for the first insert. */
export async function recordConversion(db: DbOrTx, input: ConversionInput): Promise<boolean> {
  return db.transaction(async tx => {
    await lockAccount(tx, input.userId);
    const allowed = !input.suppressDelivery && await accountAnalyticsAllowed(tx, input.userId);
    const inserted = await tx
      .insert(schema.campaignConversionEvents)
      .values({
        id: input.id,
        eventName: input.eventName,
        userId: input.userId,
        publicId: input.publicId,
        agentProfileId: input.agentProfileId ?? null,
        seasonId: input.seasonId ?? null,
        channel: input.channel,
        mcpClientId: input.mcpClientId ?? null,
        attribution: allowed ? await retainedAttribution(tx, input.userId) : null,
        occurredAt: input.occurredAt,
        posthogStatus: allowed ? "pending" : "suppressed",
        platformStatus: allowed ? "pending" : "suppressed",
      })
      .onConflictDoNothing()
      .returning({ id: schema.campaignConversionEvents.id });
    return inserted.length > 0;
  });
}

async function publicIdFor(db: DbOrTx, userId: string): Promise<string> {
  const [user] = await db
    .select({ publicId: schema.users.publicId })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (!user) throw new Error("Conversion user is missing");
  return user.publicId;
}

async function retainedAttribution(db: DbOrTx, userId: string): Promise<Record<string, string> | null> {
  const [row] = await db
    .select({ firstTouch: schema.userCampaignAttribution.firstTouch })
    .from(schema.userCampaignAttribution)
    .where(eq(schema.userCampaignAttribution.userId, userId))
    .limit(1);
  return row?.firstTouch ?? null;
}

/** New-account signup only. Call solely when account creation committed. */
export async function recordSignupCompleted(
  db: DbOrTx,
  input: { userId: string; channel: CampaignChannel; attribution?: unknown },
): Promise<boolean> {
  if (input.attribution !== undefined) {
    await retainUserAttribution(db, {
      userId: input.userId,
      channel: input.channel,
      firstTouch: input.attribution,
      lastTouch: input.attribution,
    });
  }
  return recordConversion(db, {
    eventName: "signup_completed",
    id: `signup:${input.userId}`,
    userId: input.userId,
    publicId: await publicIdFor(db, input.userId),
    channel: input.channel,
  });
}

/** Optional tracking must not turn a committed signup into a failed login. */
export async function recordAuthenticationTracking(
  db: DrizzleDB,
  input: { userId: string; publicId: string; created: boolean; analytics?: unknown; attribution?: unknown },
): Promise<void> {
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
      if (typeof input.analytics === "boolean") {
        await syncAnalyticsPreference(tx, input.userId, input.analytics === true);
      }
      if (input.created) {
        await recordSignupCompleted(tx, { userId: input.userId, channel: "web", attribution: input.attribution });
      } else {
        await recordConversion(tx, { eventName: "owner_returned",
          id: `owner_returned:${input.userId}:${new Date().toISOString().slice(0, 10)}`,
          userId: input.userId, publicId: input.publicId, channel: "web" });
      }
    });
  } catch {
    // Do not log payloads or credentials. Signup totals recover from users below.
    console.warn("[campaign-conversions] Auth tracking deferred; signup recovery will use the account record");
  }
}

/** Recover missing signup totals without inventing historical tracking permission. */
export async function reconcileSignupConversions(db: DrizzleDB, limit = 100): Promise<void> {
  const missing = await db.select({ id: schema.users.id, publicId: schema.users.publicId, createdAt: schema.users.createdAt })
    .from(schema.users).where(sql`${schema.users.createdAt}::timestamptz < now() - interval '1 minute' AND NOT EXISTS (SELECT 1 FROM campaign_conversion_events c WHERE c.id = 'signup:' || ${schema.users.id})`)
    .orderBy(asc(schema.users.createdAt)).limit(limit);
  for (const user of missing) {
    await db.transaction(tx => recordConversion(tx, { id: `signup:${user.id}`, eventName: "signup_completed",
      userId: user.id, publicId: user.publicId, channel: "api", occurredAt: user.createdAt, suppressDelivery: true }));
  }
}

/** First meaningful creation start per account (successful assistant turn). */
export async function recordAgentCreationStarted(
  db: DbOrTx,
  input: { userId: string; channel: CampaignChannel; mcpClientId?: string | null },
): Promise<boolean> {
  return recordConversion(db, {
    eventName: "agent_creation_started",
    id: `agent_creation_started:${input.userId}`,
    userId: input.userId,
    publicId: await publicIdFor(db, input.userId),
    channel: input.channel,
    mcpClientId: input.mcpClientId ?? null,
  });
}

export async function recordAgentCreated(
  db: DbOrTx,
  input: { userId: string; agentProfileId: string; channel: CampaignChannel; mcpClientId?: string | null },
): Promise<boolean> {
  return recordConversion(db, {
    eventName: "agent_created",
    id: `agent_created:${input.agentProfileId}`,
    userId: input.userId,
    publicId: await publicIdFor(db, input.userId),
    agentProfileId: input.agentProfileId,
    channel: input.channel,
    mcpClientId: input.mcpClientId ?? null,
  });
}

export async function recordAgentReady(
  db: DbOrTx,
  input: {
    userId: string;
    agentProfileId: string;
    contentRevisionId: string;
    channel: CampaignChannel;
    mcpClientId?: string | null;
  },
): Promise<boolean> {
  return recordConversion(db, {
    eventName: "agent_ready",
    id: `agent_ready:${input.agentProfileId}:${input.contentRevisionId}`,
    userId: input.userId,
    publicId: await publicIdFor(db, input.userId),
    agentProfileId: input.agentProfileId,
    channel: input.channel,
    mcpClientId: input.mcpClientId ?? null,
  });
}

export async function recordSeasonEntry(
  db: DbOrTx,
  input: {
    userId: string;
    agentProfileId: string;
    seasonId: string;
    channel: CampaignChannel;
    mcpClientId?: string | null;
  },
): Promise<boolean> {
  return recordConversion(db, {
    eventName: "season_entry",
    id: `season_entry:${input.userId}:${input.seasonId}`,
    userId: input.userId,
    publicId: await publicIdFor(db, input.userId),
    agentProfileId: input.agentProfileId,
    seasonId: input.seasonId,
    channel: input.channel,
    mcpClientId: input.mcpClientId ?? null,
  });
}

// ---------------------------------------------------------------------------
// Delivery (PostHog + advertising platforms). Runs after commit; failures are
// recorded on the row and retried by the next pass. Never throws into a
// product mutation.
// ---------------------------------------------------------------------------

export interface ConversionDeliveryEnv {
  posthogProjectToken?: string;
  posthogHost?: string;
  metaPixelId?: string;
  metaAccessToken?: string;
}

export function conversionDeliveryEnvFromProcess(env: NodeJS.ProcessEnv = process.env): ConversionDeliveryEnv {
  return {
    posthogProjectToken: env.POSTHOG_PROJECT_TOKEN || undefined,
    posthogHost: env.POSTHOG_HOST || "https://us.i.posthog.com",
    metaPixelId: env.META_PIXEL_ID || undefined,
    metaAccessToken: env.META_CAPI_ACCESS_TOKEN || undefined,
  };
}

/** Business events are never labelled purchases and carry no revenue value. */
export const PLATFORM_EVENT_MAP: Record<string, string> = {
  signup_completed: "CompleteRegistration",
  agent_ready: "AgentReady",
  season_entry: "SeasonEntry",
};

export interface DeliverySummary {
  claimed: number;
  posthogDelivered: number;
  platformDelivered: number;
  platformUnconfigured: number;
  failed: number;
}

type ConversionRow = typeof schema.campaignConversionEvents.$inferSelect;

function eventProperties(row: ConversionRow): Record<string, unknown> {
  return {
    ...(row.attribution ?? {}),
    channel: row.channel,
    environment: "production",
    conversion_id: row.id,
    ...(row.agentProfileId ? { agent_id: row.agentProfileId } : {}),
    ...(row.seasonId ? { season_id: row.seasonId } : {}),
    ...(row.mcpClientId ? { mcp_client_id: row.mcpClientId } : {}),
  };
}

export type ConversionFetch = (url: string, init?: RequestInit) => Promise<Response>;

export async function deliverPendingConversions(
  db: DrizzleDB,
  env: ConversionDeliveryEnv,
  fetchFn: ConversionFetch = fetch,
  limit = 100,
): Promise<DeliverySummary> {
  const summary: DeliverySummary = {
    claimed: 0,
    posthogDelivered: 0,
    platformDelivered: 0,
    platformUnconfigured: 0,
    failed: 0,
  };
  // Each destination has its own retry budget. Missing configuration spends no attempts.
  const retryable = (status: string, attempts: number) =>
    ["pending", "failed", "unconfigured"].includes(status) && attempts < 5;
  const pending = await db.select({ id: schema.campaignConversionEvents.id, userId: schema.campaignConversionEvents.userId })
    .from(schema.campaignConversionEvents).where(sql`
      (posthog_status IN ('pending', 'failed', 'unconfigured') AND posthog_attempts < 5 AND (${Boolean(env.posthogProjectToken)} OR posthog_status = 'pending'))
      OR (platform_status IN ('pending', 'failed', 'unconfigured') AND platform_attempts < 5 AND (${Boolean(env.metaPixelId && env.metaAccessToken)} OR platform_status = 'pending'))
    `).orderBy(asc(schema.campaignConversionEvents.occurredAt)).limit(limit);
  summary.claimed = pending.length;
  for (const candidate of pending) {
    // Re-read after locking: multiple workers cannot send the same pending row.
    // Withdrawal uses this lock too, so no delivery starts after it is acknowledged.
    await db.transaction(async tx => {
      await lockAccount(tx, candidate.userId);
      const [row] = await tx.select().from(schema.campaignConversionEvents)
        .where(eq(schema.campaignConversionEvents.id, candidate.id));
      if (!row) return;
      if (!await accountAnalyticsAllowed(tx, row.userId)) {
        await syncAnalyticsPreference(tx, row.userId, false);
        return;
      }
      let posthogStatus = row.posthogStatus;
      let platformStatus = row.platformStatus;
      let posthogAttempts = row.posthogAttempts;
      let platformAttempts = row.platformAttempts;
      let lastError: string | null = null;
      if (retryable(posthogStatus, posthogAttempts)) {
        if (!env.posthogProjectToken) posthogStatus = "unconfigured";
        else {
          posthogAttempts++;
          try {
            const hash = createHash("sha256").update(row.id).digest("hex");
            const uuid = `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
            const response = await fetchFn(`${env.posthogHost ?? "https://us.i.posthog.com"}/i/v0/e/`, {
              method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(5000),
              body: JSON.stringify({ api_key: env.posthogProjectToken, uuid,
                event: row.eventName, distinct_id: row.publicId, properties: eventProperties(row), timestamp: row.occurredAt }),
            });
            if (!response.ok) throw new Error("Delivery rejected");
            posthogStatus = "delivered";
            summary.posthogDelivered++;
          } catch {
            posthogStatus = "failed";
            lastError = "PostHog delivery failed";
            summary.failed++;
          }
        }
      }
      if (retryable(platformStatus, platformAttempts)) {
        const platformEvent = PLATFORM_EVENT_MAP[row.eventName];
        if (!platformEvent) platformStatus = "not_applicable";
        else if (!env.metaPixelId || !env.metaAccessToken) {
          platformStatus = "unconfigured";
          summary.platformUnconfigured++;
        } else {
          platformAttempts++;
          try {
            const clickId = row.attribution?.fbclid;
            const clickedAt = Date.parse(row.attribution?.touch_at ?? "");
            const response = await fetchFn(`https://graph.facebook.com/v21.0/${env.metaPixelId}/events`, {
              method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${env.metaAccessToken}` },
              signal: AbortSignal.timeout(5000),
              body: JSON.stringify({ data: [{ event_name: platformEvent,
                event_time: Math.floor(Date.parse(row.occurredAt) / 1000), event_id: row.id,
                action_source: row.channel === "web" ? "website" : "system_generated",
                ...(row.channel === "web" ? { event_source_url: "https://thehouse.game" } : {}),
                user_data: { external_id: [createHash("sha256").update(row.publicId).digest("hex")],
                  ...(clickId && Number.isFinite(clickedAt) ? { fbc: `fb.1.${clickedAt}.${clickId}` } : {}) },
              }] }),
            });
            if (!response.ok) throw new Error("Delivery rejected");
            platformStatus = "delivered";
            summary.platformDelivered++;
          } catch {
            platformStatus = "failed";
            lastError = "Meta delivery failed";
            summary.failed++;
          }
        }
      }
      await tx.update(schema.campaignConversionEvents).set({ posthogStatus, platformStatus,
        posthogAttempts, platformAttempts, lastError,
        deliveredAt: posthogStatus === "delivered" && ["delivered", "not_applicable"].includes(platformStatus)
          ? new Date().toISOString() : null,
      }).where(eq(schema.campaignConversionEvents.id, row.id));
    });
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Internal reporting. Platform-reported numbers stay in the platform; this is
// the internal source of truth. Spend is supplied by the caller from the ad
// platform export and is never invented or stored as revenue.
// ---------------------------------------------------------------------------

export interface CampaignReportRow {
  level: "campaign" | "creative";
  campaign: string;
  creative: string | null;
  landingVariant: string | null;
  newAccounts: number;
  readyAgents: number;
  uniqueSeasonEntrants: number;
  spend: number | null;
  costPerSignup: number | null;
  costPerReadyAgent: number | null;
  costPerSeasonEntrant: number | null;
}

export async function getCampaignReport(
  db: DrizzleDB,
  input: { spendByCampaign?: Record<string, number> } = {},
): Promise<CampaignReportRow[]> {
  const rows = await db
    .select({
      eventName: schema.campaignConversionEvents.eventName,
      userId: schema.campaignConversionEvents.userId,
      attribution: schema.campaignConversionEvents.attribution,
    })
    .from(schema.campaignConversionEvents)
    .where(
      sql`${schema.campaignConversionEvents.eventName} IN ('signup_completed', 'agent_ready', 'season_entry')`,
    );

  type Group = { campaign: string; creative: string | null; landingVariant: string | null;
    level: "campaign" | "creative"; signups: Set<string>; ready: Set<string>; entrants: Set<string> };
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const campaign = row.attribution?.utm_campaign ?? "unknown";
    const creative = row.attribution?.utm_content ?? "unknown";
    const landingVariant = row.attribution?.landing_variant ?? "unknown";
    for (const level of ["campaign", "creative"] as const) {
      const key = JSON.stringify(level === "campaign" ? [campaign] : [campaign, creative, landingVariant]);
      const group = groups.get(key) ?? { campaign, level,
        creative: level === "creative" ? creative : null,
        landingVariant: level === "creative" ? landingVariant : null,
        signups: new Set<string>(), ready: new Set<string>(), entrants: new Set<string>() };
      if (row.eventName === "signup_completed") group.signups.add(row.userId);
      if (row.eventName === "agent_ready") group.ready.add(row.userId);
      if (row.eventName === "season_entry") group.entrants.add(row.userId);
      groups.set(key, group);
    }
  }
  return [...groups.values()].map(group => {
    const spend = group.level === "campaign" ? input.spendByCampaign?.[group.campaign] ?? null : null;
    const per = (count: number) => spend === null || count === 0 ? null : spend / count;
    return { level: group.level, campaign: group.campaign, creative: group.creative, landingVariant: group.landingVariant,
      newAccounts: group.signups.size, readyAgents: group.ready.size, uniqueSeasonEntrants: group.entrants.size,
      spend, costPerSignup: per(group.signups.size), costPerReadyAgent: per(group.ready.size), costPerSeasonEntrant: per(group.entrants.size) };
  });
}
