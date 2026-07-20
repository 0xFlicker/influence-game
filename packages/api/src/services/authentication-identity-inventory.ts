import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import { normalizeVerifiedEmail } from "../lib/verified-email.js";
import { isImportedSyntheticPlayer } from "./public-player-identity.js";
import {
  classifyPrivyUser,
  verifiedWalletAddresses,
  type VerifiedProviderEvidence,
} from "./authentication-providers.js";

export const INVENTORY_RESULT_VERSION = "authentication-identity-inventory/v1";
const CHECKPOINT_VERSION = 1;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 3;

export type AuthenticationIdentityInventoryMode =
  | "dry-run"
  | "write"
  | "final-delta";

export type InventoryIssueCode =
  | "ambiguous_identity_mapping"
  | "credential_mapping_conflict"
  | "dual_write_invariant_failed"
  | "final_delta_drift"
  | "incomplete_pagination"
  | "multiple_active_email_claims"
  | "ordinary_user_missing_credential"
  | "provider_page_retry_exhausted"
  | "unclassified_privy_identity"
  | "unmapped_privy_identity"
  | "user_email_metadata_mismatch";

export interface InventoryIssue {
  code: InventoryIssueCode;
  ref: string;
}

export interface InventoryCounts {
  providerIdentities: number;
  providerOnlyIdentities: number;
  mappedIdentities: number;
  credentialsInserted: number;
  activeClaimsInserted: number;
  claimsConvertedToConflict: number;
  conflictClaimsRetained: number;
  nonAuthenticatableUsers: number;
  ordinaryUsersWithoutCredential: number;
}

export interface AuthenticationIdentityInventoryResult {
  version: typeof INVENTORY_RESULT_VERSION;
  mode: AuthenticationIdentityInventoryMode;
  status: "ready" | "blocked";
  complete: boolean;
  batches: number;
  counts: InventoryCounts;
  issues: InventoryIssue[];
}

export interface PrivyInventoryPage {
  users: unknown[];
  nextCursor: string | null;
}

export interface PrivyInventoryPageSource {
  getPage(cursor: string | null, limit: number): Promise<PrivyInventoryPage>;
}

export interface InventoryCheckpoint {
  version: typeof CHECKPOINT_VERSION;
  cursor: string | null;
  batches: number;
  complete: boolean;
  counts: InventoryCounts;
}

export interface InventoryCheckpointStore {
  load(): Promise<InventoryCheckpoint | null>;
  save(checkpoint: InventoryCheckpoint): Promise<void>;
  delete(): Promise<void>;
}

export interface AuthenticationIdentityInventoryOptions {
  mode: AuthenticationIdentityInventoryMode;
  pageSource: PrivyInventoryPageSource;
  checkpointStore: InventoryCheckpointStore;
  hmacKey: string;
  maxRetries?: number;
  pageSize?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Test seam used to prove a failed batch rolls back before checkpointing. */
  afterIdentityWrite?: (processedInBatch: number) => Promise<void> | void;
}

export class PrivyPageSourceError extends Error {
  readonly retryable: boolean;

  constructor(retryable: boolean) {
    super("Privy identity inventory page request failed");
    this.name = "PrivyPageSourceError";
    this.retryable = retryable;
  }
}

class InventoryBatchBlockedError extends Error {
  readonly issues: InventoryIssue[];

  constructor(issues: InventoryIssue[]) {
    super("Authentication identity inventory batch blocked");
    this.name = "InventoryBatchBlockedError";
    this.issues = issues;
  }
}

/**
 * Inventory Privy identities into provider credentials and verified-email
 * claims. Public results contain only counts, fixed reason codes, and keyed
 * references; raw identity data never crosses this boundary.
 */
export async function runAuthenticationIdentityInventory(
  db: DrizzleDB,
  options: AuthenticationIdentityInventoryOptions,
): Promise<AuthenticationIdentityInventoryResult> {
  assertSecret("inventory HMAC key", options.hmacKey);
  const baseline = await options.checkpointStore.load();
  const finalDeltaBaseline = options.mode === "final-delta" ? baseline : null;
  let checkpoint = options.mode === "final-delta"
    ? emptyCheckpoint()
    : baseline ?? emptyCheckpoint();

  if (options.mode !== "final-delta" && checkpoint.complete) {
    checkpoint = emptyCheckpoint();
  }

  const issues: InventoryIssue[] = [];
  const simulated = createSimulationState();
  const sleep = options.sleep ?? defaultSleep;
  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 1), 100);
  let cursor = checkpoint.cursor;
  let complete = false;
  const seenCursors = new Set<string>();
  const seenProviderSubjects = new Set<string>();

  while (!complete) {
    if (cursor !== null) {
      if (seenCursors.has(cursor)) {
        issues.push(issue("incomplete_pagination", cursor, options.hmacKey));
        break;
      }
      seenCursors.add(cursor);
    }
    let page: PrivyInventoryPage;
    try {
      page = await getPageWithRetry(
        options.pageSource,
        cursor,
        pageSize,
        options.maxRetries ?? DEFAULT_MAX_RETRIES,
        sleep,
      );
    } catch {
      issues.push(issue("provider_page_retry_exhausted", cursor ?? "initial", options.hmacKey));
      break;
    }
    if (
      !page
      || !Array.isArray(page.users)
      || (
        page.nextCursor !== null
        && (
          typeof page.nextCursor !== "string"
          || page.nextCursor.length === 0
          || page.nextCursor === cursor
          || seenCursors.has(page.nextCursor)
        )
      )
    ) {
      issues.push(issue("incomplete_pagination", cursor ?? "initial", options.hmacKey));
      break;
    }

    const evidence = page.users.map((profile) => evidenceFromPrivyRestUser(profile));
    const duplicateSubject = evidence.find((identity, index) => (
      seenProviderSubjects.has(identity.subject)
      || evidence.findIndex((candidate) => candidate.subject === identity.subject) !== index
    ));
    if (duplicateSubject) {
      issues.push(issue(
        "incomplete_pagination",
        duplicateSubject.subject,
        options.hmacKey,
      ));
      break;
    }
    const before = { ...checkpoint.counts };
    try {
      const write = options.mode === "write";
      const delta = await db.transaction(async (tx) => {
        const batchDelta = emptyCounts();
        for (let index = 0; index < evidence.length; index += 1) {
          await inventoryIdentity(
            tx,
            evidence[index]!,
            batchDelta,
            options.hmacKey,
            write,
            simulated,
          );
          if (write) await options.afterIdentityWrite?.(index + 1);
        }
        return batchDelta;
      });
      addCounts(checkpoint.counts, delta);
    } catch (error) {
      checkpoint.counts = before;
      if (error instanceof InventoryBatchBlockedError) {
        issues.push(...error.issues);
        break;
      }
      throw error;
    }

    for (const identity of evidence) {
      seenProviderSubjects.add(identity.subject);
    }
    cursor = page.nextCursor;
    checkpoint.cursor = cursor;
    checkpoint.batches += 1;
    checkpoint.complete = cursor === null;
    complete = checkpoint.complete;
    if (options.mode === "write") {
      await options.checkpointStore.save(checkpoint);
    }
  }

  if (!complete && !issues.some((entry) => entry.code === "provider_page_retry_exhausted")) {
    issues.push(issue("incomplete_pagination", cursor ?? "initial", options.hmacKey));
  }

  if (complete) {
    await addDatabaseReadiness(db, checkpoint.counts, issues, options.hmacKey);
  }

  if (options.mode === "final-delta") {
    if (!finalDeltaBaseline?.complete) {
      issues.push(issue("incomplete_pagination", "missing-baseline", options.hmacKey));
    } else if (inventoryRequiresWrites(checkpoint)) {
      issues.push(issue("final_delta_drift", "inventory-counts", options.hmacKey));
    }
    if (
      complete
      && checkpoint.counts.providerIdentities > 0
      && checkpoint.counts.credentialsInserted > 0
    ) {
      issues.push(issue("dual_write_invariant_failed", "privy-credentials", options.hmacKey));
    }
    if (complete) {
      const activePrivyCredentials = await db.select({
        subject: schema.authenticationCredentials.providerSubject,
      }).from(schema.authenticationCredentials).where(and(
        eq(schema.authenticationCredentials.provider, "privy"),
        isNull(schema.authenticationCredentials.retiredAt),
      ));
      for (const credential of activePrivyCredentials) {
        if (!seenProviderSubjects.has(credential.subject)) {
          issues.push(issue(
            "final_delta_drift",
            credential.subject,
            options.hmacKey,
          ));
        }
      }
    }
  }

  return {
    version: INVENTORY_RESULT_VERSION,
    mode: options.mode,
    status: issues.length === 0 && complete ? "ready" : "blocked",
    complete,
    batches: checkpoint.batches,
    counts: checkpoint.counts,
    issues: deduplicateIssues(issues),
  };
}

type InventoryTransaction = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];
interface InventorySimulationState {
  credentialUsersBySubject: Map<string, string>;
  emailOwners: Map<string, string | null>;
  activeEmailByUser: Map<string, string>;
}

async function inventoryIdentity(
  tx: InventoryTransaction,
  evidence: VerifiedProviderEvidence,
  counts: InventoryCounts,
  hmacKey: string,
  write: boolean,
  simulated: InventorySimulationState,
): Promise<void> {
  counts.providerIdentities += 1;
  if (evidence.owner.kind === "unclassified") {
    throw new InventoryBatchBlockedError([
      issue("unclassified_privy_identity", evidence.subject, hmacKey),
    ]);
  }

  const credential = (await tx.select()
    .from(schema.authenticationCredentials)
    .where(and(
      eq(schema.authenticationCredentials.provider, "privy"),
      eq(schema.authenticationCredentials.providerSubject, evidence.subject),
    )))[0];
  if (credential?.retiredAt) {
    throw new InventoryBatchBlockedError([
      issue("credential_mapping_conflict", evidence.subject, hmacKey),
    ]);
  }
  const candidates = new Set<string>();
  if (credential) candidates.add(credential.userId);
  const simulatedCredentialUser = simulated.credentialUsersBySubject.get(evidence.subject);
  if (simulatedCredentialUser) candidates.add(simulatedCredentialUser);

  const subjectUser = (await tx.select({
    id: schema.users.id,
    email: schema.users.email,
  })
    .from(schema.users)
    .where(eq(schema.users.id, evidence.subject)))[0];
  if (subjectUser) candidates.add(subjectUser.id);

  const walletFacts = verifiedWalletAddresses(evidence);
  if (walletFacts.length > 0) {
    const walletUsers = await tx.select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.walletAddress, walletFacts));
    for (const user of walletUsers) candidates.add(user.id);
  }

  if (candidates.size === 0) {
    if (
      evidence.owner.kind !== "email"
      || !await hasEmailOverlap(tx, evidence.owner.normalizedEmail)
    ) {
      counts.providerOnlyIdentities += 1;
      return;
    }
    throw new InventoryBatchBlockedError([
      issue("unmapped_privy_identity", evidence.subject, hmacKey),
    ]);
  }
  if (candidates.size !== 1) {
    throw new InventoryBatchBlockedError([
      issue("ambiguous_identity_mapping", evidence.subject, hmacKey),
    ]);
  }

  const userId = [...candidates][0]!;
  if (credential && credential.userId !== userId) {
    throw new InventoryBatchBlockedError([
      issue("credential_mapping_conflict", evidence.subject, hmacKey),
    ]);
  }
  counts.mappedIdentities += 1;

  const mappedUser = (await tx.select({
    id: schema.users.id,
    email: schema.users.email,
  }).from(schema.users).where(eq(schema.users.id, userId)))[0];
  if (!mappedUser) {
    throw new InventoryBatchBlockedError([
      issue("unmapped_privy_identity", evidence.subject, hmacKey),
    ]);
  }
  if (
    evidence.owner.kind === "email"
    && mappedUser.email
    && normalizeVerifiedEmail(mappedUser.email)
      !== evidence.owner.normalizedEmail
  ) {
    throw new InventoryBatchBlockedError([
      issue("user_email_metadata_mismatch", evidence.subject, hmacKey),
    ]);
  }

  if (!credential && !simulatedCredentialUser) {
    if (write) {
      const inserted = await tx.insert(schema.authenticationCredentials).values({
        userId,
        provider: "privy",
        providerSubject: evidence.subject,
      }).onConflictDoNothing().returning({
        userId: schema.authenticationCredentials.userId,
      });
      if (inserted.length === 1) {
        counts.credentialsInserted += 1;
      } else {
        const winner = (await tx.select()
          .from(schema.authenticationCredentials)
          .where(and(
            eq(schema.authenticationCredentials.provider, "privy"),
            eq(schema.authenticationCredentials.providerSubject, evidence.subject),
          )))[0];
        if (!winner || winner.retiredAt || winner.userId !== userId) {
          throw new InventoryBatchBlockedError([
            issue("credential_mapping_conflict", evidence.subject, hmacKey),
          ]);
        }
      }
    } else {
      counts.credentialsInserted += 1;
      simulated.credentialUsersBySubject.set(evidence.subject, userId);
    }
  }

  if (evidence.owner.kind === "email") {
    await inventoryEmailClaim(
      tx,
      evidence.owner.normalizedEmail,
      userId,
      counts,
      hmacKey,
      write,
      simulated,
    );
  }
}

async function hasEmailOverlap(
  tx: InventoryTransaction,
  normalizedEmail: string,
): Promise<boolean> {
  const [user, claim] = await Promise.all([
    tx.select({ id: schema.users.id })
      .from(schema.users)
      .where(sql`lower(btrim(${schema.users.email})) = ${normalizedEmail}`)
      .limit(1)
      .then((rows) => rows[0]),
    tx.select({ normalizedEmail: schema.verifiedEmailClaims.normalizedEmail })
      .from(schema.verifiedEmailClaims)
      .where(eq(schema.verifiedEmailClaims.normalizedEmail, normalizedEmail))
      .limit(1)
      .then((rows) => rows[0]),
  ]);
  return Boolean(user || claim);
}

async function inventoryEmailClaim(
  tx: InventoryTransaction,
  normalizedEmail: string,
  userId: string,
  counts: InventoryCounts,
  hmacKey: string,
  write: boolean,
  simulated: InventorySimulationState,
): Promise<void> {
  const [databaseClaim, databaseActiveForUser] = await Promise.all([
    tx.select()
      .from(schema.verifiedEmailClaims)
      .where(eq(schema.verifiedEmailClaims.normalizedEmail, normalizedEmail))
      .then((rows) => rows[0]),
    tx.select()
      .from(schema.verifiedEmailClaims)
      .where(and(
        eq(schema.verifiedEmailClaims.userId, userId),
        eq(schema.verifiedEmailClaims.state, "active"),
      ))
      .then((rows) => rows[0]),
  ]);
  const simulatedOwner = simulated.emailOwners.get(normalizedEmail);
  const claim = simulated.emailOwners.has(normalizedEmail)
    ? {
      state: simulatedOwner === null ? "conflict" as const : "active" as const,
      userId: simulatedOwner,
    }
    : databaseClaim;
  const simulatedActiveEmail = simulated.activeEmailByUser.get(userId);
  const activeForUser = simulatedActiveEmail
    ? { normalizedEmail: simulatedActiveEmail }
    : databaseActiveForUser;

  if (claim?.state === "conflict") {
    counts.conflictClaimsRetained += 1;
    return;
  }
  if (claim?.state === "active" && claim.userId === userId) return;
  if (claim?.state === "active" && claim.userId !== userId) {
    counts.claimsConvertedToConflict += 1;
    if (write) {
      await tx.update(schema.verifiedEmailClaims).set({
        state: "conflict",
        userId: null,
        updatedAt: new Date().toISOString(),
      }).where(eq(schema.verifiedEmailClaims.normalizedEmail, normalizedEmail));
    } else {
      simulated.emailOwners.set(normalizedEmail, null);
      if (typeof claim.userId === "string") {
        simulated.activeEmailByUser.delete(claim.userId);
      }
    }
    return;
  }
  if (activeForUser && activeForUser.normalizedEmail !== normalizedEmail) {
    throw new InventoryBatchBlockedError([
      issue("multiple_active_email_claims", userId, hmacKey),
    ]);
  }

  if (write) {
    const inserted = await tx.insert(schema.verifiedEmailClaims).values({
      normalizedEmail,
      userId,
      state: "active",
    }).onConflictDoNothing().returning({
      normalizedEmail: schema.verifiedEmailClaims.normalizedEmail,
    });
    if (inserted.length === 1) {
      counts.activeClaimsInserted += 1;
    } else {
      const winner = (await tx.select()
        .from(schema.verifiedEmailClaims)
        .where(eq(schema.verifiedEmailClaims.normalizedEmail, normalizedEmail)))[0];
      if (winner?.state === "active" && winner.userId === userId) return;
      if (winner?.state === "conflict") {
        counts.conflictClaimsRetained += 1;
        return;
      }
      if (winner?.state === "active" && winner.userId !== userId) {
        await tx.update(schema.verifiedEmailClaims).set({
          state: "conflict",
          userId: null,
          updatedAt: new Date().toISOString(),
        }).where(eq(schema.verifiedEmailClaims.normalizedEmail, normalizedEmail));
        counts.claimsConvertedToConflict += 1;
        return;
      }
      throw new InventoryBatchBlockedError([
        issue("multiple_active_email_claims", userId, hmacKey),
      ]);
    }
  } else {
    counts.activeClaimsInserted += 1;
    simulated.emailOwners.set(normalizedEmail, userId);
    simulated.activeEmailByUser.set(userId, normalizedEmail);
  }
}

async function addDatabaseReadiness(
  db: DrizzleDB,
  counts: InventoryCounts,
  issues: InventoryIssue[],
  hmacKey: string,
): Promise<void> {
  const [users, credentialUsers] = await Promise.all([
    db.select({
      id: schema.users.id,
      walletAddress: schema.users.walletAddress,
    }).from(schema.users),
    db.select({ userId: schema.authenticationCredentials.userId })
      .from(schema.authenticationCredentials)
      .where(isNull(schema.authenticationCredentials.retiredAt)),
  ]);
  const bound = new Set(credentialUsers.map((row) => row.userId));
  for (const user of users) {
    if (isImportedSyntheticPlayer(user.walletAddress)) {
      counts.nonAuthenticatableUsers += 1;
      continue;
    }
    if (!bound.has(user.id)) {
      counts.ordinaryUsersWithoutCredential += 1;
      issues.push(issue("ordinary_user_missing_credential", user.id, hmacKey));
    }
  }
}

function evidenceFromPrivyRestUser(profile: unknown): VerifiedProviderEvidence {
  if (!profile || typeof profile !== "object") {
    return classifyPrivyUser("invalid-profile", {});
  }
  const record = profile as Record<string, unknown>;
  const subject = typeof record.id === "string"
    ? record.id
    : typeof record.user_id === "string"
      ? record.user_id
      : "missing-subject";
  const linkedAccounts = Array.isArray(record.linked_accounts)
    ? record.linked_accounts.map(adaptLinkedAccount)
    : record.linkedAccounts;
  return classifyPrivyUser(subject, { linkedAccounts });
}

function adaptLinkedAccount(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const account = value as Record<string, unknown>;
  return {
    ...account,
    chainType: account.chainType ?? account.chain_type,
    walletClientType: account.walletClientType ?? account.wallet_client_type,
  };
}

export function createPrivyRestPageSource(input: {
  appId: string;
  appSecret: string;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeoutMs?: number;
}): PrivyInventoryPageSource {
  assertSecret("Privy app id", input.appId);
  assertSecret("Privy app secret", input.appSecret);
  const request = input.fetch ?? globalThis.fetch;
  const baseUrl = input.baseUrl ?? "https://api.privy.io/v1/users";
  const timeoutMs = input.timeoutMs ?? 10_000;
  return {
    async getPage(cursor, limit) {
      const url = new URL(baseUrl);
      url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 100)));
      if (cursor) url.searchParams.set("cursor", cursor);
      let response: Response;
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        response = await Promise.race([
          request(url, {
            headers: {
              Authorization: `Basic ${Buffer.from(`${input.appId}:${input.appSecret}`).toString("base64")}`,
              "privy-app-id": input.appId,
            },
            signal: controller.signal,
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => {
              controller.abort();
              reject(new PrivyPageSourceError(true));
            }, timeoutMs);
          }),
        ]);
      } catch {
        throw new PrivyPageSourceError(true);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
      if (!response.ok) {
        throw new PrivyPageSourceError(
          response.status === 429 || response.status >= 500,
        );
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new PrivyPageSourceError(false);
      }
      if (!payload || typeof payload !== "object") {
        throw new PrivyPageSourceError(false);
      }
      const result = payload as Record<string, unknown>;
      if (!Array.isArray(result.data)) throw new PrivyPageSourceError(false);
      const rawNextCursor = result.next_cursor;
      if (
        rawNextCursor !== undefined
        && rawNextCursor !== null
        && typeof rawNextCursor !== "string"
      ) {
        throw new PrivyPageSourceError(false);
      }
      return {
        users: result.data,
        // Privy may omit next_cursor at the terminal page. Any present
        // non-string/non-null value is malformed and fails above.
        nextCursor: typeof rawNextCursor === "string"
          ? rawNextCursor
          : null,
      };
    },
  };
}

export function createEncryptedFileCheckpointStore(input: {
  path: string;
  encryptionKey: string;
}): InventoryCheckpointStore {
  assertSecret("checkpoint encryption key", input.encryptionKey);
  const key = createHash("sha256").update(input.encryptionKey).digest();
  return {
    async load() {
      let contents: string;
      try {
        contents = await readFile(input.path, "utf8");
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw new Error("Unable to read encrypted inventory checkpoint");
      }
      try {
        const envelope = JSON.parse(contents) as {
          version: number;
          iv: string;
          tag: string;
          ciphertext: string;
        };
        if (envelope.version !== CHECKPOINT_VERSION) {
          throw new Error("invalid checkpoint version");
        }
        const decipher = createDecipheriv(
          "aes-256-gcm",
          key,
          Buffer.from(envelope.iv, "base64url"),
        );
        decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
        const plaintext = Buffer.concat([
          decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8");
        return validateCheckpoint(JSON.parse(plaintext));
      } catch {
        throw new Error("Unable to decrypt inventory checkpoint");
      }
    },
    async save(checkpoint) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const plaintext = JSON.stringify(checkpoint);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const envelope = JSON.stringify({
        version: CHECKPOINT_VERSION,
        iv: iv.toString("base64url"),
        tag: cipher.getAuthTag().toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
      });
      const temporaryPath = `${input.path}.tmp`;
      await writeFile(temporaryPath, envelope, { mode: 0o600 });
      await rename(temporaryPath, input.path);
    },
    async delete() {
      try {
        await unlink(input.path);
      } catch (error) {
        if (!isMissingFile(error)) {
          throw new Error("Unable to delete encrypted inventory checkpoint");
        }
      }
    },
  };
}

async function getPageWithRetry(
  source: PrivyInventoryPageSource,
  cursor: string | null,
  limit: number,
  maxRetries: number,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<PrivyInventoryPage> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await source.getPage(cursor, limit);
    } catch (error) {
      const retryable = error instanceof PrivyPageSourceError && error.retryable;
      if (!retryable || attempt >= maxRetries) throw error;
      await sleep(250 * 2 ** attempt);
    }
  }
}

function emptyCheckpoint(): InventoryCheckpoint {
  return {
    version: CHECKPOINT_VERSION,
    cursor: null,
    batches: 0,
    complete: false,
    counts: emptyCounts(),
  };
}

function emptyCounts(): InventoryCounts {
  return {
    providerIdentities: 0,
    providerOnlyIdentities: 0,
    mappedIdentities: 0,
    credentialsInserted: 0,
    activeClaimsInserted: 0,
    claimsConvertedToConflict: 0,
    conflictClaimsRetained: 0,
    nonAuthenticatableUsers: 0,
    ordinaryUsersWithoutCredential: 0,
  };
}

function createSimulationState(): InventorySimulationState {
  return {
    credentialUsersBySubject: new Map(),
    emailOwners: new Map(),
    activeEmailByUser: new Map(),
  };
}

function addCounts(target: InventoryCounts, delta: InventoryCounts): void {
  for (const key of Object.keys(target) as Array<keyof InventoryCounts>) {
    target[key] += delta[key];
  }
}

function inventoryRequiresWrites(current: InventoryCheckpoint): boolean {
  return current.counts.credentialsInserted !== 0
    || current.counts.activeClaimsInserted !== 0
    || current.counts.claimsConvertedToConflict !== 0;
}

function issue(code: InventoryIssueCode, identity: string, hmacKey: string): InventoryIssue {
  return {
    code,
    ref: `identity-ref:v1:${createHmac("sha256", hmacKey)
      .update(`${code}\0${identity}`)
      .digest("base64url")
      .slice(0, 22)}`,
  };
}

function deduplicateIssues(issues: InventoryIssue[]): InventoryIssue[] {
  return [...new Map(issues.map((entry) => [
    `${entry.code}:${entry.ref}`,
    entry,
  ])).values()];
}

function validateCheckpoint(value: unknown): InventoryCheckpoint {
  if (!value || typeof value !== "object") throw new Error("invalid checkpoint");
  const checkpoint = value as InventoryCheckpoint;
  if (
    checkpoint.version !== CHECKPOINT_VERSION
    || (checkpoint.cursor !== null && typeof checkpoint.cursor !== "string")
    || typeof checkpoint.batches !== "number"
    || typeof checkpoint.complete !== "boolean"
    || !checkpoint.counts
  ) {
    throw new Error("invalid checkpoint");
  }
  const counts = checkpoint.counts as Partial<InventoryCounts>;
  const normalizedCounts = emptyCounts();
  for (const key of Object.keys(normalizedCounts) as Array<keyof InventoryCounts>) {
    const count = counts[key];
    if (key === "providerOnlyIdentities" && count === undefined) continue;
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) {
      throw new Error("invalid checkpoint");
    }
    normalizedCounts[key] = count;
  }
  return { ...checkpoint, counts: normalizedCounts };
}

function assertSecret(label: string, value: string): void {
  if (value.trim().length < 16) {
    throw new Error(`${label} is missing or too short`);
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
