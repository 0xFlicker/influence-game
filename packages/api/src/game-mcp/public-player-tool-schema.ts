import {
  PUBLIC_PLAYER_IDENTIFIER_MAX_LENGTH,
} from "../services/public-player-identity.js";
import type {
  PublicPlayerProfileEnvelope,
} from "../services/public-player-profile.js";

const PUBLIC_ROLE_KEYS = [
  "honest",
  "strategic",
  "deceptive",
  "paranoid",
  "social",
  "aggressive",
  "loyalist",
  "observer",
  "diplomat",
  "wildcard",
  "contrarian",
  "provocateur",
  "martyr",
] as const;

const nullableStringSchema = {
  anyOf: [
    { type: "string" },
    { type: "null" },
  ],
};

const publicRoleSchema = closedObject(
  ["key", "label"],
  {
    key: {
      type: "string",
      enum: PUBLIC_ROLE_KEYS,
    },
    label: { type: "string" },
  },
);

const competitionSchema = closedObject(
  ["gamesPlayed", "wins", "winRate"],
  {
    gamesPlayed: { type: "number" },
    wins: { type: "number" },
    winRate: { type: "number" },
  },
);

const agentSchema = closedObject(
  ["name", "avatarUrl", "role", "competition"],
  {
    name: { type: "string" },
    avatarUrl: nullableStringSchema,
    role: {
      anyOf: [
        publicRoleSchema,
        { type: "null" },
      ],
    },
    competition: competitionSchema,
  },
);

const resultSchema = closedObject(
  ["gameSlug", "agentName", "placement", "lobbySize", "totalPoints", "earnedAt"],
  {
    gameSlug: { type: "string" },
    agentName: { type: "string" },
    placement: { type: "number" },
    lobbySize: { type: "number" },
    totalPoints: { type: "number" },
    earnedAt: { type: "string" },
  },
);

const contributionSchema = closedObject(
  ["agentName", "sourcePoints", "weightPercent", "weightedPointsHundredths"],
  {
    agentName: { type: "string" },
    sourcePoints: { type: "number" },
    weightPercent: { type: "number", enum: [100, 50, 25] },
    weightedPointsHundredths: { type: "number" },
  },
);

const currentSeasonSchema = closedObject(
  ["season", "architectStanding", "honors"],
  {
    season: closedObject(
      ["slug", "name", "status"],
      {
        slug: { type: "string" },
        name: { type: "string" },
        status: { type: "string", enum: ["active", "closing", "final"] },
      },
    ),
    architectStanding: {
      anyOf: [
        closedObject(
          ["rank", "totalPointsHundredths", "wins", "contributions"],
          {
            rank: { type: "number" },
            totalPointsHundredths: { type: "number" },
            wins: { type: "number" },
            contributions: { type: "array", items: contributionSchema },
          },
        ),
        { type: "null" },
      ],
    },
    honors: closedObject(
      ["agentChampion", "architectChampion"],
      {
        agentChampion: { type: "boolean" },
        architectChampion: { type: "boolean" },
      },
    ),
  },
);

const profileSchema = closedObject(
  ["identity", "currentSeason", "career", "recentResults", "agents"],
  {
    identity: closedObject(
      ["publicId", "handle", "displayName"],
      {
        publicId: { type: "string" },
        handle: nullableStringSchema,
        displayName: { type: "string" },
      },
    ),
    currentSeason: {
      anyOf: [
        currentSeasonSchema,
        { type: "null" },
      ],
    },
    career: closedObject(
      ["rating", "peakRating", "gamesPlayed", "wins", "winRate"],
      {
        rating: { type: "number" },
        peakRating: { type: "number" },
        gamesPlayed: { type: "number" },
        wins: { type: "number" },
        winRate: { type: "number" },
      },
    ),
    recentResults: { type: "array", items: resultSchema },
    agents: { type: "array", items: agentSchema },
  },
);

export const PUBLIC_PLAYER_PROFILE_TOOL_INPUT_SCHEMA = closedObject(
  ["identifier"],
  {
    identifier: {
      type: "string",
      minLength: 1,
      maxLength: PUBLIC_PLAYER_IDENTIFIER_MAX_LENGTH,
    },
  },
);

export const PUBLIC_PLAYER_PROFILE_TOOL_OUTPUT_SCHEMA = {
  anyOf: [
    closedObject(
      ["schemaVersion", "status", "profile"],
      {
        schemaVersion: { type: "number", const: 1 },
        status: { type: "string", const: "found" },
        profile: profileSchema,
      },
    ),
    closedObject(
      ["schemaVersion", "status"],
      {
        schemaVersion: { type: "number", const: 1 },
        status: { type: "string", const: "not_found" },
      },
    ),
  ],
};

export function parsePublicPlayerProfileToolInput(value: unknown): {
  identifier: string;
} {
  const input = exactObject(value, ["identifier"], "arguments");
  const identifier = stringValue(input.identifier, "arguments.identifier");
  if (
    identifier.length < 1
    || identifier.length > PUBLIC_PLAYER_IDENTIFIER_MAX_LENGTH
  ) {
    throw new Error(
      `arguments.identifier must be between 1 and ${PUBLIC_PLAYER_IDENTIFIER_MAX_LENGTH} characters`,
    );
  }
  return { identifier };
}

export function assertPublicPlayerProfileEnvelope(
  value: unknown,
): asserts value is PublicPlayerProfileEnvelope {
  const envelope = objectValue(value, "profile envelope");
  if (envelope.status === "not_found") {
    exactObject(envelope, ["schemaVersion", "status"], "profile envelope");
    constValue(envelope.schemaVersion, 1, "profile envelope.schemaVersion");
    return;
  }

  exactObject(envelope, ["schemaVersion", "status", "profile"], "profile envelope");
  constValue(envelope.schemaVersion, 1, "profile envelope.schemaVersion");
  constValue(envelope.status, "found", "profile envelope.status");
  assertProfile(envelope.profile);
}

function assertProfile(value: unknown): void {
  const profile = exactObject(
    value,
    ["identity", "currentSeason", "career", "recentResults", "agents"],
    "profile",
  );
  const identity = exactObject(
    profile.identity,
    ["publicId", "handle", "displayName"],
    "profile.identity",
  );
  stringValue(identity.publicId, "profile.identity.publicId");
  nullableString(identity.handle, "profile.identity.handle");
  stringValue(identity.displayName, "profile.identity.displayName");

  if (profile.currentSeason !== null) assertCurrentSeason(profile.currentSeason);
  const career = exactObject(
    profile.career,
    ["rating", "peakRating", "gamesPlayed", "wins", "winRate"],
    "profile.career",
  );
  for (const key of ["rating", "peakRating", "gamesPlayed", "wins", "winRate"] as const) {
    numberValue(career[key], `profile.career.${key}`);
  }
  arrayValue(profile.recentResults, "profile.recentResults")
    .forEach((result, index) => assertResult(result, index));
  arrayValue(profile.agents, "profile.agents")
    .forEach((agent, index) => assertAgent(agent, index));
}

function assertCurrentSeason(value: unknown): void {
  const current = exactObject(
    value,
    ["season", "architectStanding", "honors"],
    "profile.currentSeason",
  );
  const season = exactObject(
    current.season,
    ["slug", "name", "status"],
    "profile.currentSeason.season",
  );
  stringValue(season.slug, "profile.currentSeason.season.slug");
  stringValue(season.name, "profile.currentSeason.season.name");
  enumValue(season.status, ["active", "closing", "final"], "profile.currentSeason.season.status");
  if (current.architectStanding !== null) {
    const standing = exactObject(
      current.architectStanding,
      ["rank", "totalPointsHundredths", "wins", "contributions"],
      "profile.currentSeason.architectStanding",
    );
    numberValue(standing.rank, "profile.currentSeason.architectStanding.rank");
    numberValue(
      standing.totalPointsHundredths,
      "profile.currentSeason.architectStanding.totalPointsHundredths",
    );
    numberValue(standing.wins, "profile.currentSeason.architectStanding.wins");
    arrayValue(
      standing.contributions,
      "profile.currentSeason.architectStanding.contributions",
    ).forEach((contribution, index) => {
      const item = exactObject(
        contribution,
        ["agentName", "sourcePoints", "weightPercent", "weightedPointsHundredths"],
        `profile.currentSeason.architectStanding.contributions[${index}]`,
      );
      stringValue(item.agentName, `contributions[${index}].agentName`);
      numberValue(item.sourcePoints, `contributions[${index}].sourcePoints`);
      enumValue(item.weightPercent, [100, 50, 25], `contributions[${index}].weightPercent`);
      numberValue(
        item.weightedPointsHundredths,
        `contributions[${index}].weightedPointsHundredths`,
      );
    });
  }
  const honors = exactObject(
    current.honors,
    ["agentChampion", "architectChampion"],
    "profile.currentSeason.honors",
  );
  booleanValue(honors.agentChampion, "profile.currentSeason.honors.agentChampion");
  booleanValue(honors.architectChampion, "profile.currentSeason.honors.architectChampion");
}

function assertResult(value: unknown, index: number): void {
  const path = `profile.recentResults[${index}]`;
  const result = exactObject(
    value,
    ["gameSlug", "agentName", "placement", "lobbySize", "totalPoints", "earnedAt"],
    path,
  );
  stringValue(result.gameSlug, `${path}.gameSlug`);
  stringValue(result.agentName, `${path}.agentName`);
  numberValue(result.placement, `${path}.placement`);
  numberValue(result.lobbySize, `${path}.lobbySize`);
  numberValue(result.totalPoints, `${path}.totalPoints`);
  stringValue(result.earnedAt, `${path}.earnedAt`);
}

function assertAgent(value: unknown, index: number): void {
  const path = `profile.agents[${index}]`;
  const agent = exactObject(
    value,
    ["name", "avatarUrl", "role", "competition"],
    path,
  );
  stringValue(agent.name, `${path}.name`);
  nullableString(agent.avatarUrl, `${path}.avatarUrl`);
  if (agent.role !== null) {
    const role = exactObject(agent.role, ["key", "label"], `${path}.role`);
    enumValue(role.key, PUBLIC_ROLE_KEYS, `${path}.role.key`);
    stringValue(role.label, `${path}.role.label`);
  }
  const competition = exactObject(
    agent.competition,
    ["gamesPlayed", "wins", "winRate"],
    `${path}.competition`,
  );
  numberValue(competition.gamesPlayed, `${path}.competition.gamesPlayed`);
  numberValue(competition.wins, `${path}.competition.wins`);
  numberValue(competition.winRate, `${path}.competition.winRate`);
}

function closedObject(
  required: readonly string[],
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "object",
    required: [...required],
    properties,
    additionalProperties: false,
  };
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const record = objectValue(value, path);
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${path} must contain exactly: ${expected.join(", ")}`);
  }
  return record;
}

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string`);
  return value;
}

function nullableString(value: unknown, path: string): void {
  if (value !== null) stringValue(value, path);
}

function numberValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number`);
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${path} must be a boolean`);
  return value;
}

function constValue<const T extends string | number>(
  value: unknown,
  expected: T,
  path: string,
): T {
  if (value !== expected) throw new Error(`${path} must equal ${String(expected)}`);
  return expected;
}

function enumValue<const T extends string | number>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${path} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}
