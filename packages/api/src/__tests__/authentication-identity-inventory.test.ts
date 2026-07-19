import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { schema, type DrizzleDB } from "../db/index.js";
import {
  INVENTORY_RESULT_VERSION,
  PrivyPageSourceError,
  createEncryptedFileCheckpointStore,
  createPrivyRestPageSource,
  runAuthenticationIdentityInventory,
  type InventoryCheckpoint,
  type InventoryCheckpointStore,
  type PrivyInventoryPage,
  type PrivyInventoryPageSource,
} from "../services/authentication-identity-inventory.js";
import { setupTestDB } from "./test-utils.js";

const HMAC_KEY = "inventory-hmac-test-key-at-least-32-characters";
const CHECKPOINT_KEY = "checkpoint-test-key-at-least-32-characters";
const EMAIL = "private.owner@example.com";
const CURSOR = "opaque-provider-cursor-private";
const EMBEDDED_WALLET = "0x1111111111111111111111111111111111111111";
const EXTERNAL_WALLET = "0x2222222222222222222222222222222222222222";
const checkpointFiles: string[] = [];

describe("authentication identity inventory", () => {
  let db: DrizzleDB;

  beforeEach(async () => {
    db = await setupTestDB();
  });

  afterEach(async () => {
    for (const path of checkpointFiles.splice(0)) {
      await Bun.file(path).delete().catch(() => undefined);
      await Bun.file(`${path}.tmp`).delete().catch(() => undefined);
    }
  });

  test("writes a unique Privy credential and active email claim idempotently", async () => {
    const subject = "did:privy:unique";
    await insertUser(db, subject);
    const store = memoryCheckpointStore();
    const source = staticSource([page([emailProfile(subject, EMAIL)])]);

    const first = await run(db, "write", source, store);
    const second = await run(
      db,
      "write",
      staticSource([page([emailProfile(subject, EMAIL)])]),
      store,
    );

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(1);
    expect(await db.select().from(schema.verifiedEmailClaims)).toEqual([
      expect.objectContaining({
        normalizedEmail: EMAIL,
        userId: subject,
        state: "active",
      }),
    ]);
  });

  test("converts the same verified email on two durable accounts to one conflict", async () => {
    await insertUser(db, "did:privy:first");
    await insertUser(db, "did:privy:second");
    const profiles = [
      emailProfile("did:privy:first", EMAIL),
      emailProfile("did:privy:second", EMAIL),
    ];

    const first = await run(
      db,
      "write",
      staticSource([page(profiles)]),
      memoryCheckpointStore(),
    );
    const second = await run(
      db,
      "write",
      staticSource([page(profiles)]),
      memoryCheckpointStore(),
    );

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    expect(await db.select().from(schema.verifiedEmailClaims)).toEqual([
      expect.objectContaining({
        normalizedEmail: EMAIL,
        userId: null,
        state: "conflict",
      }),
    ]);
  });

  test("dry-run simulates duplicate email conflict conversion across pages", async () => {
    await insertUser(db, "did:privy:dry-first");
    await insertUser(db, "did:privy:dry-second");
    const result = await run(
      db,
      "dry-run",
      mapSource(new Map([
        [
          null,
          page([
            emailProfile("did:privy:dry-first", EMAIL),
          ], CURSOR),
        ],
        [
          CURSOR,
          page([
            emailProfile("did:privy:dry-second", EMAIL),
          ]),
        ],
      ])),
      memoryCheckpointStore(),
    );

    expect(result.counts.activeClaimsInserted).toBe(1);
    expect(result.counts.claimsConvertedToConflict).toBe(1);
    expect(await db.select().from(schema.verifiedEmailClaims)).toHaveLength(0);
  });

  test("accepts agreeing subject and verified wallet facts on one account", async () => {
    const subject = "did:privy:wallet-facts";
    await insertUser(db, subject, EXTERNAL_WALLET);
    const profile = walletProfile(subject, EXTERNAL_WALLET, EMBEDDED_WALLET);

    const result = await run(
      db,
      "write",
      staticSource([page([profile])]),
      memoryCheckpointStore(),
    );

    expect(result.status).toBe("ready");
    expect(result.counts.mappedIdentities).toBe(1);
    expect(await db.select().from(schema.authenticationCredentials)).toEqual([
      expect.objectContaining({ userId: subject, provider: "privy" }),
    ]);
    expect(await db.select().from(schema.verifiedEmailClaims)).toHaveLength(0);
  });

  test("rolls back only an interrupted batch and resumes without duplicate rows", async () => {
    const first = "did:privy:page-one";
    const second = "did:privy:page-two";
    await insertUser(db, first);
    await insertUser(db, second);
    const store = memoryCheckpointStore();
    let failSecondBatch = true;
    const pages = new Map<string | null, PrivyInventoryPage>([
      [null, page([emailProfile(first, "first@example.com")], CURSOR)],
      [CURSOR, page([emailProfile(second, "second@example.com")])],
    ]);

    await expect(runAuthenticationIdentityInventory(db, {
      mode: "write",
      pageSource: mapSource(pages),
      checkpointStore: store,
      hmacKey: HMAC_KEY,
      afterIdentityWrite() {
        if (failSecondBatch && store.value?.cursor === CURSOR) {
          throw new Error("injected failure");
        }
      },
    })).rejects.toThrow("injected failure");

    expect(store.value?.cursor).toBe(CURSOR);
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(1);
    failSecondBatch = false;
    const resumed = await run(db, "write", mapSource(pages), store);
    expect(resumed.status).toBe("ready");
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(2);
    expect(await db.select().from(schema.verifiedEmailClaims)).toHaveLength(2);
  });

  test("bounds 429 retries, uses injected backoff, and preserves checkpoint", async () => {
    const subject = "did:privy:retry";
    await insertUser(db, subject);
    const store = memoryCheckpointStore();
    let attempts = 0;
    const source: PrivyInventoryPageSource = {
      async getPage(cursor) {
        if (cursor === null) {
          return page([emailProfile(subject, "retry@example.com")], CURSOR);
        }
        attempts += 1;
        throw new PrivyPageSourceError(true);
      },
    };
    const sleeps: number[] = [];

    const result = await runAuthenticationIdentityInventory(db, {
      mode: "write",
      pageSource: source,
      checkpointStore: store,
      hmacKey: HMAC_KEY,
      maxRetries: 2,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
      },
    });

    expect(result.status).toBe("blocked");
    expect(result.issues.map((entry) => entry.code))
      .toContain("provider_page_retry_exhausted");
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([250, 500]);
    expect(store.value?.cursor).toBe(CURSOR);
    expect(JSON.stringify(result)).not.toContain(CURSOR);
  });

  test("counts only imported-* users as non-authenticatable", async () => {
    await insertUser(db, "imported-user", "imported-simulation-42");
    await insertUser(db, "ordinary-user");

    const result = await run(
      db,
      "dry-run",
      staticSource([page([])]),
      memoryCheckpointStore(),
    );

    expect(result.status).toBe("blocked");
    expect(result.counts.nonAuthenticatableUsers).toBe(1);
    expect(result.counts.ordinaryUsersWithoutCredential).toBe(1);
    expect(result.issues.map((entry) => entry.code))
      .toContain("ordinary_user_missing_credential");
    expect(JSON.stringify(result)).not.toContain("ordinary-user");
  });

  test("blocks an unclassified or unmapped Privy identity without writing", async () => {
    const source = staticSource([page([{
      id: "did:privy:unknown",
      linked_accounts: [{ type: "email", address: EMAIL }],
    }])]);
    const result = await run(
      db,
      "write",
      source,
      memoryCheckpointStore(),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map((entry) => entry.code))
      .toContain("unmapped_privy_identity");
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain("did:privy:unknown");
    expect(JSON.stringify(result)).not.toContain(EMAIL);
  });

  test("blocks users.email metadata mismatch without using it as merge authority", async () => {
    const subject = "did:privy:mismatch";
    await insertUser(db, subject, null, "different@example.com");
    const result = await run(
      db,
      "write",
      staticSource([page([emailProfile(subject, EMAIL)])]),
      memoryCheckpointStore(),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map((entry) => entry.code))
      .toContain("user_email_metadata_mismatch");
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(0);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(EMAIL);
    expect(serialized).not.toContain("different@example.com");
  });

  test("retired credentials block and do not satisfy ordinary-user readiness", async () => {
    const subject = "did:privy:retired";
    await insertUser(db, subject);
    await db.insert(schema.authenticationCredentials).values({
      userId: subject,
      provider: "privy",
      providerSubject: subject,
      retiredAt: new Date().toISOString(),
    });

    const result = await run(
      db,
      "dry-run",
      staticSource([page([emailProfile(subject, EMAIL)])]),
      memoryCheckpointStore(),
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map((entry) => entry.code))
      .toContain("credential_mapping_conflict");
    const readiness = await run(
      db,
      "dry-run",
      staticSource([page([])]),
      memoryCheckpointStore(),
    );
    expect(readiness.counts.ordinaryUsersWithoutCredential).toBe(1);
    expect(readiness.issues.map((entry) => entry.code))
      .toContain("ordinary_user_missing_credential");
  });

  test("fails closed on a repeated pagination cursor without advancing", async () => {
    const subject = "did:privy:cursor-loop";
    await insertUser(db, subject);
    const store = memoryCheckpointStore();
    const result = await run(
      db,
      "write",
      staticSource([
        page([emailProfile(subject, EMAIL)], CURSOR),
        page([], CURSOR),
      ]),
      store,
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map((entry) => entry.code))
      .toContain("incomplete_pagination");
    expect(store.value?.cursor).toBe(CURSOR);
    expect(JSON.stringify(result)).not.toContain(CURSOR);
  });

  test("encrypts checkpoint bytes and authenticates them before loading", async () => {
    const path = join(
      process.env.TMPDIR ?? "/tmp",
      `auth-inventory-${crypto.randomUUID()}.checkpoint`,
    );
    checkpointFiles.push(path);
    const store = createEncryptedFileCheckpointStore({
      path,
      encryptionKey: CHECKPOINT_KEY,
    });
    const checkpoint: InventoryCheckpoint = {
      version: 1,
      cursor: CURSOR,
      batches: 2,
      complete: false,
      counts: zeroCounts(),
    };

    await store.save(checkpoint);
    const bytes = await readFile(path, "utf8");

    expect(bytes).not.toContain(CURSOR);
    expect(bytes).not.toContain(EMAIL);
    expect(await store.load()).toEqual(checkpoint);
  });

  test("final delta is read-only and fails when provider inventory drifts", async () => {
    const subject = "did:privy:delta";
    await insertUser(db, subject);
    const store = memoryCheckpointStore();
    await run(
      db,
      "write",
      staticSource([page([emailProfile(subject, "delta@example.com")])]),
      store,
    );
    const credentialCount = (await db.select().from(schema.authenticationCredentials)).length;

    const stable = await run(
      db,
      "final-delta",
      staticSource([page([emailProfile(subject, "delta@example.com")])]),
      store,
    );
    const drift = await run(
      db,
      "final-delta",
      staticSource([page([
        emailProfile(subject, "delta@example.com"),
        emailProfile("did:privy:new-unmapped", "new-private@example.com"),
      ])]),
      store,
    );

    expect(stable.status).toBe("ready");
    expect(drift.status).toBe("blocked");
    expect(drift.issues.map((entry) => entry.code))
      .toContain("unmapped_privy_identity");
    expect(await db.select().from(schema.authenticationCredentials)).toHaveLength(
      credentialCount,
    );
  });

  test("final delta blocks a stale active Privy credential absent from provider inventory", async () => {
    const subject = "did:privy:present";
    await insertUser(db, subject);
    await insertUser(db, "stale-user");
    await db.insert(schema.authenticationCredentials).values({
      userId: "stale-user",
      provider: "privy",
      providerSubject: "did:privy:no-longer-present",
    });
    const store = memoryCheckpointStore();
    await run(
      db,
      "write",
      staticSource([page([emailProfile(subject, "present@example.com")])]),
      store,
    );

    const result = await run(
      db,
      "final-delta",
      staticSource([page([emailProfile(subject, "present@example.com")])]),
      store,
    );

    expect(result.status).toBe("blocked");
    expect(result.issues.map((entry) => entry.code)).toContain("final_delta_drift");
    expect(JSON.stringify(result)).not.toContain("did:privy:no-longer-present");
  });

  test("REST source uses documented auth, cursor, and page-size boundaries", async () => {
    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    const source = createPrivyRestPageSource({
      appId: "privy-app-id-long-enough",
      appSecret: "privy-app-secret-long-enough",
      fetch: (async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        return Response.json({ data: [], next_cursor: null });
      }) as typeof fetch,
    });

    await source.getPage(CURSOR, 1000);

    expect(requestUrl).toContain(`cursor=${CURSOR}`);
    expect(requestUrl).toContain("limit=100");
    expect(requestHeaders?.get("privy-app-id")).toBe("privy-app-id-long-enough");
    expect(requestHeaders?.get("authorization")).toStartWith("Basic ");
  });

  test("REST source rejects a malformed next_cursor instead of completing", async () => {
    const source = createPrivyRestPageSource({
      appId: "privy-app-id-long-enough",
      appSecret: "privy-app-secret-long-enough",
      fetch: (async () => Response.json({
        data: [],
        next_cursor: { not: "a cursor" },
      })) as unknown as typeof fetch,
    });

    await expect(source.getPage(null, 100))
      .rejects.toBeInstanceOf(PrivyPageSourceError);
  });

  test("publishes a versioned privacy-safe result contract", async () => {
    const result = await run(
      db,
      "dry-run",
      staticSource([page([])]),
      memoryCheckpointStore(),
    );
    expect(result.version).toBe(INVENTORY_RESULT_VERSION);
    const serialized = JSON.stringify(result);
    for (const secret of [EMAIL, CURSOR, EMBEDDED_WALLET, EXTERNAL_WALLET]) {
      expect(serialized).not.toContain(secret);
    }
  });
});

function run(
  db: DrizzleDB,
  mode: "dry-run" | "write" | "final-delta",
  pageSource: PrivyInventoryPageSource,
  checkpointStore: InventoryCheckpointStore,
) {
  return runAuthenticationIdentityInventory(db, {
    mode,
    pageSource,
    checkpointStore,
    hmacKey: HMAC_KEY,
  });
}

function emailProfile(subject: string, email: string) {
  return {
    id: subject,
    linked_accounts: [{ type: "email", address: email }],
  };
}

function walletProfile(
  subject: string,
  externalWallet: string,
  productWallet: string,
) {
  return {
    id: subject,
    linked_accounts: [
      {
        type: "wallet",
        address: externalWallet,
        chain_type: "ethereum",
        wallet_client_type: "metamask",
      },
      {
        type: "wallet",
        address: productWallet,
        chain_type: "ethereum",
        wallet_client_type: "privy",
      },
    ],
  };
}

function page(users: unknown[], nextCursor: string | null = null): PrivyInventoryPage {
  return { users, nextCursor };
}

function staticSource(pages: PrivyInventoryPage[]): PrivyInventoryPageSource {
  let index = 0;
  return {
    async getPage() {
      const value = pages[index];
      index += 1;
      if (!value) throw new Error("unexpected page request");
      return value;
    },
  };
}

function mapSource(
  pages: Map<string | null, PrivyInventoryPage>,
): PrivyInventoryPageSource {
  return {
    async getPage(cursor) {
      const value = pages.get(cursor);
      if (!value) throw new Error("unexpected cursor");
      return value;
    },
  };
}

function memoryCheckpointStore(): InventoryCheckpointStore & {
  value: InventoryCheckpoint | null;
} {
  return {
    value: null,
    async load() {
      return this.value ? structuredClone(this.value) : null;
    },
    async save(checkpoint) {
      this.value = structuredClone(checkpoint);
    },
    async delete() {
      this.value = null;
    },
  };
}

function zeroCounts() {
  return {
    providerIdentities: 0,
    mappedIdentities: 0,
    credentialsInserted: 0,
    activeClaimsInserted: 0,
    claimsConvertedToConflict: 0,
    conflictClaimsRetained: 0,
    nonAuthenticatableUsers: 0,
    ordinaryUsersWithoutCredential: 0,
  };
}

async function insertUser(
  db: DrizzleDB,
  id: string,
  walletAddress: string | null = null,
  email: string | null = null,
): Promise<void> {
  await db.insert(schema.users).values({ id, walletAddress, email });
}
