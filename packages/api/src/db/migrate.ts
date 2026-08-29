/**
 * Influence Game — Database Migration Runner
 *
 * Applies Drizzle migrations from the directory specified by DRIZZLE_MIGRATIONS_DIR.
 * Can be run standalone or imported programmatically.
 */

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDB } from "./index.js";

export async function runMigrations(connectionString?: string) {
  const migrationsFolder = resolveMigrationsFolder();
  const db = createDB(connectionString);
  await migrate(db, { migrationsFolder });
  console.log("Migrations applied successfully.");
  return db;
}

export type ReleaseMigrationPolicyViolation = {
  file: string;
  rule: string;
  evidence: string;
};

const RELEASE_MIGRATION_RULES: Array<{
  rule: string;
  pattern: RegExp;
}> = [
  { rule: "drop-column", pattern: /\bDROP\s+COLUMN\b/i },
  { rule: "drop-table", pattern: /\bDROP\s+TABLE\b/i },
  { rule: "drop-constraint", pattern: /\bDROP\s+CONSTRAINT\b/i },
  { rule: "drop-index", pattern: /\bDROP\s+INDEX\b/i },
  { rule: "drop-type", pattern: /\bDROP\s+TYPE\b/i },
  { rule: "drop-schema", pattern: /\bDROP\s+SCHEMA\b/i },
  {
    rule: "rename-column",
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+COLUMN\b/i,
  },
  {
    rule: "rename-table",
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bRENAME\s+TO\b/i,
  },
  {
    rule: "narrow-type",
    pattern: /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bTYPE\b/i,
  },
  {
    rule: "set-not-null",
    pattern:
      /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bSET\s+NOT\s+NULL\b/i,
  },
  {
    rule: "drop-default",
    pattern:
      /\bALTER\s+TABLE\b[\s\S]*?\bALTER\s+COLUMN\b[\s\S]*?\bDROP\s+DEFAULT\b/i,
  },
  { rule: "truncate", pattern: /\bTRUNCATE(?:\s+TABLE)?\b/i },
  { rule: "delete", pattern: /\bDELETE\s+FROM\b/i },
];

const RELEASE_SAFE_BIGINT_WIDENING = new RegExp(
  '^\\s*ALTER\\s+TABLE\\s+(?:(?:"[^"]+"|[a-z_][a-z0-9_]*)\\.)?'
  + '(?:"[^"]+"|[a-z_][a-z0-9_]*)\\s+ALTER\\s+COLUMN\\s+'
  + '(?:"[^"]+"|[a-z_][a-z0-9_]*)\\s+(?:SET\\s+DATA\\s+)?TYPE\\s+'
  + '(?:BIGINT|INT8)\\s*$',
  "i",
);

export function resolveMigrationsFolder(
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    env.DRIZZLE_MIGRATIONS_DIR ??
    fileURLToPath(new URL("../../drizzle", import.meta.url))
  );
}

/** Match the release-manifest hash: sorted `sha256sum` records, then one outer SHA-256. */
export function calculateMigrationSet(
  migrationsFolder = resolveMigrationsFolder(),
): string {
  const files = listFiles(migrationsFolder);
  const rootName = path.basename(migrationsFolder);
  const records = files
    .map((file) => {
      const digest = createHash("sha256")
        .update(readFileSync(file))
        .digest("hex");
      const relative = path
        .relative(migrationsFolder, file)
        .split(path.sep)
        .join("/");
      return `${digest}  ${rootName}/${relative}\n`;
    })
    .join("");
  return `sha256:${createHash("sha256").update(records).digest("hex")}`;
}

export function inspectReleaseMigrationFiles(
  files: string[],
): ReleaseMigrationPolicyViolation[] {
  return files.flatMap((file) =>
    inspectReleaseMigrationSql(file, readFileSync(file, "utf8")),
  );
}

export function inspectReleaseMigrationSql(
  file: string,
  sql: string,
): ReleaseMigrationPolicyViolation[] {
  const policyInput = stripSqlCommentsAndStrings(sql);
  const replacementCheckConstraints = new Set(
    [
      ...policyInput.matchAll(
        /\bADD\s+CONSTRAINT\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+CHECK\b/gi,
      ),
    ].map((match) => (match[1] ?? match[2]!).toLowerCase()),
  );
  const replacementIndexes = new Set(
    [
      ...policyInput.matchAll(
        /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
      ),
    ].map((match) => (match[1] ?? match[2]!).toLowerCase()),
  );
  const violations: ReleaseMigrationPolicyViolation[] = [];
  for (const rule of RELEASE_MIGRATION_RULES) {
    if (rule.rule === "narrow-type") {
      const unsafeTypeChange = policyInput
        .split(";")
        .find((statement) =>
          rule.pattern.test(statement)
          && !RELEASE_SAFE_BIGINT_WIDENING.test(statement)
        );
      if (!unsafeTypeChange) continue;
      violations.push({
        file,
        rule: rule.rule,
        evidence: unsafeTypeChange.replace(/\s+/g, " ").trim().slice(0, 160),
      });
      continue;
    }
    if (rule.rule === "drop-constraint") {
      const drops = [
        ...policyInput.matchAll(
          /\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
        ),
      ];
      const unmatched = drops.find(
        (drop) =>
          !replacementCheckConstraints.has((drop[1] ?? drop[2]!).toLowerCase()),
      );
      if (drops.length > 0 && !unmatched) continue;
      if (unmatched) {
        violations.push({
          file,
          rule: rule.rule,
          evidence: unmatched[0].replace(/\s+/g, " ").trim().slice(0, 160),
        });
        continue;
      }
    }
    if (rule.rule === "drop-index") {
      const drops = [
        ...policyInput.matchAll(
          /\bDROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?(?:"([^"]+)"|([a-z_][a-z0-9_]*))/gi,
        ),
      ];
      const unmatched = drops.find(
        (drop) => !replacementIndexes.has((drop[1] ?? drop[2]!).toLowerCase()),
      );
      if (drops.length > 0 && !unmatched) continue;
      if (unmatched) {
        violations.push({
          file,
          rule: rule.rule,
          evidence: unmatched[0].replace(/\s+/g, " ").trim().slice(0, 160),
        });
        continue;
      }
    }
    const match = policyInput.match(rule.pattern);
    if (!match) continue;
    violations.push({
      file,
      rule: rule.rule,
      evidence: match[0].replace(/\s+/g, " ").trim().slice(0, 160),
    });
  }
  for (const statement of policyInput.split(";")) {
    if (/\bADD\s+CONSTRAINT\b/i.test(statement)) continue;
    const match = statement.match(
      /\bALTER\s+TABLE\b[\s\S]*?\bADD\s+(?:COLUMN\s+)?(?:"[^"]+"|[a-z_][a-z0-9_]*)[\s\S]*?\bNOT\s+NULL\b/i,
    );
    if (!match || /\bDEFAULT\b/i.test(statement)) continue;
    violations.push({
      file,
      rule: "add-not-null-without-default",
      evidence: match[0].replace(/\s+/g, " ").trim().slice(0, 160),
    });
  }
  return violations;
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files.sort((left, right) => {
    const leftRelative = path.relative(root, left);
    const rightRelative = path.relative(root, right);
    return leftRelative < rightRelative
      ? -1
      : leftRelative > rightRelative
        ? 1
        : 0;
  });
}

function stripSqlCommentsAndStrings(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length))
    .replace(/--[^\r\n]*/g, (comment) => " ".repeat(comment.length))
    .replace(/'(?:''|[^'])*'/g, (literal) => " ".repeat(literal.length));
}

// Run directly: bun run src/db/migrate.ts
if (import.meta.main) {
  const [command, ...files] = Bun.argv.slice(2);
  if (command === "--print-release-migration-set") {
    console.log(calculateMigrationSet());
  } else if (command === "--check-release-compatibility") {
    const violations = inspectReleaseMigrationFiles(files);
    if (violations.length > 0) {
      for (const violation of violations) {
        console.error(
          `${violation.file}: release migration policy rejected ${violation.rule} (${violation.evidence})`,
        );
      }
      process.exit(1);
    }
    console.log(
      `Release migration policy accepted ${files.length} changed migration file(s).`,
    );
  } else if (command) {
    console.error(`Unknown migration command: ${command}`);
    process.exit(64);
  } else {
    const url = process.env.DATABASE_URL;
    await runMigrations(url);
  }
}
