import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { isSignupCampaignLinkCode, SHARE_CODE_PATTERN, SIGNUP_CAMPAIGN_CODE_PATTERN } from "@influence/engine/house-share-target";
import { schema, type DrizzleDB } from "../db/index.js";
import { readSignupCampaignSharePath } from "./house-share-links.js";

type Transaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
const DAY = 86_400_000n;
const CAMPAIGN_TTL_SECONDS = 86_400;
export const CAMPAIGN_COOKIE = "house_signup_campaign";
const CODE = SIGNUP_CAMPAIGN_CODE_PATTERN;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export class SignupAdmissionError extends Error {
  constructor(readonly code: string, message: string, readonly status: 403 | 429 | 503, readonly nextAvailableAt?: string) {
    super(message);
  }
}

type Bucket = { rate: string; balance: string; updated_ms: string; now_ms: string };
type Executor = Pick<DrizzleDB, "execute">;
const clockMs = sql`floor(extract(epoch from clock_timestamp()) * 1000)::bigint`;

async function readBucket(db: Executor, lock: boolean) {
  if (lock) {
    await db.execute(sql`INSERT INTO signup_bucket (rate, balance, updated_ms)
      VALUES (25, 25 * ${DAY.toString()}::bigint, ${clockMs}) ON CONFLICT (id) DO NOTHING`);
  }
  const [stored] = await db.execute<Bucket>(sql`SELECT rate, balance, updated_ms, ${clockMs} AS now_ms
    FROM signup_bucket WHERE id = true ${lock ? sql`FOR UPDATE` : sql``}`);
  if (!stored) return { rate: 25, balance: 25n * DAY, now: 0n };
  // The lock may have had to wait. Sample the refill clock after acquiring it.
  const [elapsed] = lock ? await db.execute<{ now_ms: string }>(sql`SELECT ${clockMs} AS now_ms`) : [stored];
  const observed = BigInt(elapsed!.now_ms);
  const updated = BigInt(stored.updated_ms);
  const now = observed > updated ? observed : updated;
  const filled = BigInt(stored.balance) + (now - BigInt(stored.updated_ms)) * BigInt(stored.rate);
  const capacity = DAY * BigInt(stored.rate);
  return { rate: Number(stored.rate), balance: filled < capacity ? filled : capacity, now };
}

function availability(bucket: Awaited<ReturnType<typeof readBucket>>) {
  const rate = BigInt(bucket.rate);
  const delay = bucket.balance >= DAY ? 0n : (DAY - bucket.balance + rate - 1n) / rate;
  return { available: delay === 0n, nextAvailableAt: delay ? new Date(Number(bucket.now + delay)).toISOString() : null };
}

async function writeBucket(tx: Transaction, rate: number, balance: bigint, now: bigint) {
  await tx.execute(sql`UPDATE signup_bucket SET rate = ${String(rate)}::bigint, balance = ${balance.toString()}::numeric,
    updated_ms = ${now.toString()}::bigint WHERE id = true`);
}

export async function changeSignupRate(db: DrizzleDB, rate: number) {
  return db.transaction(async tx => {
    const bucket = await readBucket(tx, true);
    const capacity = BigInt(rate) * DAY;
    const balance = bucket.balance < capacity ? bucket.balance : capacity;
    await writeBucket(tx, rate, balance, bucket.now);
    return { rate, ...availability({ ...bucket, rate, balance }) };
  });
}

export async function signupAvailability(db: Executor, campaignToken?: string) {
  const bucket = await readBucket(db, false);
  const [session] = campaignToken && CODE.test(campaignToken)
    ? await db.execute(sql`SELECT 1 FROM signup_campaign_sessions
      WHERE digest = ${digest(campaignToken)} AND expires_at > clock_timestamp()`)
    : [];
  return { rate: bucket.rate, ...(session ? { available: true, nextAvailableAt: null } : availability(bucket)) };
}

export async function admitSignup(tx: Transaction, proofDigest: string, campaignToken?: string) {
  await tx.execute(sql`DELETE FROM signup_human_proofs WHERE expires_at <= clock_timestamp()`);
  const [proof] = await tx.execute(sql`INSERT INTO signup_human_proofs (digest, expires_at)
    VALUES (${proofDigest}, clock_timestamp() + interval '10 minutes') ON CONFLICT DO NOTHING RETURNING digest`);
  if (!proof) throw new SignupAdmissionError("SIGNUP_VERIFICATION_REQUIRED", "Complete a fresh human verification.", 403);
  if (campaignToken && CODE.test(campaignToken)) {
    const [session] = await tx.execute(sql`DELETE FROM signup_campaign_sessions
      WHERE digest = ${digest(campaignToken)} AND expires_at > clock_timestamp() RETURNING digest`);
    if (session) return;
  }
  const bucket = await readBucket(tx, true);
  if (bucket.balance < DAY) {
    throw new SignupAdmissionError("SIGNUP_LIMIT_REACHED", "Signups are full.", 429, availability(bucket).nextAvailableAt!);
  }
  await writeBucket(tx, bucket.rate, bucket.balance - DAY, bucket.now);
}

export async function createSignupCampaign(db: DrizzleDB, label: string, startsAt: Date, endsAt: Date) {
  const code = randomBytes(32).toString("base64url");
  const [campaign] = await db.execute<{ id: string }>(sql`INSERT INTO signup_campaigns (label, link_digest, starts_at, ends_at)
    VALUES (${label}, ${digest(code)}, ${startsAt.toISOString()}, ${endsAt.toISOString()}) RETURNING id`);
  return { id: campaign!.id, code };
}

export async function issueCampaignSession(db: DrizzleDB, code: unknown, existingToken?: string) {
  if (!isSignupCampaignLinkCode(code)) return null;
  return db.transaction(async tx => {
    let match = sql`link_digest = ${digest(code)}`;
    if (SHARE_CODE_PATTERN.test(code)) {
      const [link] = await tx.select({ path: schema.houseShareLinks.path }).from(schema.houseShareLinks)
        .where(eq(schema.houseShareLinks.code, code));
      const target = link && readSignupCampaignSharePath(link.path);
      if (!target) return null;
      match = sql`id = ${target.campaignId}`;
    }
    await tx.execute(sql`DELETE FROM signup_campaign_sessions WHERE expires_at <= clock_timestamp()`);
    const [campaign] = await tx.execute<{ id: string }>(sql`SELECT id FROM signup_campaigns
      WHERE ${match} AND closed_at IS NULL
      AND starts_at <= clock_timestamp() AND ends_at > clock_timestamp() FOR SHARE`);
    if (!campaign) return null;
    if (existingToken && CODE.test(existingToken)) {
      const [existing] = await tx.execute(sql`SELECT 1 FROM signup_campaign_sessions
        WHERE digest = ${digest(existingToken)} AND expires_at > clock_timestamp()`);
      if (existing) return { existing: true } as const;
    }
    const token = randomBytes(32).toString("base64url");
    await tx.execute(sql`INSERT INTO signup_campaign_sessions (digest, campaign_id, expires_at)
      VALUES (${digest(token)}, ${campaign.id}, clock_timestamp() + ${CAMPAIGN_TTL_SECONDS} * interval '1 second')`);
    return { existing: false, token, maxAge: CAMPAIGN_TTL_SECONDS } as const;
  });
}

export async function pruneSignupCredentials(db: Executor) {
  await Promise.all([
    db.execute(sql`DELETE FROM signup_campaign_sessions WHERE expires_at <= clock_timestamp()`),
    db.execute(sql`DELETE FROM signup_human_proofs WHERE expires_at <= clock_timestamp()`),
  ]);
}

export async function verifySignupHuman(token: string): Promise<string> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const webUrl = URL.parse(process.env.WEB_BASE_URL ?? "");
  if (!secret || !webUrl?.hostname || (webUrl.protocol !== "https:" && webUrl.protocol !== "http:")) throw unavailable();
  const body = new URLSearchParams({ secret, response: token });
  let result: { success?: boolean; hostname?: string; action?: string; "error-codes"?: string[] };
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", body, signal: AbortSignal.timeout(5_000), redirect: "error",
    });
    if (!response.ok) throw unavailable();
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") throw unavailable();
    result = payload;
  } catch {
    throw unavailable();
  }
  if (Array.isArray(result["error-codes"]) && result["error-codes"].includes("internal-error")) throw unavailable();
  if (result.success !== true || result.hostname !== webUrl.hostname || result.action !== "house_signup") {
    throw new SignupAdmissionError("SIGNUP_VERIFICATION_REQUIRED", "Complete a fresh human verification.", 403);
  }
  return digest(token);
}

function unavailable() {
  return new SignupAdmissionError("SIGNUP_VERIFICATION_UNAVAILABLE", "Human verification is temporarily unavailable. Try again.", 503);
}
