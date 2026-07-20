import { closeDB, createDB } from "../db/index.js";
import {
  createEncryptedFileCheckpointStore,
  createPrivyRestPageSource,
  runAuthenticationIdentityInventory,
  type AuthenticationIdentityInventoryMode,
} from "../services/authentication-identity-inventory.js";

const MODES = new Set<AuthenticationIdentityInventoryMode>([
  "dry-run",
  "write",
  "final-delta",
]);

export function parseInventoryMode(args: string[]): AuthenticationIdentityInventoryMode {
  const inline = args.find((argument) => argument.startsWith("--mode="));
  const modeIndex = args.indexOf("--mode");
  const value = inline?.slice("--mode=".length)
    ?? (modeIndex >= 0 ? args[modeIndex + 1] : undefined);
  if (!value || !MODES.has(value as AuthenticationIdentityInventoryMode)) {
    throw new Error("An explicit --mode dry-run|write|final-delta is required");
  }
  return value as AuthenticationIdentityInventoryMode;
}

async function main(): Promise<number> {
  const mode = parseInventoryMode(process.argv.slice(2));
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const appId = requiredEnvironment("PRIVY_APP_ID");
  const appSecret = requiredEnvironment("PRIVY_APP_SECRET");
  const hmacKey = requiredEnvironment("AUTH_IDENTITY_INVENTORY_HMAC_KEY");
  const checkpointKey = requiredEnvironment(
    "AUTH_IDENTITY_INVENTORY_CHECKPOINT_KEY",
  );
  const checkpointPath = requiredEnvironment(
    "AUTH_IDENTITY_INVENTORY_CHECKPOINT_PATH",
  );

  const result = await runAuthenticationIdentityInventory(createDB(databaseUrl), {
    mode,
    pageSource: createPrivyRestPageSource({ appId, appSecret }),
    checkpointStore: createEncryptedFileCheckpointStore({
      path: checkpointPath,
      encryptionKey: checkpointKey,
    }),
    hmacKey,
  });
  console.log(JSON.stringify(result));
  return result.status === "ready" ? 0 : 2;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Required inventory environment is missing: ${name}`);
  return value;
}

if (import.meta.main) {
  let exitCode = 1;
  try {
    exitCode = await main();
  } catch {
    // Raw provider/identity errors intentionally stop here. Operators get a
    // fixed code and can use safe inventory reason codes for reconciliation.
    console.error(JSON.stringify({
      version: "authentication-identity-inventory/v1",
      status: "error",
      code: "inventory_failed",
    }));
  } finally {
    await closeDB(process.env.DATABASE_URL);
  }
  process.exit(exitCode);
}
