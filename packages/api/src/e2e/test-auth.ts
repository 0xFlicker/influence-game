/**
 * E2E Test Auth Helpers
 *
 * Wallet generation, user creation, role assignment, and JWT minting
 * for e2e tests. Bypasses Privy — mints session JWTs directly.
 */

import { randomUUID } from "crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { schema, type DrizzleDB } from "../db/index.js";
import { createSessionToken } from "../middleware/auth.js";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Wallet generation
// ---------------------------------------------------------------------------

export interface TestWallet {
  privateKey: `0x${string}`;
  address: `0x${string}`;
}

/**
 * Generate a random Ethereum wallet using viem.
 */
export function generateTestWallet(): TestWallet {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return {
    privateKey,
    address: account.address,
  };
}

// ---------------------------------------------------------------------------
// User creation
// ---------------------------------------------------------------------------

export interface CreateTestUserOptions {
  id?: string;
  walletAddress: string;
  displayName?: string;
}

/**
 * Insert a user directly into the test DB.
 */
export async function createTestUser(
  db: DrizzleDB,
  opts: CreateTestUserOptions,
): Promise<string> {
  const id = opts.id ?? randomUUID();
  await db.insert(schema.users)
    .values({
      id,
      walletAddress: opts.walletAddress,
      displayName: opts.displayName ?? `TestUser-${id.slice(0, 6)}`,
    });
  return id;
}

// ---------------------------------------------------------------------------
// Role assignment
// ---------------------------------------------------------------------------

/**
 * Assign a role to a wallet address in the test DB.
 */
export async function assignRole(
  db: DrizzleDB,
  opts: { walletAddress: string; roleName: string },
): Promise<void> {
  const roles = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(sql`${schema.roles.name} = ${opts.roleName}`);

  const role = roles[0];

  if (!role) {
    throw new Error(`Role "${opts.roleName}" not found — was RBAC seeded?`);
  }

  const existing = await db
    .select({ walletAddress: schema.addressRoles.walletAddress })
    .from(schema.addressRoles)
    .where(
      sql`${schema.addressRoles.walletAddress} = ${opts.walletAddress.toLowerCase()} AND ${schema.addressRoles.roleId} = ${role.id}`,
    );

  if (existing.length === 0) {
    await db.insert(schema.addressRoles)
      .values({
        walletAddress: opts.walletAddress.toLowerCase(),
        roleId: role.id,
        grantedBy: "e2e-test",
      });
  }
}

// ---------------------------------------------------------------------------
// JWT minting
// ---------------------------------------------------------------------------

/**
 * Mint a session JWT for a given user ID.
 * Uses the same createSessionToken as the production auth middleware.
 */
export async function mintTestJwt(
  userId: string,
  opts?: { roles?: string[]; permissions?: string[] },
): Promise<string> {
  return createSessionToken(userId, {
    roles: opts?.roles ?? [],
    permissions: opts?.permissions ?? [],
  });
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export interface AdminUserResult {
  userId: string;
  wallet: TestWallet;
  jwt: string;
}

/**
 * Create an admin user with sysop role and return their JWT.
 * Sets up wallet, user record, role assignment, and mints a JWT with
 * all sysop permissions.
 */
export async function createAdminUser(db: DrizzleDB): Promise<AdminUserResult> {
  const wallet = generateTestWallet();
  const userId = await createTestUser(db, {
    walletAddress: wallet.address,
    displayName: "E2E Admin",
  });
  await assignRole(db, { walletAddress: wallet.address, roleName: "sysop" });

  const jwt = await mintTestJwt(userId, {
    roles: ["sysop"],
    permissions: [
      "manage_roles",
      "create_game",
      "start_game",
      "join_game",
      "stop_game",
      "fill_game",
      "view_admin",
    ],
  });

  return { userId, wallet, jwt };
}

export interface PlayerUserResult {
  userId: string;
  wallet: TestWallet;
  jwt: string;
}

/**
 * Create a player user with the player role and return their JWT.
 */
export async function createPlayerUser(
  db: DrizzleDB,
  index: number,
): Promise<PlayerUserResult> {
  const wallet = generateTestWallet();
  const userId = await createTestUser(db, {
    walletAddress: wallet.address,
    displayName: `Player ${index + 1}`,
  });
  await assignRole(db, { walletAddress: wallet.address, roleName: "player" });

  const jwt = await mintTestJwt(userId, {
    roles: ["player"],
    permissions: ["join_game"],
  });

  return { userId, wallet, jwt };
}
