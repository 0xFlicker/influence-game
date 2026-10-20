const errorTypes = new Set([
  "Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError",
  "URIError", "EvalError", "AggregateError", "DOMException",
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Keep only symbolication coordinates. Never retain messages, locals or source snippets. */
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

export function scrubExceptionProperties(properties: Record<string, unknown>): void {
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
      value: "Error details redacted",
      mechanism: cleanMechanism,
      stacktrace: { type: "raw", frames: Array.isArray(frames) ? frames.slice(-50).map(scrubFrame).filter(Boolean) : [] },
    };
  });
  properties.$exception_level = "error";
  if (typeof properties.$release_id !== "string" || !uuid.test(properties.$release_id)) delete properties.$release_id;
}
