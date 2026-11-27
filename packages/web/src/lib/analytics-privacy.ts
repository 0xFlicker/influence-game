import { SHARE_CODE_PATTERN } from "@influence/engine/house-share-target";

/**
 * Scrub analytics properties without discarding legitimate campaign attribution.
 *
 * Supported attribution (see campaign-attribution.ts) is retained after format
 * validation: utm_source/medium/campaign/content/term, advertising click IDs
 * (gclid, fbclid, msclkid, ttclid, twclid, dclid, gbraid, wbraid), landing_variant,
 * onboarding_variant, starter_prompt and starter_skill. These are campaign
 * metadata, not credentials. Click IDs are opaque platform identifiers; they
 * are never OAuth codes, tokens or user content.
 *
 * Still removed: credentials/OAuth codes/prompts in URLs (query/fragment are
 * stripped from every URL/referrer value), non-http(s) values, unlisted utm_*
 * fields, and any attribution value that fails its format check.
 */
const EMAIL_FIELD = /(?:^|[_-])e[_-]?mail(?:[_-]?(?:address|hash))?(?:$|[_-])/i;
const EMAIL_TEXT = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+(?:@|%40)[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const redactEmail = (value: string) => value.replace(EMAIL_TEXT, "[redacted]");

const UTM_SUFFIXES = new Set(["source", "medium", "campaign", "content", "term"]);
const CLICK_ID_KEYS = new Set(["gclid", "fbclid", "msclkid", "ttclid", "twclid", "dclid", "gbraid", "wbraid"]);
const VARIANT_KEYS = new Set(["landing_variant", "onboarding_variant", "starter_prompt", "starter_skill"]);
const LABEL_VALUE = /^[a-zA-Z0-9_. -]{1,100}$/;
const CLICK_ID_VALUE = /^[a-zA-Z0-9_.-]{1,512}$/;

function redactShareCode(path: string) {
  return path.startsWith("/s/") && SHARE_CODE_PATTERN.test(path.slice(3)) ? "/s/[code]" : path;
}

function isAttributionKey(key: string): boolean {
  const normalized = key.replace(/^\$initial_/, "").replace(/^initial_/, "");
  const utmSuffix = normalized.match(/^utm_(.+)$/)?.[1];
  if (utmSuffix) return UTM_SUFFIXES.has(utmSuffix);
  if (CLICK_ID_KEYS.has(normalized)) return true;
  if (VARIANT_KEYS.has(normalized)) return true;
  return /(?:^|_)(gclid|fbclid|msclkid|ttclid|twclid|dclid|gbraid|wbraid)$/.test(normalized);
}

function attributionValueValid(key: string, value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = key.replace(/^\$initial_/, "").replace(/^initial_/, "");
  if (/(?:^|_)(gclid|fbclid|msclkid|ttclid|twclid|dclid|gbraid|wbraid)$/.test(normalized)) {
    return CLICK_ID_VALUE.test(value);
  }
  return LABEL_VALUE.test(value);
}

/** Scrub SDK-generated properties, including nested $set/$set_once. */
export function sanitizeAnalyticsProperties(properties: Record<string, unknown>): void {
  for (const key of Object.keys(properties)) {
    const value = properties[key];
    if (EMAIL_FIELD.test(key.replace(/([a-z0-9])([A-Z])/g, "$1_$2"))) {
      delete properties[key];
      continue;
    }
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
        properties[key] = key.includes("referrer") ? url.origin : `${url.origin}${redactShareCode(url.pathname).split("/").map(redactEmail).join("/")}`;
      } catch { delete properties[key]; }
    } else if (key === "$pathname" && typeof value === "string") {
      properties[key] = redactEmail(redactShareCode(value));
    } else if (typeof value === "string") {
      properties[key] = redactEmail(value);
    } else if (Array.isArray(value)) {
      properties[key] = value.map(entry => {
        if (typeof entry === "string") return redactEmail(entry);
        if (entry && typeof entry === "object") sanitizeAnalyticsProperties(entry as Record<string, unknown>);
        return entry;
      });
    } else if (value && typeof value === "object") {
      sanitizeAnalyticsProperties(value as Record<string, unknown>);
    }
  }
}
