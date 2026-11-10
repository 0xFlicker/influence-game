import { createHash, createHmac } from "node:crypto";
import OAuth from "oauth-1.0a";
import type { schema } from "../db/index.js";

export type ConversionRow = typeof schema.campaignConversionEvents.$inferSelect;
export type ConversionFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type ConversionUpdate = Partial<ConversionRow>;
export type FunnelEvent = "signup_completed" | "agent_ready" | "season_entry";

/** No free product outcome is represented as a purchase or given revenue. */
export const PLATFORM_EVENT_MAP: Record<string, string> = {
  signup_completed: "CompleteRegistration",
  agent_ready: "AgentReady",
  season_entry: "SeasonEntry",
};

export interface AdConversionEnv {
  googleClientId?: string;
  googleClientSecret?: string;
  googleRefreshToken?: string;
  googleCustomerId?: string;
  googleLoginCustomerId?: string;
  googleConversionActions?: Partial<Record<FunnelEvent, string>>;
  tiktokPixelId?: string;
  tiktokAccessToken?: string;
  xPixelId?: string;
  xConsumerKey?: string;
  xConsumerSecret?: string;
  xAccessToken?: string;
  xAccessTokenSecret?: string;
  xEventIds?: Partial<Record<FunnelEvent, string>>;
}

/** Read only validated acknowledgement fields; never trust provider response shapes. */
export function responseObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function retryableDelivery(status: string, attempts: number): boolean {
  return ["pending", "failed", "unconfigured"].includes(status) && attempts < 5;
}

export function googleAuthenticated(env: AdConversionEnv): boolean {
  return Boolean(env.googleClientId && env.googleClientSecret && env.googleRefreshToken);
}

export function xAuthenticated(env: AdConversionEnv): boolean {
  return Boolean(env.xConsumerKey && env.xConsumerSecret && env.xAccessToken && env.xAccessTokenSecret);
}

/** Resolve once, then persist before sending, so config changes cannot redirect a retry. */
export function googleDestination(env: AdConversionEnv, event: string): ConversionRow["googleDestination"] {
  const action = env.googleConversionActions?.[event as FunnelEvent];
  if (!env.googleCustomerId || !action) return null;
  return {
    operatingAccount: { accountType: "GOOGLE_ADS", accountId: env.googleCustomerId },
    loginAccount: { accountType: "GOOGLE_ADS", accountId: env.googleLoginCustomerId || env.googleCustomerId },
    productDestinationId: action,
  };
}

export async function deliverTikTok(row: ConversionRow, env: AdConversionEnv, fetchFn: ConversionFetch): Promise<ConversionUpdate> {
  if (!retryableDelivery(row.tiktokStatus, row.tiktokAttempts)) return {};
  const event = PLATFORM_EVENT_MAP[row.eventName];
  if (!event) return { tiktokStatus: "not_applicable" };
  if (!row.tiktokPixelId || !env.tiktokAccessToken) return { tiktokStatus: "unconfigured" };
  const tiktokAttempts = row.tiktokAttempts + 1;
  try {
    const response = await fetchFn("https://business-api.tiktok.com/open_api/v1.3/event/track/", {
      method: "POST", signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json", "Access-Token": env.tiktokAccessToken },
      body: JSON.stringify({ event_source: "web", event_source_id: row.tiktokPixelId, data: [{
        event, event_id: row.id, event_time: Math.floor(Date.parse(row.occurredAt) / 1000),
        user: { external_id: createHash("sha256").update(row.publicId).digest("hex"),
          ...(row.attribution?.ttclid ? { ttclid: row.attribution.ttclid } : {}) },
        page: { url: "https://thehouse.game" },
      }] }),
    });
    if (!response.ok || responseObject(await response.json()).code !== 0) throw new Error("Delivery rejected");
    return { tiktokStatus: "delivered", tiktokAttempts, tiktokLastError: null };
  } catch {
    return { tiktokStatus: "failed", tiktokAttempts, tiktokLastError: "TikTok delivery failed" };
  }
}

export async function deliverX(row: ConversionRow, env: AdConversionEnv, fetchFn: ConversionFetch): Promise<ConversionUpdate> {
  if (!retryableDelivery(row.xStatus, row.xAttempts)) return {};
  if (!PLATFORM_EVENT_MAP[row.eventName] || !row.attribution?.twclid) return { xStatus: "not_applicable" };
  if (!row.xPixelId || !row.xEventId || !xAuthenticated(env)) return { xStatus: "unconfigured" };
  const xAttempts = row.xAttempts + 1;
  try {
    const url = `https://ads-api.x.com/12/measurement/conversions/${encodeURIComponent(row.xPixelId)}`;
    const oauth = new OAuth({ consumer: { key: env.xConsumerKey!, secret: env.xConsumerSecret! },
      signature_method: "HMAC-SHA1",
      hash_function: (base, key) => createHmac("sha1", key).update(base).digest("base64"),
    });
    // JSON body fields are not OAuth form parameters. Sign the endpoint only.
    const authorization = oauth.toHeader(oauth.authorize({ url, method: "POST" }, {
      key: env.xAccessToken!, secret: env.xAccessTokenSecret!,
    }));
    const response = await fetchFn(url, {
      method: "POST", signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json", ...authorization },
      body: JSON.stringify({ conversions: [{ event_id: row.xEventId, conversion_id: row.id,
        conversion_time: new Date(row.occurredAt).toISOString(), identifiers: [{ twclid: row.attribution.twclid }],
      }] }),
    });
    const result = responseObject(response.ok ? await response.json() : null);
    if (responseObject(result.data).conversions_processed !== 1 || (result.errors !== undefined && (!Array.isArray(result.errors) || result.errors.length > 0))) throw new Error("Delivery rejected");
    return { xStatus: "delivered", xAttempts, xLastError: null };
  } catch {
    return { xStatus: "failed", xAttempts, xLastError: "X delivery failed" };
  }
}
