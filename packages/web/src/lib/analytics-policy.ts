/** Reviewed for ordinary, non-sensitive product analytics; see docs/product-analytics.md. */
export function analyticsMode(country: string | null): "opt-out" | "opt-in" {
  return country === "US" || country === "AU" ? "opt-out" : "opt-in";
}

export type AnalyticsChoice = { analytics: boolean };

export function parseAnalyticsChoice(raw: string | null): AnalyticsChoice | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || typeof value.analytics !== "boolean") return null;
    return { analytics: value.analytics };
  } catch { return null; }
}

export function analyticsPermission(country: string | null, choice: AnalyticsChoice | null, blocked: boolean) {
  const analytics = !blocked && (choice?.analytics ?? analyticsMode(country) === "opt-out");
  return { analytics, recordings: analytics && choice?.analytics === true };
}

export function countryFromCloudflare(headers: Headers): string | null {
  // Cloudflare overwrites these on proxied requests. Never infer country from
  // Accept-Language, timezone, or a client-supplied query parameter.
  const country = headers.get("cf-ipcountry");
  if (!headers.get("cf-ray") || !country || !/^[A-Z]{2}$/.test(country) || country === "XX") return null;
  return country;
}
