import { randomInt } from "node:crypto";
import { AGENT_PROFILE_LIMITS } from "@influence/engine/agent-profile-contract";
import onomaverse from "../data/onomaverse-v2026.10.json";
import { normalizeAgentProfileName, RESERVED_AGENT_PROFILE_NAMES } from "./agent-profile-names.js";

const normalizeName = (name: string) => normalizeAgentProfileName(name.normalize("NFC"));
const shortlistSize = 8;

const givenNames = new Map<string, { givenName: string; surnames: string[] }[]>();
for (const { givenNames: names, surnames } of onomaverse) {
  for (const givenName of names) {
    const key = normalizeName(givenName);
    const pools = givenNames.get(key) ?? [];
    pools.push({ givenName, surnames });
    givenNames.set(key, pools);
  }
}
const namingPools = [...givenNames.values()];

export function drawAgentNameShortlist(occupiedNames: ReadonlySet<string>): string[] {
  const unavailable = new Set([...RESERVED_AGENT_PROFILE_NAMES, ...occupiedNames].map(normalizeName));
  const remaining = [...namingPools];
  const shortlist: string[] = [];
  while (shortlist.length < shortlistSize && remaining.length) {
    const index = randomInt(remaining.length);
    const pools = [...remaining[index]!];
    remaining[index] = remaining.at(-1)!;
    remaining.pop();

    while (pools.length) {
      const [pool] = pools.splice(randomInt(pools.length), 1);
      const { givenName, surnames } = pool!;
      const normalizedGivenName = normalizeName(givenName);
      const eligible = surnames.filter(surname =>
        givenName.length + surname.length + 1 <= AGENT_PROFILE_LIMITS.name
        && normalizedGivenName !== normalizeName(surname)
        && !unavailable.has(normalizeName(`${givenName} ${surname}`)));
      if (!eligible.length) continue;
      const candidate = `${givenName} ${eligible[randomInt(eligible.length)]}`;
      shortlist.push(candidate);
      unavailable.add(normalizeName(candidate));
      break;
    }
  }
  if (shortlist.length !== shortlistSize) throw new Error("Could not draw eight available agent names");
  return shortlist;
}

export type CharacterNaming =
  | { fixedName: string }
  | { shortlist: readonly string[]; userText: readonly string[]; currentName?: string };

const nameString = { type: "string", minLength: 1, maxLength: AGENT_PROFILE_LIMITS.name };

function nameOption(source: string, value: object, needsRequest = false) {
  return {
    type: "object", additionalProperties: false,
    properties: {
      source: { type: "string", enum: [source] },
      value,
      ...(needsRequest ? { request: { type: "string", minLength: 1 } } : {}),
    },
    required: needsRequest ? ["source", "value", "request"] : ["source", "value"],
  };
}

const nameEnum = (names: readonly string[]) => ({ type: "string", enum: [...names] });

export function characterNameSchema(naming: CharacterNaming) {
  if ("fixedName" in naming) return nameOption("fixed", nameEnum([naming.fixedName]));

  const options = [];
  if (naming.currentName) options.push(nameOption("fixed", nameEnum([naming.currentName])));
  options.push(nameOption("shortlist", nameEnum(naming.shortlist), !!naming.currentName));
  if (naming.userText.length) {
    options.push(nameOption("provided", nameString, true), nameOption("inspiration", nameString, true));
  }
  return options.length === 1 ? options[0]! : { anyOf: options };
}

export function decodeCharacterName(output: unknown, naming: CharacterNaming): string {
  if (output && typeof output === "object" && !Array.isArray(output) && "source" in output && "value" in output
    && typeof output.value === "string" && output.value === output.value.trim()) {
    if ("fixedName" in naming) {
      if (Object.keys(output).length === 2 && output.source === "fixed" && output.value === naming.fixedName) return output.value;
    } else {
      const { source, value } = output;
      const fieldCount = Object.keys(output).length;
      const request = fieldCount === 3 && "request" in output && typeof output.request === "string" ? output.request : undefined;
      const verifiedRequest = request?.trim() && naming.userText.some(text => text.includes(request)) ? request : undefined;
      if (source === "fixed" && fieldCount === 2 && value === naming.currentName) return value;
      if (source === "shortlist" && naming.shortlist.includes(value)
        && (naming.currentName ? verifiedRequest : fieldCount === 2)) return value;
      if (value && value.length <= AGENT_PROFILE_LIMITS.name && verifiedRequest) {
        if (source === "provided" && verifiedRequest.includes(value)) return value;
        if (source === "inspiration") return value;
      }
    }
  }
  throw new Error("Invalid character profile field: name");
}

export function characterNamingInstructions(naming: CharacterNaming): string {
  if ("fixedName" in naming) {
    return 'Use name.source "fixed" and return the exact name.value specified by the schema.';
  }
  const { shortlist, userText, currentName } = naming;
  return [
    `For a new or requested replacement name, choose one of these exact options and return name.source "shortlist" with that name as name.value: ${JSON.stringify(shortlist)}.`,
    currentName ? 'Keep the existing name using source "fixed", unless the user asks to change it. When returning source "shortlist" for a rename, put the exact user wording that requests the rename in name.request.' : "",
    userText.length ? `If the user explicitly supplies a name for this character, copy that exact name, including spelling and capitalization, as name.value with source "provided". In name.request quote the user's naming instruction including that supplied name. A name mentioned as a reference or as someone else is not a supplied character name. If the user explicitly asks to use names as inspiration or invent a name outside the shortlist, you may return source "inspiration" with your new name as name.value. In name.request quote the exact wording that asks you to do that. A general character idea, a style preference, or asking you to choose a name still uses the shortlist. An expressly supplied name takes precedence over a request for inspiration.` : "",
  ].filter(Boolean).join("\n");
}
