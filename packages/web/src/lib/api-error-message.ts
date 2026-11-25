export function apiErrorMessage(status: number, body: string, contentType: string | null): string {
  if (status >= 500 || /^(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType ?? "") || body.trimStart().startsWith("<")) {
    return `Request failed (HTTP ${status}).`;
  }
  return body || `Request failed (HTTP ${status}).`;
}

export async function readApiErrorBody(response: Response, structured = false): Promise<string> {
  const mime = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (response.status >= 500 && !(structured && (mime === "application/json" || mime?.endsWith("+json")))) {
    void response.body?.cancel().catch(() => undefined);
    return "";
  }
  return response.text().catch(() => response.statusText);
}
