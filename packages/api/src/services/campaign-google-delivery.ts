import {
  googleAuthenticated, PLATFORM_EVENT_MAP, retryableDelivery, responseObject,
  type AdConversionEnv, type ConversionFetch, type ConversionRow, type ConversionUpdate,
} from "./campaign-ad-delivery.js";

const API = "https://datamanager.googleapis.com/v1";
const HALF_HOUR_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One short-lived token per worker pass; no credential or provider body is persisted. */
export function googleTokenProvider(env: AdConversionEnv, fetchFn: ConversionFetch): () => Promise<string> {
  let token: string | undefined;
  let expiresAt = 0;
  return async () => {
    if (token && Date.now() < expiresAt) return token;
    const response = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", client_id: env.googleClientId!,
        client_secret: env.googleClientSecret!, refresh_token: env.googleRefreshToken! }).toString(),
    });
    const result = responseObject(response.ok ? await response.json() : null);
    if (typeof result?.access_token !== "string" || !result.access_token ||
      typeof result.expires_in !== "number" || result.expires_in <= 0) throw new Error("Google authorization failed");
    token = result.access_token;
    expiresAt = Date.now() + Math.max(0, result.expires_in - 60) * 1000;
    return token!;
  };
}

export async function deliverGoogle(
  row: ConversionRow, env: AdConversionEnv, fetchFn: ConversionFetch, getToken: () => Promise<string>,
): Promise<ConversionUpdate> {
  const polling = row.googleStatus === "processing";
  if (!polling && !retryableDelivery(row.googleStatus, row.googleAttempts)) return {};
  if (!PLATFORM_EVENT_MAP[row.eventName]) return { googleStatus: "not_applicable" };
  const clickParam = ["gclid", "gbraid", "wbraid"].find(key => row.attribution?.[key]);
  if (!clickParam) return { googleStatus: "not_applicable" };
  // A temporarily missing credential must not discard an accepted request ID.
  if (!googleAuthenticated(env) || !row.googleDestination) return polling ? {} : { googleStatus: "unconfigured" };
  if (polling) {
    if (row.googleNextPollAt && Date.parse(row.googleNextPollAt) > Date.now()) return {};
    const googlePollCount = row.googlePollCount + 1;
    let googleLastError: string | null = null;
    try {
      if (!row.googleRequestId || !row.googleAcceptedAt) throw new Error("Missing request metadata");
      const response = await fetchFn(`${API}/requestStatus:retrieve?requestId=${encodeURIComponent(row.googleRequestId)}`, {
        headers: { Authorization: `Bearer ${await getToken()}` }, signal: AbortSignal.timeout(5000),
      });
      const result = responseObject(response.ok ? await response.json() : null);
      const statuses = result?.requestStatusPerDestination;
      // Each upload contains exactly one event and one frozen destination.
      const status = responseObject(Array.isArray(statuses) && statuses.length === 1 ? statuses[0] : null);
      const returnedDestination = responseObject(status.destination);
      const account = responseObject(returnedDestination.operatingAccount);
      if (account.accountId !== row.googleDestination.operatingAccount.accountId ||
        account.accountType !== "GOOGLE_ADS" ||
        returnedDestination.productDestinationId !== row.googleDestination.productDestinationId) throw new Error("Invalid diagnostics");
      if (status.requestStatus === "SUCCESS") {
        return { googleStatus: "delivered", googlePollCount, googleNextPollAt: null, googleLastError: null };
      }
      if (status.requestStatus === "FAILED") {
        // No records succeeded; another upload uses the same action and transaction ID.
        return { googleStatus: "failed", googlePollCount, googleNextPollAt: null, googleLastError: "Google processing failed; inspect request diagnostics" };
      }
      if (status.requestStatus === "PARTIAL_SUCCESS") {
        return { googleStatus: "review_required", googlePollCount, googleNextPollAt: null,
          googleLastError: "Google returned partial success for one event; inspect request diagnostics before retrying" };
      }
      if (!["PROCESSING", "REQUEST_STATUS_UNKNOWN"].includes(String(status.requestStatus))) throw new Error("Invalid diagnostics");
    } catch {
      googleLastError = "Google status check failed; accepted request retained";
    }
    // Failed reads never cause a fresh upload. Stop after the documented processing window.
    if (googlePollCount >= 25 || Date.now() - Date.parse(row.googleAcceptedAt ?? "") >= DAY_MS) {
      return { googleStatus: "review_required", googlePollCount, googleNextPollAt: null,
        googleLastError: "Google processing unresolved after polling window; inspect request diagnostics" };
    }
    const delay = Math.min(HALF_HOUR_MS * 1.3 ** googlePollCount, 60 * 60 * 1000);
    return { googlePollCount, googleLastError,
      googleNextPollAt: new Date(Date.now() + delay + Math.random() * 1000).toISOString() };
  }
  const googleAttempts = row.googleAttempts + 1;
  try {
    const destination = row.googleDestination;
    if (!/^\d{10}$/.test(destination.operatingAccount.accountId) || !/^\d{10}$/.test(destination.loginAccount.accountId) ||
      !/^\d+$/.test(destination.productDestinationId)) throw new Error("Invalid Google destination");
    const response = await fetchFn(`${API}/events:ingest`, {
      method: "POST", signal: AbortSignal.timeout(5000),
      headers: { "content-type": "application/json", Authorization: `Bearer ${await getToken()}` },
      body: JSON.stringify({ destinations: [destination], events: [{
        transactionId: row.id, eventTimestamp: new Date(row.occurredAt).toISOString(),
        eventSource: row.channel === "web" ? "WEB" : "OTHER",
        adIdentifiers: { [clickParam]: row.attribution![clickParam] },
        consent: { adUserData: row.googleAdUserDataGranted ? "CONSENT_GRANTED" : "CONSENT_STATUS_UNSPECIFIED",
          adPersonalization: "CONSENT_DENIED" },
      }] }),
    });
    const result = responseObject(response.ok ? await response.json() : null);
    if (typeof result?.requestId !== "string" || !result.requestId || result.requestId.length > 512) throw new Error("Delivery rejected");
    return { googleStatus: "processing", googleAttempts, googleRequestId: result.requestId,
      googleAcceptedAt: new Date().toISOString(), googlePollCount: 0,
      googleNextPollAt: new Date(Date.now() + HALF_HOUR_MS).toISOString(), googleLastError: null };
  } catch {
    return { googleStatus: "failed", googleAttempts, googleLastError: "Google upload failed" };
  }
}
