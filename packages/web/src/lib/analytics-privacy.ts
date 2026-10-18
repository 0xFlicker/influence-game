/** Scrub SDK-generated acquisition properties, including nested $set/$set_once. */
export function sanitizeAnalyticsProperties(properties: Record<string, unknown>): void {
  for (const key of Object.keys(properties)) {
    const value = properties[key];
    if (/url|referrer/i.test(key) && typeof value === "string") {
      try {
        const url = new URL(value);
        properties[key] = key.includes("referrer") ? url.origin : `${url.origin}${url.pathname}`;
      } catch { delete properties[key]; }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      sanitizeAnalyticsProperties(value as Record<string, unknown>);
    }
  }
}
