const errorTypes = new Set([
  "Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError",
  "URIError", "EvalError", "AggregateError", "DOMException", "ApiError",
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Keep symbolication coordinates without frame locals or source snippets. */
function scrubFrame(value: unknown): Record<string, unknown> | null {
  const frame = record(value);
  if (typeof frame.filename !== "string") return null;
  let url: URL;
  try { url = new URL(frame.filename); } catch { return null; }
  // Only our compiled assets are useful for this browser integration. Page URLs,
  // extension scripts and arbitrary paths can embed user-controlled text.
  if (url.origin !== "https://thehouse.game" || !/^\/_next\/static\/[a-zA-Z0-9_./\[\]()-]+\.js$/.test(url.pathname)) return null;
  const clean: Record<string, unknown> = {
    platform: "web:javascript", filename: `${url.origin}${url.pathname}`, in_app: true,
  };
  for (const key of ["lineno", "colno"]) {
    if (typeof frame[key] === "number" && Number.isSafeInteger(frame[key]) && frame[key] >= 0) clean[key] = frame[key];
  }
  if (typeof frame.chunk_id === "string" && uuid.test(frame.chunk_id)) clean.chunk_id = frame.chunk_id;
  return clean;
}

function scrubExceptionMessage(message: string): string {
  return message
    // Some renderer errors append the entire invalid record, which can contain dialogue or strategy.
    .replace(/((?:Unsupported visual presentation|Unsupported format presentation cue|Unhandled completed-results format scoring): )\{[\s\S]*$/, "$1[redacted]")
    .replace(/(\bUnexpected token .+?,\s*)"[^\n]*"(?:\.{3})?(\s+is not valid JSON)/g, "$1[redacted]$2")
    .replace(/\bhttps?:\/\/[^\s<>"'`()[\]{}]+/gi, url =>
      url.replace(/^(https?:\/\/)[^/?#]*@/i, "$1").split(/[?#]/, 1)[0])
    .replace(/(^|[\s"'`(])((?:\/\/[^\s/?#<>"'`()[\]{}]+)?\/[^\s?#<>"'`()[\]{}]*)[?#][^\s<>"'`()[\]{}]+/g, "$1$2")
    .replace(/(\b(?:authorization|password|(?:access[_ -]?|refresh[_ -]?|id[_ -]?)?token|oauth[_ -]?code|authorization[_ -]?code|api[_ -]?key|client[_ -]?secret)\b["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:(?:Bearer|Basic)\s+)?[^\s,;<>()[\]{}]+)/gi, "$1[redacted]")
    .replace(/\b(Bearer)\s+[^\s,;"'<>()[\]{}]+/gi, "$1 [redacted]")
    .replace(/(\b(?:prompt|strategy|request[_ -]?body|response[_ -]?body)\b["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\r\n]+)/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted]")
    .replace(/\b0x[0-9a-f]{40}\b/gi, "[redacted]");
}

export function scrubExceptionProperties(properties: Record<string, unknown>, includeMessages: boolean): void {
  const exceptions = Array.isArray(properties.$exception_list) ? properties.$exception_list : [];
  // Remove all SDK exception derivatives too: values, fingerprints, raw stacks,
  // step breadcrumbs and future exception properties must not bypass the list.
  for (const key of Object.keys(properties)) {
    if (key.startsWith("$exception")) delete properties[key];
  }
  properties.$exception_list = exceptions.slice(0, 10).map(value => {
    const exception = record(value);
    const mechanism = record(exception.mechanism);
    const frames = record(exception.stacktrace).frames;
    const cleanMechanism: Record<string, unknown> = { type: "generic" };
    for (const key of ["handled", "synthetic"]) {
      if (typeof mechanism[key] === "boolean") cleanMechanism[key] = mechanism[key];
    }
    for (const key of ["exception_id", "parent_id"]) {
      if (typeof mechanism[key] === "number" && Number.isSafeInteger(mechanism[key])) cleanMechanism[key] = mechanism[key];
    }
    return {
      type: typeof exception.type === "string" && errorTypes.has(exception.type) ? exception.type : "Error",
      value: includeMessages && typeof exception.value === "string"
        ? scrubExceptionMessage(exception.value)
        : "Error details redacted",
      mechanism: cleanMechanism,
      stacktrace: { type: "raw", frames: Array.isArray(frames) ? frames.slice(-50).map(scrubFrame).filter(Boolean) : [] },
    };
  });
  properties.$exception_level = "error";
  if (typeof properties.$release_id !== "string" || !uuid.test(properties.$release_id)) delete properties.$release_id;
}
