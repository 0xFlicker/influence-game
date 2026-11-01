// Development-only generator; the checked-in schemas have no generator runtime dependency.
const path = require("node:path");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some(argument => argument !== "--check"))
  throw Error("Usage: bun run mcp:schemas [--check]");
if (require("typescript-json-schema/package.json").version !== "0.65.1")
  throw Error("Use the pinned generator version 0.65.1");
const TJS = require("typescript-json-schema");
const fs = require("fs");
const root = path.resolve(__dirname, "..");
// The generator embeds TS 5.5; use the repository compiler as the authority
// before asking the older parser to emit schemas from inferred service types.
const checked = require("node:child_process").spawnSync(
  "bun",
  ["run", "typecheck"],
  { cwd: path.join(root, "packages/api"), stdio: "inherit" },
);
if (checked.status !== 0)
  throw Error("API typecheck must pass before schema generation");
const program = TJS.getProgramFromFiles(
  [root + "/packages/api/src/game-mcp/house-contract-types.ts"],
  {
    strict: true,
    noUncheckedIndexedAccess: true,
    strictNullChecks: true,
    skipLibCheck: true,
    esModuleInterop: true,
    moduleResolution: "bundler",
    target: "ES2022",
  },
  root,
);
const generator = TJS.buildGenerator(program, {
  required: true,
  noExtraProps: true,
  ignoreErrors: true,
});
if (!generator) throw Error("Schema generation failed");
const out = {};
for (const type of [
  "HouseGameRead",
  "HouseThinkingRead",
  "HouseResultsRead",
  "HouseRetrospectiveRead",
  "HouseRetrospectiveResume",
  "HouseCutsRead",
  "HouseCatalogRead",
  "HouseRulesRead",
  "HouseRulesSearchRead",
  "HouseArchetypesRead",
])
  out[type] = generator.getSchemaForSymbol(type);
// --noExtraProps must not close typed index signatures (vote totals/name maps).
for (const schema of Object.values(out)) {
  for (const [name, definition] of Object.entries(schema.definitions ?? {})) {
    if (name === "Record<string,number>")
      definition.additionalProperties = { type: "number" };
    if (name === "Record<string,string>")
      definition.additionalProperties = { type: "string" };
  }
}
const outputPath = root + "/packages/api/src/game-mcp/house-output-schemas.json";
const generated = JSON.stringify(out, null, 2) + "\n";
if (check) {
  if (fs.readFileSync(outputPath, "utf8") !== generated)
    throw Error("House MCP output schemas are stale. Run bun run mcp:schemas and commit the regenerated schema.");
  console.log("House MCP output schemas are current.");
} else {
  fs.writeFileSync(outputPath, generated);
}
