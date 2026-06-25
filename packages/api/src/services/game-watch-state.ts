import { buildPostVotePressureProjection, type PostVotePressureStatus } from "@influence/engine";
import { asc, eq, or } from "drizzle-orm";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameStatus } from "../db/schema.js";
import {
  getPersistedGameEvents,
  type PersistedEventDiagnostic,
} from "./game-event-read-model.js";
import {
  getPersistedGameProjection,
  type PersistedGameProjectionRead,
  type ProjectionReplayDiagnostic,
} from "./game-projection-read-model.js";

type GameWatchDB = Pick<DrizzleDB, "select">;

export type GameWatchStateSource =
  | "durable_projection"
  | "degraded"
  | "best_available_terminal_result"
  | "pre_kernel_empty";

export type GameWatchProjectionAvailability =
  | "available"
  | "degraded"
  | "unavailable";

export type GameWatchPlayerStatus = "alive" | "eliminated" | "unknown";
export type GameWatchPlayerPressureStatus = Exclude<PostVotePressureStatus, "current_at_risk" | "safe">;

type GameWatchDiagnosticCode =
  | PersistedEventDiagnostic["code"]
  | ProjectionReplayDiagnostic["code"];

export interface GameWatchDiagnosticSummary {
  code: GameWatchDiagnosticCode;
  severity: "error";
  message: string;
  sequence?: number;
  eventType?: string;
}

export interface GameWatchEventCursor {
  sequence: number;
  source: "trusted_prefix" | "none";
  eventType?: string;
  createdAt?: string;
}

export interface GameWatchProjectionState {
  availability: GameWatchProjectionAvailability;
  eventLogStatus: "empty" | "complete" | "invalid";
  projectionStatus: PersistedGameProjectionRead["status"];
  eventCount: number;
  trustedEventCount: number;
  validPrefixLength: number;
  lastTrustedSequence: number;
  firstInvalidSequence?: number;
  persistedHead?: {
    sequence: number;
    eventType: string;
    createdAt: string;
  };
  diagnostics: GameWatchDiagnosticSummary[];
}

export interface GameWatchPlayer {
  id: string;
  name: string;
  persona: string;
  personaKey?: string;
  status: GameWatchPlayerStatus;
  shielded: boolean;
  pressureStatus?: GameWatchPlayerPressureStatus;
  exposeScore?: number;
  avatarUrl?: string;
}

export interface GameWatchFinalState {
  status: "not_final" | "final";
  winner?: {
    id: string;
    name: string;
    method?: string;
    source: "durable_projection" | "degraded" | "best_available_terminal_result";
  };
  roundsPlayed?: number;
}

export interface GameWatchState {
  schemaVersion: 2;
  gameId: string;
  slug?: string;
  status: GameStatus;
  source: GameWatchStateSource;
  currentRound: number;
  currentPhase: string;
  maxRounds: number;
  eventCursor: GameWatchEventCursor;
  projection: GameWatchProjectionState;
  players: GameWatchPlayer[];
  counts: {
    totalPlayers: number;
    alivePlayers: number;
    eliminatedPlayers: number;
    unknownPlayers: number;
  };
  final: GameWatchFinalState;
  winner?: {
    id: string;
    name: string;
    method?: string;
  };
}

interface GameRow {
  id: string;
  slug: string | null;
  config: string;
  status: GameStatus;
}

interface PlayerIdentity {
  id: string;
  name: string;
  persona: string;
  personaKey?: string;
  avatarUrl?: string;
}

interface TerminalResult {
  winnerId: string | null;
  roundsPlayed: number;
}

interface GameWatchPlayerPressure {
  pressureStatus: GameWatchPlayerPressureStatus;
  exposeScore?: number;
}

type PostVotePressureInput = Parameters<typeof buildPostVotePressureProjection>[0];
type InitialPressureResolution = NonNullable<PostVotePressureInput["initialResolution"]>;
type ResolutionMode = InitialPressureResolution["mode"];
type ChoiceReason = InitialPressureResolution["choice"]["reason"];
type FallbackReason = InitialPressureResolution["fallbackReason"];
type ExposureEntry = InitialPressureResolution["exposureBench"][number];
type PressurePlayer = InitialPressureResolution["alivePlayers"][number];

export async function getGameWatchState(
  db: GameWatchDB,
  idOrSlug: string,
): Promise<GameWatchState | null> {
  const game = (await db
    .select({
      id: schema.games.id,
      slug: schema.games.slug,
      config: schema.games.config,
      status: schema.games.status,
    })
    .from(schema.games)
    .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
    .limit(1))[0];

  if (!game) return null;
  return buildGameWatchState(db, game);
}

export async function buildGameWatchState(
  db: GameWatchDB,
  game: GameRow,
): Promise<GameWatchState> {
  const [players, result] = await Promise.all([
    loadPlayerIdentities(db, game.id),
    loadTerminalResult(db, game.id),
  ]);
  const config = parseConfig(game.config);
  const maxRounds = numberFromConfig(config.maxRounds, 10);
  const persistedEvents = await getPersistedGameEvents(db, game.id);
  const projection = getPersistedGameProjection(persistedEvents);
  const source = classifySource(game.status, result, projection);
  const projectedSummary = projection.summary;
  const pressureByPlayerId = projectedSummary
    ? buildPressureByPlayerId(projectedSummary)
    : new Map<string, GameWatchPlayerPressure>();
  const watchPlayers = projectedSummary
    ? buildProjectedPlayers(players, projectedSummary.players.players, pressureByPlayerId)
    : buildFallbackPlayers(players, result, source);
  const counts = countPlayers(watchPlayers);
  const winner = projectedSummary?.winner
    ? {
        id: projectedSummary.winner.id,
        name: nameForPlayer(players, projectedSummary.winner.id) ?? projectedSummary.winner.name,
        method: projectedSummary.winner.method,
      }
    : result?.winnerId
      ? {
          id: result.winnerId,
          name: nameForPlayer(players, result.winnerId) ?? result.winnerId,
        }
      : undefined;
  const currentRound = projectedSummary?.round
    ?? result?.roundsPlayed
    ?? 0;
  const currentPhase = projectedSummary?.phase
    ?? terminalPhaseFor(game.status, result)
    ?? "INIT";
  const final = buildFinalState(game.status, source, winner, result);

  return {
    schemaVersion: 2,
    gameId: game.id,
    ...(game.slug && { slug: game.slug }),
    status: game.status,
    source,
    currentRound,
    currentPhase,
    maxRounds,
    eventCursor: buildCursor(persistedEvents.events.at(-1)),
    projection: {
      availability: availabilityFor(source, projection),
      eventLogStatus: persistedEvents.status,
      projectionStatus: projection.status,
      eventCount: persistedEvents.eventCount,
      trustedEventCount: persistedEvents.events.length,
      validPrefixLength: persistedEvents.validPrefixLength,
      lastTrustedSequence: persistedEvents.lastTrustedSequence,
      ...(persistedEvents.firstInvalidSequence !== undefined && {
        firstInvalidSequence: persistedEvents.firstInvalidSequence,
      }),
      ...(persistedEvents.persistedHead && {
        persistedHead: {
          sequence: persistedEvents.persistedHead.sequence,
          eventType: persistedEvents.persistedHead.eventType,
          createdAt: persistedEvents.persistedHead.createdAt,
        },
      }),
      diagnostics: summarizeDiagnostics(projection.diagnostics),
    },
    players: watchPlayers,
    counts,
    final,
    ...(winner && { winner }),
  };
}

async function loadPlayerIdentities(
  db: GameWatchDB,
  gameId: string,
): Promise<PlayerIdentity[]> {
  const rows = await db
    .select({
      id: schema.gamePlayers.id,
      persona: schema.gamePlayers.persona,
      joinedAt: schema.gamePlayers.joinedAt,
      avatarUrl: schema.agentProfiles.avatarUrl,
    })
    .from(schema.gamePlayers)
    .leftJoin(schema.agentProfiles, eq(schema.gamePlayers.agentProfileId, schema.agentProfiles.id))
    .where(eq(schema.gamePlayers.gameId, gameId))
    .orderBy(asc(schema.gamePlayers.joinedAt), asc(schema.gamePlayers.id));

  return rows.map((row) => {
    const persona = parseConfig(row.persona);
    const personaName = stringFromConfig(persona.name);
    const personaKey = stringFromConfig(persona.personaKey);
    const personaDescription =
      stringFromConfig(persona.personalityBlurb) ??
      stringFromConfig(persona.personality) ??
      personaKey;
    return {
      id: row.id,
      name: personaName ?? "Unknown",
      persona: personaDescription ?? "Unknown",
      ...(personaKey && { personaKey }),
      ...(row.avatarUrl && { avatarUrl: row.avatarUrl }),
    };
  });
}

async function loadTerminalResult(
  db: GameWatchDB,
  gameId: string,
): Promise<TerminalResult | null> {
  const row = (await db
    .select({
      winnerId: schema.gameResults.winnerId,
      roundsPlayed: schema.gameResults.roundsPlayed,
    })
    .from(schema.gameResults)
    .where(eq(schema.gameResults.gameId, gameId))
    .limit(1))[0];
  return row ?? null;
}

function buildExposeScores(exposeVotes: Record<string, string>): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const exposedPlayerId of Object.values(exposeVotes)) {
    scores[exposedPlayerId] = (scores[exposedPlayerId] ?? 0) + 1;
  }
  return scores;
}

function isPressureDisplayPhase(phase: string | null): boolean {
  return (
    phase === "VOTE" ||
    phase === "MINGLE" ||
    phase === "POWER" ||
    phase === "REVEAL" ||
    phase === "COUNCIL"
  );
}

function buildPressureByPlayerId(
  summary: NonNullable<PersistedGameProjectionRead["summary"]>,
): Map<string, GameWatchPlayerPressure> {
  const pressureByPlayerId = new Map<string, GameWatchPlayerPressure>();
  const empoweredId = summary.voteState.empoweredId;
  if (!empoweredId || !isPressureDisplayPhase(summary.phase)) return pressureByPlayerId;

  const exposeScores = buildExposeScores(summary.voteState.exposeVotes);
  const alivePlayers = summary.players.players
    .filter((player) => player.status === "alive")
    .map((player) => ({
      id: player.id,
      name: player.name,
      shielded: player.shielded,
    }));
  const candidateResolution = summary.voteState.candidateResolution;
  const initialResolution = buildInitialPressureResolution(
    candidateResolution?.initialResolution,
    alivePlayers,
    empoweredId,
    exposeScores,
  );
  const shieldReplacement = recordFrom(candidateResolution?.shieldReplacement);

  if (candidateResolution?.candidates && shieldReplacement) {
    applyResolvedShieldPressure({
      pressureByPlayerId,
      alivePlayers,
      exposeScores,
      empoweredId,
      candidateIds: candidateResolution.candidates,
      initialResolution,
      shieldReplacement,
    });
    return pressureByPlayerId;
  }

  const pressure = buildPostVotePressureProjection({
    alivePlayers,
    exposeScores,
    empoweredId,
    initialResolution,
  });
  for (const player of pressure?.players ?? []) {
    const status = publicPressureStatus(player.status);
    if (status) {
      pressureByPlayerId.set(player.id, {
        pressureStatus: status,
        ...(player.exposeScore > 0 && { exposeScore: player.exposeScore }),
      });
    }
  }

  return pressureByPlayerId;
}

function publicPressureStatus(status: PostVotePressureStatus): GameWatchPlayerPressureStatus | null {
  if (status === "safe") return null;
  if (status === "current_at_risk") return "locked_at_risk";
  return status;
}

function applyResolvedShieldPressure({
  pressureByPlayerId,
  alivePlayers,
  exposeScores,
  empoweredId,
  candidateIds,
  initialResolution,
  shieldReplacement,
}: {
  pressureByPlayerId: Map<string, GameWatchPlayerPressure>;
  alivePlayers: PressurePlayer[];
  exposeScores: Record<string, number>;
  empoweredId: string;
  candidateIds: [string, string];
  initialResolution: InitialPressureResolution | null;
  shieldReplacement: Record<string, unknown>;
}): void {
  const candidateIdSet = new Set(candidateIds);
  const lockedIds = new Set(initialResolution?.lockedCandidates ?? []);
  const shieldMode = stringFrom(shieldReplacement.mode);

  for (const player of alivePlayers) {
    const exposeScore = exposeScores[player.id] ?? 0;
    if (player.id === empoweredId) {
      pressureByPlayerId.set(player.id, {
        pressureStatus: "empowered",
        ...(exposeScore > 0 && { exposeScore }),
      });
      continue;
    }

    if (candidateIdSet.has(player.id)) {
      const pressureStatus: GameWatchPlayerPressureStatus =
        lockedIds.has(player.id) && exposeScore > 0
          ? "locked_at_risk"
          : shieldMode === "all_player_fallback_replacement" && exposeScore === 0
            ? "fallback_risk"
            : exposeScore > 0
              ? "replacement_risk"
              : "empowered_selected";
      pressureByPlayerId.set(player.id, {
        pressureStatus,
        ...(exposeScore > 0 && { exposeScore }),
      });
      continue;
    }

    if (player.shielded) {
      continue;
    }

    if (exposeScore > 0) {
      pressureByPlayerId.set(player.id, {
        pressureStatus: "replacement_risk",
        exposeScore,
      });
    }
  }
}

function buildInitialPressureResolution(
  raw: Record<string, unknown> | undefined,
  alivePlayers: PressurePlayer[],
  empoweredId: string,
  exposeScores: Record<string, number>,
): InitialPressureResolution | null {
  const record = recordFrom(raw);
  if (!record) return null;

  const mode = initialModeFrom(record.mode);
  if (!mode) return null;

  const resolutionAlivePlayers = pressurePlayersFrom(record.alivePlayers) ?? alivePlayers;
  const resolutionExposeScores = numberRecordFrom(record.exposeScores) ?? exposeScores;
  const exposureBench = exposureEntriesFrom(record.exposureBench) ?? buildExposureBench(resolutionAlivePlayers, empoweredId, resolutionExposeScores);
  const rawExposePressure = exposureEntriesFrom(record.rawExposePressure) ?? buildRawExposePressure(resolutionAlivePlayers, resolutionExposeScores);
  const lockedCandidates = stringArrayFrom(record.lockedCandidates) ?? [];
  const selectedCandidateIds = stringArrayFrom(record.selectedCandidateIds) ?? [];
  const candidates = pairFrom(record.candidates) ?? pairFrom([...lockedCandidates, ...selectedCandidateIds]);
  const choiceRecord = recordFrom(record.choice);
  const eligibleCandidateIds =
    stringArrayFrom(choiceRecord?.eligibleCandidateIds)
    ?? stringArrayFrom(record.eligibleCandidateIds)
    ?? [];
  const requiredCount =
    numberFrom(choiceRecord?.requiredCount)
    ?? numberFrom(record.requiredCount)
    ?? selectedCandidateIds.length;
  const choiceReason =
    choiceReasonFrom(choiceRecord?.reason)
    ?? choiceReasonFrom(record.choiceReason)
    ?? "none";

  return {
    alivePlayers: resolutionAlivePlayers,
    empoweredId: stringFrom(record.empoweredId) ?? empoweredId,
    exposeScores: resolutionExposeScores,
    exposureBench,
    rawExposePressure,
    lockedCandidates,
    choice: {
      requiredCount,
      eligibleCandidateIds,
      reason: choiceReason,
    },
    selectedCandidateIds,
    candidates,
    fallbackApplied: booleanFrom(record.fallbackApplied) ?? false,
    fallbackReason: fallbackReasonFrom(record.fallbackReason),
    mode,
  };
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringFrom(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanFrom(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringArrayFrom(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
    ? [...value]
    : null;
}

function pairFrom(value: unknown): [string, string] | null {
  const strings = stringArrayFrom(value);
  const first = strings?.[0];
  const second = strings?.[1];
  return first && second ? [first, second] : null;
}

function pressurePlayersFrom(value: unknown): PressurePlayer[] | null {
  if (!Array.isArray(value)) return null;
  const players: PressurePlayer[] = [];
  for (const item of value) {
    const record = recordFrom(item);
    const id = stringFrom(record?.id);
    const name = stringFrom(record?.name);
    const shielded = booleanFrom(record?.shielded);
    if (!id || !name || shielded === null) return null;
    players.push({ id, name, shielded });
  }
  return players;
}

function exposureEntriesFrom(value: unknown): ExposureEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: ExposureEntry[] = [];
  for (const item of value) {
    const record = recordFrom(item);
    const id = stringFrom(record?.id);
    const name = stringFrom(record?.name);
    const exposeScore = numberFrom(record?.exposeScore);
    if (!id || !name || exposeScore === null) return null;
    entries.push({ id, name, exposeScore });
  }
  return entries;
}

function buildExposureBench(
  alivePlayers: readonly PressurePlayer[],
  empoweredId: string,
  exposeScores: Record<string, number>,
): ExposureEntry[] {
  return buildRawExposePressure(alivePlayers, exposeScores)
    .filter((entry) => entry.id !== empoweredId && entry.exposeScore > 0 && !alivePlayers.find((player) => player.id === entry.id)?.shielded);
}

function buildRawExposePressure(
  alivePlayers: readonly PressurePlayer[],
  exposeScores: Record<string, number>,
): ExposureEntry[] {
  return [...alivePlayers]
    .sort((a, b) => (exposeScores[b.id] ?? 0) - (exposeScores[a.id] ?? 0) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((player) => ({
      id: player.id,
      name: player.name,
      exposeScore: exposeScores[player.id] ?? 0,
    }));
}

function numberRecordFrom(value: unknown): Record<string, number> | null {
  const record = recordFrom(value);
  if (!record) return null;
  const entries = Object.entries(record);
  if (!entries.every(([, entryValue]) => typeof entryValue === "number" && Number.isFinite(entryValue))) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

function initialModeFrom(value: unknown): ResolutionMode | null {
  return value === "all_player_fallback"
    || value === "one_locked_one_choice"
    || value === "exposure_locked"
    || value === "higher_votes_choice"
    ? value
    : null;
}

function choiceReasonFrom(value: unknown): ChoiceReason | null {
  return value === "none"
    || value === "zero_bench"
    || value === "one_bench"
    || value === "tied_exposure_tier"
    || value === "shield_replacement_tier"
    || value === "shield_replacement_fallback"
    ? value
    : null;
}

function fallbackReasonFrom(value: unknown): FallbackReason {
  return value === "bench_too_small"
    || value === "bench_exhausted"
    || value === "missing_selection"
    || value === "invalid_selection"
    ? value
    : null;
}

function classifySource(
  gameStatus: GameStatus,
  result: TerminalResult | null,
  projection: PersistedGameProjectionRead,
): GameWatchStateSource {
  if (projection.summary && projection.status === "complete") {
    return "durable_projection";
  }
  if (projection.summary || projection.status === "failed") {
    return "degraded";
  }
  if ((gameStatus === "completed" || gameStatus === "cancelled") && result) {
    return "best_available_terminal_result";
  }
  return "pre_kernel_empty";
}

function availabilityFor(
  source: GameWatchStateSource,
  projection: PersistedGameProjectionRead,
): GameWatchProjectionAvailability {
  if (source === "durable_projection") return "available";
  if (source === "degraded" || projection.status === "failed") return "degraded";
  return "unavailable";
}

function buildProjectedPlayers(
  identities: readonly PlayerIdentity[],
  projectedPlayers: ReadonlyArray<{
    id: string;
    name: string;
    status: "alive" | "eliminated";
    shielded: boolean;
  }>,
  pressureByPlayerId: ReadonlyMap<string, GameWatchPlayerPressure>,
): GameWatchPlayer[] {
  const identityById = new Map(identities.map((identity) => [identity.id, identity]));
  const projectedIds = new Set(projectedPlayers.map((player) => player.id));
  return [
    ...projectedPlayers.map((projected) => {
      const identity = identityById.get(projected.id);
      const pressure = pressureByPlayerId.get(projected.id);
      return {
        id: projected.id,
        name: identity?.name ?? projected.name,
        persona: identity?.persona ?? "Unknown",
        ...(identity?.personaKey && { personaKey: identity.personaKey }),
        status: projected.status,
        shielded: projected.shielded,
        ...(pressure?.pressureStatus && { pressureStatus: pressure.pressureStatus }),
        ...(pressure?.exposeScore !== undefined && { exposeScore: pressure.exposeScore }),
        ...(identity?.avatarUrl && { avatarUrl: identity.avatarUrl }),
      };
    }),
    ...identities
      .filter((identity) => !projectedIds.has(identity.id))
      .map((identity) => ({
        id: identity.id,
        name: identity.name,
        persona: identity.persona,
        ...(identity.personaKey && { personaKey: identity.personaKey }),
        status: "unknown" as const,
        shielded: false,
        ...(identity.avatarUrl && { avatarUrl: identity.avatarUrl }),
      })),
  ];
}

function buildFallbackPlayers(
  identities: readonly PlayerIdentity[],
  result: TerminalResult | null,
  source: GameWatchStateSource,
): GameWatchPlayer[] {
  return identities.map((identity) => {
    const terminalStatus: GameWatchPlayerStatus = (() => {
      if (source === "best_available_terminal_result") {
        return identity.id === result?.winnerId ? "alive" : "unknown";
      }
      if (source === "pre_kernel_empty") return "alive";
      return "unknown";
    })();
    return {
      id: identity.id,
      name: identity.name,
      persona: identity.persona,
      ...(identity.personaKey && { personaKey: identity.personaKey }),
      status: terminalStatus,
      shielded: false,
      ...(identity.avatarUrl && { avatarUrl: identity.avatarUrl }),
    };
  });
}

function countPlayers(players: readonly GameWatchPlayer[]): GameWatchState["counts"] {
  const alivePlayers = players.filter((player) => player.status === "alive").length;
  const eliminatedPlayers = players.filter((player) => player.status === "eliminated").length;
  const unknownPlayers = players.length - alivePlayers - eliminatedPlayers;
  return {
    totalPlayers: players.length,
    alivePlayers,
    eliminatedPlayers,
    unknownPlayers,
  };
}

function buildFinalState(
  gameStatus: GameStatus,
  source: GameWatchStateSource,
  winner: GameWatchState["winner"] | undefined,
  result: TerminalResult | null,
): GameWatchFinalState {
  const isFinal = gameStatus === "completed" || gameStatus === "cancelled" || winner !== undefined;
  return {
    status: isFinal ? "final" : "not_final",
    ...(winner && {
      winner: {
        ...winner,
        source: source === "pre_kernel_empty"
          ? "best_available_terminal_result"
          : source,
      },
    }),
    ...(result && { roundsPlayed: result.roundsPlayed }),
  };
}

function buildCursor(
  event: {
    sequence: number;
    eventType: string;
    createdAt: string;
  } | undefined,
): GameWatchEventCursor {
  if (!event) return { sequence: 0, source: "none" };
  return {
    sequence: event.sequence,
    source: "trusted_prefix",
    eventType: event.eventType,
    createdAt: event.createdAt,
  };
}

function terminalPhaseFor(
  status: GameStatus,
  result: TerminalResult | null,
): string | null {
  if (status === "completed" && result) return "END";
  if (status === "cancelled") return "END";
  if (status === "suspended") return "SUSPENDED";
  return null;
}

function summarizeDiagnostics(
  diagnostics: ReadonlyArray<PersistedEventDiagnostic | ProjectionReplayDiagnostic>,
): GameWatchDiagnosticSummary[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: publicDiagnosticMessage(diagnostic.code),
    ...(diagnostic.sequence !== undefined && { sequence: diagnostic.sequence }),
    ...("eventType" in diagnostic && diagnostic.eventType !== undefined && {
      eventType: diagnostic.eventType,
    }),
  }));
}

function publicDiagnosticMessage(code: GameWatchDiagnosticCode): string {
  switch (code) {
    case "duplicate_sequence":
      return "The persisted event log contains a duplicate sequence.";
    case "hash_mismatch":
      return "The persisted event log failed integrity validation.";
    case "invalid_envelope":
      return "The persisted event log contains an invalid event envelope.";
    case "metadata_mismatch":
      return "The persisted event log metadata does not match its event envelope.";
    case "projection_replay_failed":
      return "The persisted projection could not replay the trusted event prefix.";
    case "sequence_gap":
      return "The persisted event log contains a sequence gap.";
    case "unsupported_payload_version":
      return "The persisted event log contains an unsupported payload version.";
    case "wrong_game":
      return "The persisted event log contains an event for another game.";
  }
}

function parseConfig(value: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function numberFromConfig(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringFromConfig(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function nameForPlayer(
  players: readonly PlayerIdentity[],
  playerId: string,
): string | undefined {
  return players.find((player) => player.id === playerId)?.name;
}
