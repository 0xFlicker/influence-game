import { gamePathSegment } from "./game-links";
import { getPublicRuntimeConfig } from "./server-runtime-config";
import type {
  GameDetail,
  GameWatchReplayFrame,
  HouseHighlightsResponse,
  PublicPlayerProfileEnvelope,
  PublicPostgameMediaResponse,
  TranscriptEntry,
} from "./api";

const DEFAULT_SERVER_API_TIMEOUT_MS = 8_000;

export class ServerApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ServerApiError";
  }
}

export function resolveServerApiUrl(pathOrUrl: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  if (pathOrUrl.startsWith("/")) {
    const configured =
      process.env.API_BACKEND_URL?.trim()
      || getPublicRuntimeConfig().API_URL
      || "http://127.0.0.1:3000";
    return `${configured.replace(/\/$/, "")}${pathOrUrl}`;
  }

  return pathOrUrl;
}

export async function serverApiFetch<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const isFormData = options?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    Accept: "application/json",
    ...(options?.headers as Record<string, string> | undefined),
  };
  const timeout = timeoutSignal(options?.signal);
  try {
    const res = await fetch(resolveServerApiUrl(path), {
      ...options,
      headers,
      signal: timeout.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new ServerApiError(res.status, text);
    }
    return res.json() as Promise<T>;
  } finally {
    timeout.cancel();
  }
}

function timeoutSignal(
  existingSignal: AbortSignal | null | undefined,
): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_SERVER_API_TIMEOUT_MS);

  if (existingSignal?.aborted) {
    controller.abort();
  }

  const abortFromExisting = () => controller.abort();
  existingSignal?.addEventListener("abort", abortFromExisting, { once: true });

  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timeoutId);
      existingSignal?.removeEventListener("abort", abortFromExisting);
    },
  };
}

export function getServerGame(
  gameIdOrSlug: string,
  options?: RequestInit,
): Promise<GameDetail> {
  return serverApiFetch(
    `/api/games/${gamePathSegment(gameIdOrSlug)}`,
    { cache: "no-store", ...options },
  );
}

export function getServerGameTranscript(
  gameIdOrSlug: string,
  options?: RequestInit,
): Promise<TranscriptEntry[]> {
  return serverApiFetch(
    `/api/games/${gamePathSegment(gameIdOrSlug)}/transcript`,
    { cache: "no-store", ...options },
  );
}

export function getServerGameReplayWatchFrames(
  gameIdOrSlug: string,
  options?: RequestInit,
): Promise<GameWatchReplayFrame[]> {
  return serverApiFetch(
    `/api/games/${gamePathSegment(gameIdOrSlug)}/replay-watch-frames`,
    { cache: "no-store", ...options },
  );
}

export function getServerPostgameHighlights(
  gameIdOrSlug: string,
  options?: RequestInit,
): Promise<HouseHighlightsResponse> {
  return serverApiFetch(
    `/api/games/${gamePathSegment(gameIdOrSlug)}/postgame/highlights`,
    options,
  );
}

export function getServerPostgameMedia(
  gameIdOrSlug: string,
  options?: RequestInit,
): Promise<PublicPostgameMediaResponse> {
  return serverApiFetch(
    `/api/games/${gamePathSegment(gameIdOrSlug)}/postgame/media`,
    options,
  );
}

export function getServerPublicPlayerProfile(
  identifier: string,
): Promise<PublicPlayerProfileEnvelope> {
  return serverApiFetch(
    `/api/players/${encodeURIComponent(identifier)}`,
    { cache: "no-store" },
  );
}
