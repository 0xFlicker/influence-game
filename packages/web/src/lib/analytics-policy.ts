/** Regional product policy; see docs/product-analytics.md for scope and limitations. */
export function analyticsMode(country: string | null): "opt-out" | "opt-in" {
  return country === "US" ? "opt-out" : "opt-in";
}

export type AnalyticsChoice = { analytics: boolean; advertising?: boolean };

export function parseAnalyticsChoice(raw: string | null): AnalyticsChoice | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (![1, 2].includes(value?.version) || typeof value.analytics !== "boolean") return null;
    if (value.version === 2 && typeof value.advertising !== "boolean") return null;
    return { analytics: value.analytics, advertising: value.version === 2 ? value.advertising : value.analytics ? undefined : false };
  } catch { return null; }
}

export function analyticsPermission(country: string | null, choice: AnalyticsChoice | null, blocked: boolean) {
  const analytics = !blocked && (choice?.analytics ?? analyticsMode(country) === "opt-out");
  const advertising = !blocked && (choice?.advertising ?? analyticsMode(country) === "opt-out");
  return { analytics, advertising, recordings: analytics };
}

export type AnalyticsNotice = { seen: boolean; path: string | null };
export function visitAnalyticsNotice(notice: AnalyticsNotice, pathname: string): AnalyticsNotice {
  if (!notice.seen) return { seen: true, path: pathname };
  if (notice.path !== null && notice.path !== pathname) return { seen: true, path: null };
  return notice;
}

export function countryFromCloudflare(headers: Headers): string | null {
  // Cloudflare overwrites these on proxied requests. Never infer country from
  // Accept-Language, timezone, or a client-supplied query parameter.
  const country = headers.get("cf-ipcountry");
  if (!headers.get("cf-ray") || !country || !/^[A-Z]{2}$/.test(country) || country === "XX") return null;
  return country;
}
