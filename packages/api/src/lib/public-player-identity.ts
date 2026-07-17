import { isPostgresUniqueViolation } from "./postgres-errors.js";

export const PUBLIC_PLAYER_HANDLE_MIN_LENGTH = 3;
export const PUBLIC_PLAYER_HANDLE_MAX_LENGTH = 30;
export const PUBLIC_PLAYER_HANDLE_RESERVED_SET_VERSION = 1 as const;
export const PUBLIC_PLAYER_HANDLE_UNIQUE_CONSTRAINT = "users_handle_lower_unique";

const RESERVED_NAMES_V1 = [
  "about",
  "admin",
  "anonymous",
  "api",
  "dashboard",
  "games",
  "get-mcp",
  "health",
  "house",
  "internal",
  "oauth",
  "privacy",
  "profile",
  "rules",
  "runtime-config",
  "system",
] as const;

export const PUBLIC_PLAYER_HANDLE_RESERVED_NAMES: ReadonlySet<string> =
  new Set(RESERVED_NAMES_V1);

const HANDLE_FORMAT = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OFFSET_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;
const TIMEZONE_FREE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;

export type PublicPlayerHandleValidation =
  | { ok: true; handle: string }
  | {
      ok: false;
      reason:
        | "too_short"
        | "too_long"
        | "noncanonical"
        | "invalid_format"
        | "uuid_shaped"
        | "reserved";
    };

export type PublicIdentityOnboardingState = "complete" | "required" | "deferrable";

export type PublicIdentityOnboardingDiagnosticCode =
  | "created_at_missing"
  | "created_at_invalid"
  | "created_at_timezone_required";

export interface PublicIdentityOnboardingClassification {
  state: PublicIdentityOnboardingState;
  diagnosticCode: PublicIdentityOnboardingDiagnosticCode | null;
}

export type OffsetTimestampParseResult =
  | {
      ok: true;
      epochMilliseconds: number;
      epochMicroseconds: bigint;
    }
  | {
      ok: false;
      reason: "missing" | "invalid" | "timezone_required";
    };

export function normalizePublicPlayerHandle(value: string): string {
  return value.trim().toLowerCase();
}

export function validatePublicPlayerHandle(value: string): PublicPlayerHandleValidation {
  if (isUuidShapedPublicIdentity(value)) {
    return { ok: false, reason: "uuid_shaped" };
  }
  if (value.length < PUBLIC_PLAYER_HANDLE_MIN_LENGTH) {
    return { ok: false, reason: "too_short" };
  }
  if (value.length > PUBLIC_PLAYER_HANDLE_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  if (value !== normalizePublicPlayerHandle(value)) {
    return { ok: false, reason: "noncanonical" };
  }
  if (!HANDLE_FORMAT.test(value)) {
    return { ok: false, reason: "invalid_format" };
  }
  if (PUBLIC_PLAYER_HANDLE_RESERVED_NAMES.has(value)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, handle: value };
}

export function isUuidShapedPublicIdentity(value: string): boolean {
  return UUID_SHAPE.test(value);
}

export function slugifyDisplayNameToHandle(displayName: string): string {
  let base = displayName
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, PUBLIC_PLAYER_HANDLE_MAX_LENGTH)
    .replace(/-+$/g, "");

  if (base.length === 0) {
    base = "player";
  } else if (base.length < PUBLIC_PLAYER_HANDLE_MIN_LENGTH) {
    base = appendHandleToken(base, "player");
  }

  const validation = validatePublicPlayerHandle(base);
  if (!validation.ok && (validation.reason === "reserved" || validation.reason === "uuid_shaped")) {
    return appendHandleToken(base, "player");
  }
  if (!validation.ok) {
    return "player";
  }
  return validation.handle;
}

export async function suggestPublicPlayerHandle(
  displayName: string,
  isAvailable: (candidate: string) => boolean | Promise<boolean>,
  options: {
    maxAttempts?: number;
  } = {},
): Promise<string | null> {
  const maxAttempts = options.maxAttempts ?? 100;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 1_000) {
    throw new RangeError("maxAttempts must be an integer between 1 and 1000");
  }

  const base = slugifyDisplayNameToHandle(displayName);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = attempt === 0
      ? base
      : appendHandleToken(base, String(attempt + 1));
    if (await isAvailable(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function isPublicPlayerHandleConflict(error: unknown): boolean {
  return isPostgresUniqueViolation(error, PUBLIC_PLAYER_HANDLE_UNIQUE_CONSTRAINT);
}

export function parseOffsetTimestamp(
  value: string | null | undefined,
): OffsetTimestampParseResult {
  if (value === null || value === undefined || value === "") {
    return { ok: false, reason: "missing" };
  }

  const match = OFFSET_TIMESTAMP.exec(value);
  if (!match) {
    return {
      ok: false,
      reason: TIMEZONE_FREE_TIMESTAMP.test(value) ? "timezone_required" : "invalid",
    };
  }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = "", zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (!isValidCalendarDate(year, month, day, hour, minute, second)) {
    return { ok: false, reason: "invalid" };
  }

  const offsetMinutes = parseOffsetMinutes(zone!);
  if (offsetMinutes === null) {
    return { ok: false, reason: "invalid" };
  }

  const wholeSecondUtc = Date.UTC(year, month - 1, day, hour, minute, second)
    - (offsetMinutes * 60_000);
  if (!Number.isFinite(wholeSecondUtc)) {
    return { ok: false, reason: "invalid" };
  }

  const fractionalMicroseconds = BigInt(fraction.padEnd(6, "0"));
  const epochMicroseconds = (BigInt(wholeSecondUtc) * 1_000n) + fractionalMicroseconds;
  return {
    ok: true,
    epochMilliseconds: Number(epochMicroseconds) / 1_000,
    epochMicroseconds,
  };
}

export function classifyPublicIdentityOnboarding(input: {
  hasSafeDisplayName: boolean;
  handle: string | null | undefined;
  createdAt: string | null | undefined;
  cutoff: string;
}): PublicIdentityOnboardingClassification {
  if (input.hasSafeDisplayName && input.handle !== null && input.handle !== undefined) {
    return {
      state: "complete",
      diagnosticCode: null,
    };
  }

  const cutoff = parseOffsetTimestamp(input.cutoff);
  if (!cutoff.ok) {
    throw new Error(`Invalid identity launch cutoff: ${cutoff.reason}`);
  }

  const createdAt = parseOffsetTimestamp(input.createdAt);
  if (!createdAt.ok) {
    return {
      state: "required",
      diagnosticCode: createdAt.reason === "missing"
        ? "created_at_missing"
        : createdAt.reason === "timezone_required"
          ? "created_at_timezone_required"
          : "created_at_invalid",
    };
  }

  return {
    state: createdAt.epochMicroseconds < cutoff.epochMicroseconds
      ? "deferrable"
      : "required",
    diagnosticCode: null,
  };
}

function appendHandleToken(base: string, token: string): string {
  const suffix = `-${token}`;
  const availableBaseLength = PUBLIC_PLAYER_HANDLE_MAX_LENGTH - suffix.length;
  const truncatedBase = base
    .slice(0, availableBaseLength)
    .replace(/-+$/g, "");
  return `${truncatedBase || "player"}${suffix}`;
}

function isValidCalendarDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): boolean {
  if (year < 1000 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return utc.getUTCFullYear() === year
    && utc.getUTCMonth() === month - 1
    && utc.getUTCDate() === day
    && utc.getUTCHours() === hour
    && utc.getUTCMinutes() === minute
    && utc.getUTCSeconds() === second;
}

function parseOffsetMinutes(zone: string): number | null {
  if (zone === "Z") {
    return 0;
  }
  const sign = zone[0] === "-" ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = digits.length === 2 ? 0 : Number(digits.slice(2, 4));
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return sign * ((hours * 60) + minutes);
}
