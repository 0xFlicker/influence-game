import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { schema, type DrizzleDB } from "../db/index.js";
import { seedRBAC, bootstrapSysop } from "../db/rbac-seed.js";
import { bootstrapInitialOperator } from "../services/initial-operator-bootstrap.js";
import { parseBootstrapArguments, runBootstrapCommand } from "../scripts/bootstrap-initial-operator.js";
import { setupTestDB } from "./test-utils.js";

let db: DrizzleDB;
const account = "bootstrap-walletless-account";
const input = { userId: account, operator: "ssh:operator@example.test", dryRun: false };
beforeEach(async () => {
  db = await setupTestDB();
  await seedRBAC(db);
  await db.insert(schema.users).values({ id: account, email: "bootstrap@example.test" });
});

test("requires explicit account, operator label and exactly one execution mode", () => {
  expect(parseBootstrapArguments(["--user-id", account, "--operator", "local-admin", "--dry-run"])).toEqual({ userId: account, operator: "local-admin", dryRun: true });
  for (const args of [[], ["--user-id", account], ["--user-id", account, "--operator", "admin"], ["--user-id", account, "--operator", "admin", "--apply", "--dry-run"], ["--user-id", account, "--operator", "a\nb", "--apply"], ["--first-user", "--apply"]]) expect(() => parseBootstrapArguments(args)).toThrow();
});

test("dry-run inspects eligibility without changing any grant or marker", async () => {
  expect((await bootstrapInitialOperator(db, { ...input, dryRun: true })).status).toBe("eligible");
  expect(await db.select().from(schema.userRoles)).toHaveLength(0);
  expect(await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "rbac_bootstrap_completed"))).toHaveLength(0);
});

test("grants existing walletless account once and persists honest local audit atomically", async () => {
  const result = await bootstrapInitialOperator(db, input);
  expect(result.status).toBe("bootstrapped");
  const [grant] = await db.select().from(schema.userRoles);
  expect(grant!.userId).toBe(account); expect(grant!.grantedBy).toBe(`host-operator:${input.operator}`);
  const [marker] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "rbac_bootstrap_completed"));
  expect(JSON.parse(marker!.value)).toMatchObject({ source: "host-operator-cli", operatorLabel: input.operator, operatorIdentityVerified: false, userId: account });
  expect((await bootstrapInitialOperator(db, input)).status).toBe("blocked");
  await db.delete(schema.userRoles);
  expect((await bootstrapInitialOperator(db, input)).status).toBe("blocked");
  const previous = process.env.ADMIN_ADDRESS;
  try {
    process.env.ADMIN_ADDRESS = "0xbootstrap-owner";
    await db.update(schema.users).set({ walletAddress: "0xbootstrap-owner" }).where(eq(schema.users.id, account));
    await bootstrapSysop(db);
    expect(await db.select().from(schema.userRoles)).toHaveLength(0);
  } finally { if (previous === undefined) delete process.env.ADMIN_ADDRESS; else process.env.ADMIN_ADDRESS = previous; }
});

test("does not create a missing account, choose first signup, or grant a scheduler", async () => {
  expect((await bootstrapInitialOperator(db, { ...input, userId: "missing" })).status).toBe("blocked");
  await db.insert(schema.servicePrincipals).values({ userId: account });
  expect((await bootstrapInitialOperator(db, input)).status).toBe("blocked");
  const previous = process.env.ADMIN_ADDRESS;
  try {
    process.env.ADMIN_ADDRESS = "0xservice-wallet";
    await db.update(schema.users).set({ walletAddress: "0xservice-wallet" }).where(eq(schema.users.id, account));
    await bootstrapSysop(db);
  } finally { if (previous === undefined) delete process.env.ADMIN_ADDRESS; else process.env.ADMIN_ADDRESS = previous; }
  expect(await db.select().from(schema.userRoles)).toHaveLength(0);
});

test("existing migrated sysop and historical completion markers block initial bootstrap", async () => {
  const [role] = await db.select().from(schema.roles).where(eq(schema.roles.name, "sysop"));
  await db.insert(schema.userRoles).values({ userId: account, roleId: role!.id, grantedBy: "legacy-migration" });
  expect((await bootstrapInitialOperator(db, input)).status).toBe("blocked");
  const previous = process.env.ADMIN_ADDRESS;
  try {
    delete process.env.ADMIN_ADDRESS;
    await bootstrapSysop(db);
  } finally { if (previous !== undefined) process.env.ADMIN_ADDRESS = previous; }
  // Active startup seals an existing migrated sysop even without wallet config.
  await db.delete(schema.userRoles);
  expect(await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "rbac_bootstrap_completed"))).toHaveLength(1);
  expect((await bootstrapInitialOperator(db, input)).status).toBe("blocked");
});

test("concurrent bootstrap requests serialize to one grant and one durable completion", async () => {
  await db.insert(schema.users).values({ id: "other-bootstrap-account" });
  const results = await Promise.all([bootstrapInitialOperator(db, input), bootstrapInitialOperator(db, { ...input, userId: "other-bootstrap-account" })]);
  expect(results.map(result => result.status).sort()).toEqual(["blocked", "bootstrapped"]);
  expect(await db.select().from(schema.userRoles)).toHaveLength(1);
});

test("command requires runtime DB URL and returns nonzero on a blocked target", async () => {
  const args = ["--user-id", "missing", "--operator", "local-admin", "--dry-run"];
  await expect(runBootstrapCommand(args, undefined)).rejects.toThrow("DATABASE_URL is required");
  const output: string[] = [];
  expect(await runBootstrapCommand(args, process.env.TEST_DATABASE_URL ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test", value => output.push(value))).toBe(2);
  expect(JSON.parse(output[0]!)).toMatchObject({ status: "blocked", userId: "missing" });
});

test("command applies only the explicitly selected existing account", async () => {
  const output: string[] = [];
  expect(await runBootstrapCommand(["--user-id", account, "--operator", "local-admin", "--apply"], process.env.TEST_DATABASE_URL ?? "postgresql://influence:influence@127.0.0.1:54320/influence_test", value => output.push(value))).toBe(0);
  expect(JSON.parse(output[0]!)).toMatchObject({ status: "bootstrapped", userId: account, operatorIdentityVerified: false });
});
