import { customType, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { assertStoredPayload, decodePayloadReference, type StoredPayload } from "../services/payload-storage.js";

/** A reference column cannot serialize a body, and reads mark only real reference columns. */
export function payloadColumn(name: string, codec: StoredPayload["codec"]) {
  return customType<{ data: StoredPayload; driverData: string }>({
    dataType: () => "jsonb",
    toDriver(value) {
      assertStoredPayload(value);
      if (value.codec !== codec) throw new Error("Payload column encoding mismatch");
      return JSON.stringify(value);
    },
    fromDriver(value) {
      const ref = decodePayloadReference(typeof value === "string" ? JSON.parse(value) : value);
      if (ref.codec !== codec) throw new Error("Payload column encoding mismatch");
      return ref;
    },
  })(name);
}

export function payloadChecks(table: string, columns: Record<string, readonly [AnyPgColumn, StoredPayload["codec"]]>) {
  return Object.values(columns).map(([column, codec]) => {
    const sourceColumn = column.name.replace(/_object$/, "");
    const name = `payload_${createHash("sha256").update(`${table}.${sourceColumn}`).digest("hex").slice(0, 12)}_check`;
    return check(name, sql`${column} IS NULL OR ((
      jsonb_typeof(${column}) = 'object'
      AND ${column} ?& ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']
      AND (${column} - ARRAY['storage','key','codec','sha256','byteLength','storedSha256','storedByteLength']) = '{}'::jsonb
      AND ${column}->>'storage' = 'private-payload-v1' AND ${column}->>'codec' = ${codec}
      AND ${column}->>'sha256' ~ '^[a-f0-9]{64}$' AND ${column}->>'storedSha256' ~ '^[a-f0-9]{64}$'
      AND ${column}->>'key' = ${`payloads/v1/${codec}/`} || (${column}->>'sha256')
      AND jsonb_typeof(${column}->'byteLength') = 'number' AND (${column}->>'byteLength')::bigint >= 0
      AND jsonb_typeof(${column}->'storedByteLength') = 'number' AND (${column}->>'storedByteLength')::bigint >= 0
    ) IS TRUE)`);
  });
}
