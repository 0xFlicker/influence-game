export const REQUEST_ID_HEADER = "X-House-Request-Id";
export const FAILURE_HEADER = "X-House-Failure";

export const failureDetails = {
  app_error: ["app", "The House API could not complete the request."],
  app_unavailable: ["app", "The House API is temporarily unavailable."],
  upstream_rejected: ["upstream", "The generation service rejected the request."],
  upstream_transport: ["upstream", "The generation service connection failed."],
  upstream_timeout: ["upstream", "The generation service timed out."],
  upstream_output: ["upstream", "The generation service returned unusable output."],
} as const;
export type ApiFailureCode = keyof typeof failureDetails;

export function uuid(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value) ? value : undefined;
}

export function releaseSha(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{40}$/i.test(value) ? value : undefined;
}

export function safeMethod(method: string): string {
  return /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(method) ? method : "OTHER";
}

export function safeErrorField(error: unknown, key: "name" | "message" | "stack" | "digest"): string | undefined {
  try {
    const value: unknown = error && typeof error === "object" ? Reflect.get(error, key) : undefined;
    return typeof value === "string" ? value : undefined;
  } catch { return undefined; }
}

export function errorDigest(error: unknown): string | undefined {
  const digest = safeErrorField(error, "digest");
  return digest && /^-?\d{1,16}$/.test(digest) ? digest : undefined;
}

/** Private operational logs. Retain repository coordinates without messages, locals or host paths. */
export function operationalError(component: string, code: string, summary: string, error?: unknown, context?: Record<string, unknown>) {
  const stack = safeErrorField(error, "stack");
  const frames = (stack?.slice(0, 24_000).split("\n").slice(1) ?? []).flatMap(line => {
    const coordinate = line.match(/(?:^|[ (])([^\s()]+):(\d+):(\d+)\)?\s*$/);
    if (!coordinate) return [];
    const path = coordinate[1]?.replaceAll("\\", "/");
    if (!path || path.includes("/node_modules/") || path.includes("..")) return [];
    const file = path.match(/(?:^|\/)((?:packages\/(?:api|web|engine)\/src\/|\.next\/server\/|dist\/|src\/|var\/task\/)[\w/.~@\[\]()-]+\.[cm]?[jt]sx?)$/)?.[1];
    return file ? [`${file}:${coordinate[2]}:${coordinate[3]}`] : [];
  }).slice(0, 12);
  const digest = errorDigest(error);
  return {
    component, code, summary, release: releaseSha(process.env.GIT_SHA) ?? "unknown",
    ...context, ...(digest ? { digest } : {}), frames,
    ...(frames.length ? {} : { no_frames_reason: stack ? "no_first_party_coordinates" : "stack_unavailable" }),
  };
}

export function edgeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-f0-9]{16}-[A-Z]{3}$/i.test(value) ? value : undefined;
}
