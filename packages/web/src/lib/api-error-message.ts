export function apiErrorMessage(status: number, body: string, contentType: string | null): string {
  if (/^(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType ?? "") || body.trimStart().startsWith("<")) {
    return status >= 500 ? "The service is temporarily unavailable." : `Request failed (HTTP ${status}).`;
  }
  return body || `Request failed (HTTP ${status}).`;
}
