/** Scrub SDK-generated acquisition properties, including nested $set/$set_once. */
export function sanitizeAnalyticsProperties(properties: Record<string, unknown>): void {
  for (const key of Object.keys(properties)) {
    const value = properties[key];
    const campaign = key.match(/(?:^|_)utm_(.+)$/)?.[1];
    if (campaign && (!['source', 'medium', 'campaign'].includes(campaign)
      || typeof value !== 'string' || !/^[a-zA-Z0-9_. -]{1,100}$/.test(value))) {
      delete properties[key];
      continue;
    }
    if (/(?:^|_)(gclid|fbclid|msclkid|search_keyword)$/.test(key)) {
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
