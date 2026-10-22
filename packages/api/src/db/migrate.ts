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

// This exact cleanup deletes only temporary leases on reviews it closes. Review
// records, immutable actions, content and screening evidence remain untouched.
// Pin the entire file so widening the cleanup requires a fresh policy review.
const REVIEWED_CLAIM_CLEANUP_MIGRATIONS = new Map([
  ["0126_close_unscreened_superseded_reviews.sql", "f0c5773f1e0322f7bf5778e739e4a9d9454233adf9ee80b2701c6ba28e42f666"],
]);

// Pin each reviewed removal's entire SQL file so any edit or additional
// constraint removal requires a fresh policy review. 0108 removes only
// Influence-specific review revision FKs; 0118 removes only the retrospective
// input size gate. Both preserve existing rows and columns.
const REVIEWED_CONSTRAINT_REMOVAL_MIGRATIONS = new Map([
  ["0108_house_owner_learning.sql", "518ef175bb2cd547d7a5ca5c5b282025d578cd8e404439f54cbcd5f95b543ae6"],
  ["0118_retrospective_input_size.sql", "442eadf1385878d9526e7b3d7dcc059da36f4a4fdea232ec04a0cc9efd9fe13a"],
]);

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
  // This release is an operator-run maintenance cutover, never a rolling migration.
  // Its SQL refuses populated data without the cutover session setting and verified receipts.
  const coordinatedCutovers = new Map([
    ["0119_private_payload_storage.sql", "fa03a52ead8bf7e496e49a4f437239250844ac4c9dda0be6bec02d68b72aa9ee"],
    ["0120_private_auxiliary_documents.sql", "f1a1bcd03edf1a99814c569703306d0e86e33fd2096b4aaee706a4914230889d"],
  ]);
  const reviewedCutover = coordinatedCutovers.get(path.basename(file)) === createHash("sha256").update(sql).digest("hex");
  // These exact cutover files materialize required query fields from verified
  // receipts under exclusive locks, then replace the expressions with defaults.
  const materializedCutovers = new Map([
    ["0121_visual_request_query_metadata.sql", "06accda12274dd3f6f7b972b2f4e36792aa94d7c2f080e1d73585296c47352d8"],
    ["0122_text_operation_query_metadata.sql", "08c7280108a922f68950fbdeeac1056b49fb1c689453f296ed43ea5e7fc08332"],
  ]);
  const reviewedMaterialization = materializedCutovers.get(path.basename(file)) === createHash("sha256").update(sql).digest("hex");
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
    if (rule.rule === "delete" && REVIEWED_CLAIM_CLEANUP_MIGRATIONS.get(path.basename(file))
      === createHash("sha256").update(sql).digest("hex")) continue;
    if (reviewedCutover && ["rename-column", "narrow-type", "drop-constraint"].includes(rule.rule)) continue;
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
      if (REVIEWED_CONSTRAINT_REMOVAL_MIGRATIONS.get(path.basename(file))
        === createHash("sha256").update(sql).digest("hex")) continue;
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
    if (!match || /\bDEFAULT\b/i.test(statement) || reviewedMaterialization) continue;
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
