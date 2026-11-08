import { createHash } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { deliverTikTok, deliverX, googleAuthenticated, googleDestination, xAuthenticated,
  retryableDelivery, PLATFORM_EVENT_MAP,
  type AdConversionEnv, type ConversionRow, type ConversionFetch, type FunnelEvent,
} from "./campaign-ad-delivery.js";
import { deliverGoogle, googleTokenProvider } from "./campaign-google-delivery.js";
export { PLATFORM_EVENT_MAP } from "./campaign-ad-delivery.js";
export type { ConversionFetch } from "./campaign-ad-delivery.js";

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
const CLICK_ID_PARAMS = new Set(["gclid", "fbclid", "msclkid", "ttclid", "twclid", "dclid", "gbraid", "wbraid"]);

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
  db: DbOrTx, userId: string, analytics: boolean, explicitChoice = false, expectedVersion?: string, analyticsExplicit = false,
): Promise<boolean> {
  await lockAccount(db, userId);
  const [previous] = await db.select().from(schema.userAnalyticsPreferences)
    .where(eq(schema.userAnalyticsPreferences.userId, userId));
  const allowed = analytics && (previous?.analytics !== false || (explicitChoice && expectedVersion === previous.updatedAt));
  // A regional default is permission to deliver, not an affirmative consent signal.
  // Stale browser requests cannot upgrade the stored explicit choice.
  const confirmedChoice = analyticsExplicit && (!previous || expectedVersion === previous.updatedAt);
  const affirmative = allowed && (previous?.analyticsExplicit === true || confirmedChoice);
  // Version permission changes, including repeated explicit rejection. Recording
  // affirmative metadata while already allowed preserves that version so the
  // same validated browser sync can retain its current campaign touch.
  const permissionChanged = !previous || previous.analytics !== allowed || (!analytics && explicitChoice);
  if (permissionChanged || previous.analyticsExplicit !== affirmative) {
    await db.insert(schema.userAnalyticsPreferences).values({ userId, analytics: allowed, analyticsExplicit: affirmative })
      .onConflictDoUpdate({ target: schema.userAnalyticsPreferences.userId,
        set: { analytics: allowed, analyticsExplicit: affirmative, updatedAt: permissionChanged ? new Date(Math.max(Date.now(), Date.parse(previous?.updatedAt ?? "") + 1 || 0)).toISOString() : previous.updatedAt } });
  }
  if (!allowed) {
    await db.delete(schema.userCampaignAttribution).where(eq(schema.userCampaignAttribution.userId, userId));
    await db.update(schema.campaignConversionEvents).set({
      attribution: null,
      posthogStatus: sql`CASE WHEN posthog_status = 'delivered' THEN posthog_status ELSE 'suppressed' END`,
      platformStatus: sql`CASE WHEN platform_status = 'delivered' THEN platform_status ELSE 'suppressed' END`,
      googleStatus: sql`CASE WHEN google_status = 'delivered' THEN google_status ELSE 'suppressed' END`,
      tiktokStatus: sql`CASE WHEN tiktok_status = 'delivered' THEN tiktok_status ELSE 'suppressed' END`,
      googleNextPollAt: null,
      xStatus: sql`CASE WHEN x_status = 'delivered' THEN x_status ELSE 'suppressed' END`,
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
    const [preference] = await tx.select().from(schema.userAnalyticsPreferences)
      .where(eq(schema.userAnalyticsPreferences.userId, input.userId));
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
        googleStatus: allowed ? "pending" : "suppressed",
        tiktokStatus: allowed ? "pending" : "suppressed",
        xStatus: allowed ? "pending" : "suppressed",
        googleAdUserDataGranted: allowed && preference?.analyticsExplicit === true,
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
  input: { userId: string; publicId: string; created: boolean; analytics?: unknown; analyticsExplicit?: unknown; attribution?: unknown },
): Promise<void> {
  try {
    await db.transaction(async tx => {
      await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
      if (typeof input.analytics === "boolean") {
        await syncAnalyticsPreference(tx, input.userId, input.analytics === true, false, undefined, input.analyticsExplicit === true);
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

export interface ConversionDeliveryEnv extends AdConversionEnv {
  posthogProjectToken?: string;
  posthogHost?: string;
  metaPixelId?: string;
  metaAccessToken?: string;
}

export function conversionDeliveryEnvFromProcess(env: NodeJS.ProcessEnv = process.env): ConversionDeliveryEnv {
  return {
    posthogProjectToken: env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN || undefined,
    posthogHost: env.POSTHOG_HOST || "https://us.i.posthog.com",
    metaPixelId: env.META_PIXEL_ID || undefined,
    metaAccessToken: env.META_CAPI_ACCESS_TOKEN || undefined,
    googleClientId: env.GOOGLE_ADS_CLIENT_ID || undefined,
    googleClientSecret: env.GOOGLE_ADS_CLIENT_SECRET || undefined,
    googleRefreshToken: env.GOOGLE_ADS_REFRESH_TOKEN || undefined,
    googleCustomerId: env.GOOGLE_ADS_CUSTOMER_ID || undefined,
    googleLoginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || undefined,
    googleConversionActions: {
      signup_completed: env.GOOGLE_ADS_SIGNUP_ACTION_ID || undefined,
      agent_ready: env.GOOGLE_ADS_AGENT_READY_ACTION_ID || undefined,
      season_entry: env.GOOGLE_ADS_SEASON_ENTRY_ACTION_ID || undefined,
    },
    tiktokPixelId: env.TIKTOK_PIXEL_ID || undefined,
    tiktokAccessToken: env.TIKTOK_EVENTS_ACCESS_TOKEN || undefined,
    xPixelId: env.X_ADS_PIXEL_ID || undefined,
    xConsumerKey: env.X_ADS_CONSUMER_KEY || undefined,
    xConsumerSecret: env.X_ADS_CONSUMER_SECRET || undefined,
    xAccessToken: env.X_ADS_ACCESS_TOKEN || undefined,
    xAccessTokenSecret: env.X_ADS_ACCESS_TOKEN_SECRET || undefined,
    xEventIds: {
      signup_completed: env.X_ADS_SIGNUP_EVENT_ID || undefined,
      agent_ready: env.X_ADS_AGENT_READY_EVENT_ID || undefined,
      season_entry: env.X_ADS_SEASON_ENTRY_EVENT_ID || undefined,
    },
  };
}

export interface DeliverySummary {
  claimed: number;
  posthogDelivered: number;
  platformDelivered: number;
  platformUnconfigured: number;
  googleDelivered: number;
  tiktokDelivered: number;
  xDelivered: number;
  failed: number;
}

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
    googleDelivered: 0,
    tiktokDelivered: 0,
    xDelivered: 0,
    failed: 0,
  };
  // Each destination has its own retry budget. Missing configuration spends no attempts.
  const retryable = retryableDelivery;
  const getGoogleToken = googleTokenProvider(env, fetchFn);
  const pending = await db.select({ id: schema.campaignConversionEvents.id, userId: schema.campaignConversionEvents.userId })
    .from(schema.campaignConversionEvents).where(sql`
      (posthog_status IN ('pending', 'failed', 'unconfigured') AND posthog_attempts < 5
        AND (${Boolean(env.posthogProjectToken)} OR posthog_status = 'pending'))
      OR (platform_status IN ('pending', 'failed', 'unconfigured') AND platform_attempts < 5
        AND (${Boolean(env.metaPixelId && env.metaAccessToken)} OR platform_status = 'pending'))
      OR (google_status IN ('pending', 'failed', 'unconfigured') AND google_attempts < 5
        AND (google_status = 'pending' OR (${googleAuthenticated(env)} AND (
          google_destination IS NOT NULL OR (${Boolean(env.googleCustomerId)} AND event_name IN (
            ${env.googleConversionActions?.signup_completed ? 'signup_completed' : ''},
            ${env.googleConversionActions?.agent_ready ? 'agent_ready' : ''},
            ${env.googleConversionActions?.season_entry ? 'season_entry' : ''}
          ))
        ))))
      OR (google_status = 'processing' AND ${googleAuthenticated(env)}
        AND (google_next_poll_at IS NULL OR google_next_poll_at::timestamptz <= now()))
      OR (tiktok_status IN ('pending', 'failed', 'unconfigured') AND tiktok_attempts < 5
        AND (tiktok_status = 'pending' OR (${Boolean(env.tiktokAccessToken)}
          AND (tiktok_pixel_id IS NOT NULL OR ${Boolean(env.tiktokPixelId)}))))
      OR (x_status IN ('pending', 'failed', 'unconfigured') AND x_attempts < 5
        AND (x_status = 'pending' OR (${xAuthenticated(env)} AND (
          (x_pixel_id IS NOT NULL AND x_event_id IS NOT NULL) OR (${Boolean(env.xPixelId)} AND event_name IN (
            ${env.xEventIds?.signup_completed ? 'signup_completed' : ''},
            ${env.xEventIds?.agent_ready ? 'agent_ready' : ''},
            ${env.xEventIds?.season_entry ? 'season_entry' : ''}
          ))
        ))))
    `).orderBy(asc(schema.campaignConversionEvents.occurredAt)).limit(limit);
  summary.claimed = pending.length;
  for (const candidate of pending) {
    // Commit non-secret destination identities before any network request. A retry
    // after a crash or config change must use the same deduplication namespace.
    await db.transaction(async tx => {
      await lockAccount(tx, candidate.userId);
      const [row] = await tx.select().from(schema.campaignConversionEvents)
        .where(eq(schema.campaignConversionEvents.id, candidate.id));
      if (!row || !await accountAnalyticsAllowed(tx, row.userId)) return;
      const destination = googleDestination(env, row.eventName);
      const xEventId = env.xEventIds?.[row.eventName as FunnelEvent];
      await tx.update(schema.campaignConversionEvents).set({
        googleDestination: row.googleDestination ?? (googleAuthenticated(env) && retryable(row.googleStatus, row.googleAttempts) ? destination : null),
        tiktokPixelId: row.tiktokPixelId ?? (env.tiktokAccessToken && retryable(row.tiktokStatus, row.tiktokAttempts) ? env.tiktokPixelId : undefined),
        xPixelId: row.xPixelId ?? (xAuthenticated(env) && retryable(row.xStatus, row.xAttempts) && xEventId ? env.xPixelId : undefined),
        xEventId: row.xEventId ?? (xAuthenticated(env) && retryable(row.xStatus, row.xAttempts) && env.xPixelId ? xEventId : undefined),
      }).where(eq(schema.campaignConversionEvents.id, row.id));
    });
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
      // Independent destinations start under the same consent lock. Their HTTP
      // timeouts overlap so added providers do not extend the account lock by
      // the sum of every provider's timeout.
      const adDelivery = Promise.all([
        deliverGoogle(row, env, fetchFn, getGoogleToken),
        deliverTikTok(row, env, fetchFn),
        deliverX(row, env, fetchFn),
      ]);
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
      const [google, tiktok, x] = await adDelivery;
      if (google.googleStatus === "delivered") summary.googleDelivered++;
      if (tiktok.tiktokStatus === "delivered") summary.tiktokDelivered++;
      if (x.xStatus === "delivered") summary.xDelivered++;
      summary.failed += [google.googleStatus, tiktok.tiktokStatus, x.xStatus].filter(status => status === "failed" || status === "review_required").length;
      const allAdsDone = [platformStatus, google.googleStatus ?? row.googleStatus,
        tiktok.tiktokStatus ?? row.tiktokStatus, x.xStatus ?? row.xStatus]
        .every(status => ["delivered", "not_applicable", "suppressed"].includes(status));
      await tx.update(schema.campaignConversionEvents).set({ ...google, ...tiktok, ...x, posthogStatus, platformStatus,
        posthogAttempts, platformAttempts, lastError,
        deliveredAt: posthogStatus === "delivered" && allAdsDone
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
