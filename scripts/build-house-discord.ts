import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const outdir = resolve(root, ".renders/house-discord-lambda");
await mkdir(outdir, { recursive: true });
const result = await Bun.build({ entrypoints: [resolve(root, "packages/api/src/discord/lambda.ts")],
  target: "node", format: "esm", naming: "index.mjs", outdir, minify: false });
if (!result.success) throw new AggregateError(result.logs, "House Discord Lambda build failed");
console.log(`Built ${outdir}/index.mjs; Lambda handler: index.handler`);
