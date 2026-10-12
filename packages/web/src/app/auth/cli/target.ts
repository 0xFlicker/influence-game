import { parseCliSessionOrigin, parseCliSessionRequest, type CliSessionRequest } from "@influence/engine/cli-session-contract";

export type CliSessionQuery = Record<string, string | string[] | undefined>;

/** Compare a parsed handoff only with targets owned by this web deployment. */
export function authorizeCliSessionTarget(query: CliSessionQuery, configured: {
  webOrigin: string;
  publicApiUrl: string;
  backendAuthUrl: string;
}): CliSessionRequest {
  if (Object.keys(query).some(key => !["api", "callback", "state"].includes(key))) {
    throw new Error("This CLI sign-in request contains unsupported parameters. Restart the CLI.");
  }
  const request = parseCliSessionRequest({ api: query.api, callback: query.callback, state: query.state });
  const allowed = new Set([
    parseCliSessionOrigin(configured.webOrigin),
    // A trusted Docker backend can use internal HTTP. The requested API above
    // still requires HTTPS or loopback HTTP before any origin comparison.
    new URL(configured.backendAuthUrl).origin,
  ]);
  if (configured.publicApiUrl.trim()) allowed.add(parseCliSessionOrigin(configured.publicApiUrl.trim()));
  if (!allowed.has(request.apiOrigin)) {
    throw new Error("This sign-in page is configured for a different API. Restart the CLI with the matching web address.");
  }
  return request;
}

export function cliRequestWebOrigin(requestHeaders: Headers, configuredWebUrl?: string): string {
  if (configuredWebUrl?.trim()) return parseCliSessionOrigin(configuredWebUrl.trim());
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!host) throw new Error("The web address could not be verified. Restart the CLI.");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (process.env.NODE_ENV === "development" ? "http" : "https");
  return parseCliSessionOrigin(`${protocol}://${host}`);
}
