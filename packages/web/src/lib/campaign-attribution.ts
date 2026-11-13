/**
 * Campaign attribution for paid acquisition.
 *
 * Supported fields (query parameter -> stored field):
 * - utm_source -> source, utm_medium -> medium, utm_campaign -> campaign
 * - utm_content -> creative (creative/ad identity), utm_term -> audience
 * - gclid, fbclid, msclkid, ttclid, twclid, dclid, gbraid, wbraid -> clickId (+ platform key name in clickIdParam)
 * - landing_variant, onboarding_variant -> landing/onboarding experiment variant
 *   (kept separate from acquisition: experiment assignment is not a campaign touch)
 * - starter_prompt, starter_skill -> starter prompt/skill *identities* only.
 *   Prompt text is never an attribution value and must never be sent here.
 *
 * Retention: the first eligible (non-direct) touch and the latest non-direct
 * touch are kept with timestamps in first-party browser storage. A direct
 * visit (no supported parameter) never overwrites the last non-direct touch.
 * Storage is written only while analytics or advertising permission allows collection; there is
 * no pre-consent queue and earlier touches are never backfilled after consent.
 * Unknown attribution stays explicit: absent fields are omitted, never inferred
 * from IP addresses or fabricated across devices.
 */
export interface CampaignTouch {
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
  touchedAt: string;
}

export interface StoredCampaignAttribution {
  firstTouch: CampaignTouch | null;
  lastNonDirectTouch: CampaignTouch | null;
}

const STORAGE_KEY = "house:campaign-attribution";
const LABEL_VALUE = /^[a-zA-Z0-9_. -]{1,100}$/;
const CLICK_ID_VALUE = /^[a-zA-Z0-9_.-]{1,512}$/;
const CLICK_ID_PARAMS = ["gclid", "fbclid", "msclkid", "ttclid", "twclid", "dclid", "gbraid", "wbraid"] as const;

/** Attribution window used for acquisition reporting: 90 days before signup. */
export const ATTRIBUTION_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

function label(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name);
  return value && LABEL_VALUE.test(value) ? value : undefined;
}

/** Parse one touch from a query string. Returns null for a direct visit. */
export function parseCampaignTouch(search: string, now = new Date()): CampaignTouch | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const touch: CampaignTouch = { touchedAt: now.toISOString() };
  const source = label(params, "utm_source");
  const medium = label(params, "utm_medium");
  const campaign = label(params, "utm_campaign");
  const creative = label(params, "utm_content");
  const audience = label(params, "utm_term");
  if (source) touch.source = source;
  if (medium) touch.medium = medium;
  if (campaign) touch.campaign = campaign;
  if (creative) touch.creative = creative;
  if (audience) touch.audience = audience;
  for (const param of CLICK_ID_PARAMS) {
    const value = params.get(param);
    if (value && CLICK_ID_VALUE.test(value)) {
      touch.clickId = value;
      touch.clickIdParam = param;
      break;
    }
  }
  const landingVariant = label(params, "landing_variant");
  const onboardingVariant = label(params, "onboarding_variant");
  const starterPromptId = label(params, "starter_prompt");
  const starterSkillId = label(params, "starter_skill");
  if (landingVariant) touch.landingVariant = landingVariant;
  if (onboardingVariant) touch.onboardingVariant = onboardingVariant;
  if (starterPromptId) touch.starterPromptId = starterPromptId;
  if (starterSkillId) touch.starterSkillId = starterSkillId;
  const hasCampaignSignal = Boolean(source || campaign || creative || audience || touch.clickId);
  return hasCampaignSignal ? touch : null;
}

function readStored(): StoredCampaignAttribution {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { firstTouch: null, lastNonDirectTouch: null };
    const parsed = JSON.parse(raw) as StoredCampaignAttribution;
    return {
      firstTouch: parsed.firstTouch ?? null,
      lastNonDirectTouch: parsed.lastNonDirectTouch ?? null,
    };
  } catch {
    return { firstTouch: null, lastNonDirectTouch: null };
  }
}

/**
 * Record a touch from the current URL. Call only when analytics consent allows
 * collection. Returns the stored attribution after this touch.
 */
export function retainCampaignTouch(search: string, now = new Date()): StoredCampaignAttribution {
  const stored = readStored();
  const touch = parseCampaignTouch(search, now);
  if (!touch) return stored;
  const next: StoredCampaignAttribution = {
    firstTouch: stored.firstTouch ?? touch,
    lastNonDirectTouch: touch,
  };
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Blocked storage fails closed: attribution stays unknown, never guessed.
  }
  return next;
}

export function getStoredCampaignAttribution(): StoredCampaignAttribution {
  return readStored();
}

export function clearCampaignAttribution(): void {
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
    globalThis.localStorage?.removeItem("house:campaign-account");
  } catch {
    // Nothing to clear when storage is blocked.
  }
}

/** Flat analytics properties for one touch, using canonical utm/click names. */
export function campaignTouchProperties(touch: CampaignTouch | null, prefix = ""): Record<string, string> {
  if (!touch) return {};
  const properties: Record<string, string> = {};
  const put = (name: string, value?: string) => {
    if (value) properties[`${prefix}${name}`] = value;
  };
  put("utm_source", touch.source);
  put("utm_medium", touch.medium);
  put("utm_campaign", touch.campaign);
  put("utm_content", touch.creative);
  put("utm_term", touch.audience);
  if (touch.clickId && touch.clickIdParam) put(touch.clickIdParam, touch.clickId);
  put("landing_variant", touch.landingVariant);
  put("onboarding_variant", touch.onboardingVariant);
  put("starter_prompt", touch.starterPromptId);
  put("starter_skill", touch.starterSkillId);
  put("touch_at", touch.touchedAt);
  return properties;
}

/** Properties attached to browser events so interaction stays attributable. */
export function campaignAttributionProperties(
  stored: StoredCampaignAttribution = readStored(),
): Record<string, string> {
  return {
    ...campaignTouchProperties(stored.lastNonDirectTouch),
    ...campaignTouchProperties(stored.firstTouch, "first_"),
  };
}

/** First-touch acquisition check used by reporting (90-day window). */
export function isWithinAttributionWindow(touch: CampaignTouch | null, at: Date): boolean {
  if (!touch) return false;
  const touched = Date.parse(touch.touchedAt);
  if (Number.isNaN(touched)) return false;
  const age = at.getTime() - touched;
  return age >= 0 && age <= ATTRIBUTION_WINDOW_MS;
}

/** Anonymous acquisition may attach once; never carry another account's attribution across a switch. */
export function bindCampaignAccount(publicId: string | null, persist = true): void {
  try {
    const previous = globalThis.localStorage?.getItem("house:campaign-account");
    if (previous && previous !== publicId) clearCampaignAttribution();
    if (publicId && persist) globalThis.localStorage?.setItem("house:campaign-account", publicId);
    else if (!publicId) globalThis.localStorage?.removeItem("house:campaign-account");
  } catch {
    clearCampaignAttribution();
  }
}
