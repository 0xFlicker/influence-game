import { createHash } from "node:crypto";
import { join } from "node:path";
import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";

const [directory] = Bun.argv.slice(2);
if (!directory) throw new Error("Supply the directory containing the Onomaverse v2026.10 JSONL files");

async function readNames(path: string, checksum: string) {
  const contents = await Bun.file(path).text();
  if (createHash("sha256").update(contents).digest("hex") !== checksum) {
    throw new Error(`Onomaverse v2026.10 checksum mismatch for ${path}`);
  }
  const byCountry = new Map<string, Set<string>>();
  for (const line of contents.trimEnd().split("\n")) {
    const { name: rawName, country_code: country } = JSON.parse(line) as { name: string; country_code: string };
    const name = rawName.trim().normalize("NFC");
    if (name.length > AGENT_PROFILE_LIMITS.name - 2 || !/^\p{L}[\p{L}\p{M} .’'-]*$/u.test(name)) continue;
    const names = byCountry.get(country) ?? new Set<string>();
    names.add(name);
    byCountry.set(country, names);
  }
  return byCountry;
}

const [given, surnames] = await Promise.all([
  readNames(join(directory, "given-name-frequency.jsonl"), "c3cd0caef294e25595c2bc95e036cc85b79391d95f068fde7f2139c2eb54e4ce"),
  readNames(join(directory, "surname-frequency.jsonl"), "5a2a3d887c7e25a8e6cf5f4f706e4698ee9f4743afb03edb11edfb351e852ee6"),
]);

const countries = [...given].sort(([a], [b]) => a.localeCompare(b, "en")).flatMap(([country, givenNames]) => {
  const familyNames = surnames.get(country);
  return familyNames ? [{ country, givenNames: [...givenNames].sort(), surnames: [...familyNames].sort() }] : [];
});
const output = new URL("../data/onomaverse-v2026.10.json", import.meta.url);
await Bun.write(output, `[\n${countries.map(country => `  ${JSON.stringify(country)}`).join(",\n")}\n]\n`);
