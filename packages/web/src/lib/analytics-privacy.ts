/**
 * Scrub analytics properties without discarding legitimate campaign attribution.
 *
 * Supported attribution (see campaign-attribution.ts) is retained after format
 * validation: utm_source/medium/campaign/content/term, advertising click IDs
 * (gclid, fbclid, msclkid, ttclid, dclid, gbraid, wbraid), landing_variant,
 * onboarding_variant, starter_prompt and starter_skill. These are campaign
 * metadata, not credentials. Click IDs are opaque platform identifiers; they
 * are never OAuth codes, tokens or user content.
 *
 * Still removed: credentials/OAuth codes/prompts in URLs (query/fragment are
 * stripped from every URL/referrer value), non-http(s) values, unlisted utm_*
 * fields, and any attribution value that fails its format check.
 */
const UTM_SUFFIXES = new Set(["source", "medium", "campaign", "content", "term"]);
const CLICK_ID_KEYS = new Set(["gclid", "fbclid", "msclkid", "ttclid", "dclid", "gbraid", "wbraid"]);
const VARIANT_KEYS = new Set(["landing_variant", "onboarding_variant", "starter_prompt", "starter_skill"]);
const LABEL_VALUE = /^[a-zA-Z0-9_. -]{1,100}$/;
const CLICK_ID_VALUE = /^[a-zA-Z0-9_.-]{1,512}$/;

function isAttributionKey(key: string): boolean {
  const normalized = key.replace(/^\$initial_/, "").replace(/^initial_/, "");
  const utmSuffix = normalized.match(/^utm_(.+)$/)?.[1];
  if (utmSuffix) return UTM_SUFFIXES.has(utmSuffix);
  if (CLICK_ID_KEYS.has(normalized)) return true;
  if (VARIANT_KEYS.has(normalized)) return true;
  return /(?:^|_)(gclid|fbclid|msclkid|ttclid|dclid|gbraid|wbraid)$/.test(normalized);
}

function attributionValueValid(key: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = key.replace(/^\$initial_/, "").replace(/^initial_/, "");
  if (/(?:^|_)(gclid|fbclid|msclkid|ttclid|dclid|gbraid|wbraid)$/.test(normalized)) {
    return CLICK_ID_VALUE.test(value);
  }
  return LABEL_VALUE.test(value);
}

/** Scrub SDK-generated properties, including nested $set/$set_once. */
export function sanitizeAnalyticsProperties(properties: Record<string, unknown>): void {
  for (const key of Object.keys(properties)) {
    const value = properties[key];
    const campaign = key.match(/(?:^|_)utm_(.+)$/)?.[1];
    if (campaign && !UTM_SUFFIXES.has(campaign)) {
      delete properties[key];
      continue;
    }
    if (isAttributionKey(key)) {
      if (!attributionValueValid(key, value)) delete properties[key];
      continue;
    }
    if (/(?:^|_)search_keyword$/.test(key)) {
      delete properties[key];
      continue;
    }
    if (/url|referrer/i.test(key) && typeof value === "string") {
      try {
        const url = new URL(value);
        if (!["https:", "http:"].includes(url.protocol)) { delete properties[key]; continue; }
        properties[key] = key.includes("referrer") ? url.origin : `${url.origin}${url.pathname}`;
      } catch { delete properties[key]; }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitizeAnalyticsProperties(value as Record<string, unknown>);
    }
  }
}
