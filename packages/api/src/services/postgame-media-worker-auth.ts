import { createHash, timingSafeEqual } from "node:crypto";

const WORKER_AUTH_SCHEME = "Bearer ";

export function hashPostgameMediaToken(token: string): string {
  return `sha256:${createHash("sha256").update(token).digest("hex")}`;
}

export function secureTokenEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function workerTokenFromAuthorization(value: string | undefined): string | null {
  if (!value?.startsWith(WORKER_AUTH_SCHEME)) return null;
  const token = value.slice(WORKER_AUTH_SCHEME.length).trim();
  return token || null;
}

export function isAuthorizedPostgameMediaWorker(
  authorization: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const received = workerTokenFromAuthorization(authorization);
  const current = env.POSTGAME_MEDIA_WORKER_TOKEN?.trim();
  const previous = env.POSTGAME_MEDIA_WORKER_TOKEN_PREVIOUS?.trim();
  if (!received || !current) return false;

  return secureTokenEquals(received, current)
    || (previous ? secureTokenEquals(received, previous) : false);
}
