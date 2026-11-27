import { errorDigest, releaseSha, safeErrorField, uuid } from "@influence/engine/operational-errors";

const origin = "https://thehouse.game";
const types = new Set(["Error", "TypeError", "ReferenceError", "SyntaxError", "RangeError", "URIError",
  "EvalError", "AggregateError", "DOMException", "ApiError", "AbortError", "SecurityError", "NetworkError", "QuotaExceededError"]);
export type ErrorSource = "window_error" | "unhandled_rejection" | "route_boundary" | "root_boundary" | "runtime_config" | "game_socket_closed" | "game_socket_message";
type Frame = { filename: string; lineno: number; colno: number; chunk_id?: string; platform: "web:javascript"; in_app: true };
type ErrorLocation = { filename: string; lineno: number; colno: number };

export function diagnosticRoute(path: string): string {
  if (path === "/") return "/";
  if (/^\/season-\d+\/create\/?$/.test(path)) return "/season-:number/create";
  for (const route of ["/agents/create", "/dashboard", "/privacy", "/games", "/rules"]) {
    if (path === route || path === route + "/") return route;
  }
  for (const group of ["/games", "/agents", "/profile", "/embed", "/dashboard", "/seasons"]) {
    if (path.startsWith(group + "/")) return group + "/:page";
  }
  return "other";
}

function frame(value: ErrorLocation): Frame | undefined {
  const { filename, lineno, colno } = value;
  if (!Number.isSafeInteger(lineno) || lineno < 1 || !Number.isSafeInteger(colno) || colno < 0) return;
  if (!/^(?:https:\/\/thehouse\.game\/|\/|\.\/)?_next\/static\//.test(filename)) return;
  const url = new URL(filename, origin);
  // Turbopack's production client chunks use content hashes. Restrict the
  // filename slot too, since thrown objects can carry user-controlled stacks.
  if (!/^\/_next\/static\/chunks\/(?:turbopack-)?[a-f0-9]{16}\.js$/.test(url.pathname) ||
    filename.split(/[?#]/, 1)[0].includes("..")) return;
  return { filename: origin + url.pathname, lineno, colno, platform: "web:javascript", in_app: true };
}

function stackFrames(stack: string): Frame[] {
  // V8/Bun "at f (url:line:col)" and WebKit/Firefox "f@url:line:col".
  return stack.slice(0, 24_000).split("\n").flatMap(line => {
    if (!/^\s*at\s+/.test(line) && !line.includes("@")) return [];
    const match = line.match(/(?:^|[ (@])([^\s()@]+):(\d+):(\d+)\)?\s*$/);
    if (!match) return [];
    const location = frame({ filename: match[1], lineno: Number(match[2]), colno: Number(match[3]) });
    return location ? [location] : [];
  }).slice(0, 30);
}

function classify(type: string, message: string, source: ErrorSource, digest?: string): [string, string] {
  if (digest) return ["server_render", "A server-rendered page failed."];
  if (source === "runtime_config") return ["runtime_config_failed", "Browser runtime configuration could not load."];
  if (source === "game_socket_closed") return ["game_socket_disconnected", "The live game connection closed unexpectedly."];
  if (source === "game_socket_message") return ["game_socket_message_failed", "The browser could not process a live game message."];
  if (/^(?:ResizeObserver loop limit exceeded|ResizeObserver loop completed with undelivered notifications)\.?$/.test(message)) {
    return ["resize_observer_loop", "ResizeObserver could not deliver all notifications."];
  }
  if (/^(?:ChunkLoadError\b|Loading chunk\b|Failed to load chunk\b|Failed to fetch dynamically imported module\b|Importing a module script failed\b|error loading dynamically imported module\b|Load failed for module\b)/i.test(message)) {
    return ["chunk_load_failed", "A web application bundle could not load."];
  }
  if (type === "TypeError" && /^(?:Cannot read propert(?:y|ies) of (?:null|undefined)|(?:null|undefined) is not an object|can't access property)/i.test(message)) {
    return ["nullish_property_access", "Code tried to read a property from a missing value."];
  }
  if (type === "SecurityError" || type === "QuotaExceededError") return ["browser_access_failed", "The browser rejected access to a capability or storage."];
  if (/^Script error\.?$/.test(message)) return ["opaque_script_error", "The browser withheld script error details."];
  if (type === "SyntaxError") return ["syntax_error", "JavaScript or JSON could not be parsed."];
  if (type === "ReferenceError") return ["reference_error", "JavaScript referenced a value that was unavailable."];
  if (type === "TypeError") return ["type_error", "JavaScript received a value of an unexpected type."];
  if (source === "unhandled_rejection") return ["unhandled_rejection", "A browser promise was rejected without a handler."];
  return ["browser_error", "An unexpected error interrupted the web application."];
}

/** Build the payload from controlled fields before handing anything to the SDK. */
export function browserDiagnostic(error: unknown, source: ErrorSource, pathname: string, location?: ErrorLocation) {
  const stack = safeErrorField(error, "stack");
  const digest = errorDigest(error);
  const name = safeErrorField(error, "name");
  const type = !digest && name && types.has(name) ? name : "Error";
  const message = digest ? "" : typeof error === "string" ? error : safeErrorField(error, "message") ?? "";
  const [code, summary] = classify(type, message.slice(0, 300), source, digest);
  const frames = stack && !digest ? stackFrames(stack) : [];
  const fallback = location && !digest ? frame(location) : undefined;
  if (!frames.length && fallback) frames.push(fallback);
  const route = diagnosticRoute(pathname);
  const noFramesReason = digest ? "server_render" : code === "opaque_script_error" ? "browser_withheld_details"
    : stack || location?.filename ? "no_first_party_coordinates" : "stack_unavailable";
  return {
    type, summary, frames: frames.reverse(), properties: {
      error_source: source, error_code: code, error_summary: summary, diagnostic_route: route,
      release_sha: releaseSha(process.env.NEXT_PUBLIC_GIT_SHA) ?? "unknown",
      ...(digest ? { error_digest: digest } : {}),
      ...(frames.length ? {} : { no_frames_reason: noFramesReason }),
    },
  };
}

const sdkFields = ["distinct_id", "$device_id", "$user_id", "$session_id", "$window_id", "$browser", "$browser_version",
  "$os", "$os_version", "$device_type", "$lib", "$lib_version", "$insert_id", "$is_identified", "$process_person_profile"];

/** Keep SDK session and device identifiers while dropping implicit URLs and arbitrary SDK properties. */
export function diagnosticSdkContext(properties: Record<string, unknown>) {
  return Object.fromEntries(sdkFields.flatMap(key => {
    const value = properties[key];
    return typeof value === "boolean" || typeof value === "number" ||
      (typeof value === "string" && /^[\w. ()+-]{1,100}$/.test(value)) ? [[key, value]] : [];
  }));
}

/** Defensive frame cleanup after the SDK adds native Turbopack debug IDs. */
export function sdkExceptionFrames(list: unknown): Frame[] {
  const input = Array.isArray(list) ? list[0]?.stacktrace?.frames : undefined;
  if (!Array.isArray(input)) return [];
  return input.slice(-30).flatMap(value => {
    if (!value || typeof value.filename !== "string") return [];
    const clean = frame(value);
    const chunk = uuid(value.chunk_id);
    return clean ? [{ ...clean, ...(chunk ? { chunk_id: chunk } : {}) }] : [];
  });
}
