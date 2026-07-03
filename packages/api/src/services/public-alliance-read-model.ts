import { and, asc, eq, or } from "drizzle-orm";
import {
  Phase,
  type AllianceHuddleOutcome,
  type AllianceProposalLineage,
  type AllianceRecord,
  type CanonicalGameEvent,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import { schema } from "../db/index.js";
import type { GameStatus } from "../db/schema.js";
import { getPersistedGameEvents } from "./game-event-read-model.js";
import { getPostgameTurningPoints } from "./postgame-analysis.js";

type PublicAllianceDB = DrizzleDB;
type GameRow = Pick<typeof schema.games.$inferSelect, "id" | "slug" | "status" | "createdAt" | "startedAt" | "endedAt">;
type GamePlayerRow = Pick<typeof schema.gamePlayers.$inferSelect, "id" | "persona" | "agentProfileId">;
type TranscriptRow = typeof schema.transcripts.$inferSelect;

export interface PublicAlliancePlayerRead {
  id: string;
  name: string;
  agentProfileId?: string;
}

export interface PublicAllianceTermsRead {
  name: string;
  memberIds: string[];
  memberNames: string[];
  purpose: string;
  timebox: string | null;
}

export interface PublicAllianceProposalRead {
  lineageId: string;
  allianceId: string;
  name: string;
  status: string;
  proposedRound: number;
  proposedPhase?: string | null;
  resolvedRound?: number;
  resolvedPhase?: string | null;
  memberNames: string[];
  currentVersionId: string;
  currentTerms: PublicAllianceTermsRead;
  proposer: { id: string; name: string };
  responses: Array<{ player: { id: string; name: string }; response: string }>;
  finalResult: string;
}

export interface PublicAllianceOutcomeRead {
  id: string;
  round: number;
  window: string;
  ask: string;
  plan: string;
  promises: string[];
  dissent: string[];
  confidence: string;
  posture: string;
  leakOrBetrayalClaims: string[];
}

export interface PublicAllianceConsequenceRead {
  type: "alliance_member_cut";
  round: number;
  description: string;
  confidence: string;
  playerNames: string[];
}

export interface PublicAllianceRecordRead extends PublicAllianceTermsRead {
  id: string;
  status: string;
  createdRound: number;
  createdPhase?: string | null;
  updatedRound: number;
  updatedPhase?: string | null;
  huddleOutcomeCount: number;
  latestOutcome?: PublicAllianceOutcomeRead;
  consequences: PublicAllianceConsequenceRead[];
}

export interface PublicAllianceHuddleRead {
  allianceId: string;
  allianceName: string;
  round: number;
  phase?: string | null;
  window: string;
  pass: number;
  speakers: Array<{ id: string; name: string }>;
  messages: Array<{ from: { id?: string; name: string }; text: string; timestamp: number }>;
  outcome?: PublicAllianceOutcomeRead;
}

export interface PublicAllianceFactsSummaryRead {
  proposalCount: number;
  activeAllianceCount: number;
  closedAllianceCount: number;
  archivedAllianceCount: number;
  huddleCount: number;
  latestHuddleRound: number | null;
}

export interface PublicAllianceFactsRead {
  summary: PublicAllianceFactsSummaryRead;
  proposals: PublicAllianceProposalRead[];
  alliances: PublicAllianceRecordRead[];
  huddles: PublicAllianceHuddleRead[];
}

export type PublicAllianceReadResult =
  | {
      ok: true;
      schemaVersion: 1;
      game: {
        id: string;
        slug?: string;
        status: GameStatus;
        createdAt: string;
        startedAt?: string;
        endedAt?: string;
      };
      players: PublicAlliancePlayerRead[];
      allianceFacts: PublicAllianceFactsRead;
      availability: {
        status: "available";
        eventLogStatus: string;
        transcriptStatus: "available" | "not_available";
        diagnostics: Array<{ code: string; severity: "info" | "warning"; message: string }>;
      };
    }
  | {
      ok: false;
      status: "not_found";
      error: string;
    };

export async function getPublicGameAlliances(
  db: PublicAllianceDB,
  idOrSlug: string,
): Promise<PublicAllianceReadResult> {
  const game = await loadGame(db, idOrSlug);
  if (!game) return { ok: false, status: "not_found", error: "Game not found" };

  const [players, eventRead, transcriptRows, consequencesByAllianceId] = await Promise.all([
    loadPlayers(db, game.id),
    getPersistedGameEvents(db, game.id),
    loadHuddleTranscriptRows(db, game.id),
    loadPublicAllianceConsequences(db, idOrSlug),
  ]);
  const playerNames = playerNameMap(players);
  const facts = buildPublicAllianceFacts({
    events: eventRead.events.map((row) => row.envelope),
    playerNames,
    transcriptRows,
    consequencesByAllianceId,
  });

  return {
    ok: true,
    schemaVersion: 1,
    game: {
      id: game.id,
      ...(game.slug && { slug: game.slug }),
      status: game.status,
      createdAt: game.createdAt,
      ...(game.startedAt && { startedAt: game.startedAt }),
      ...(game.endedAt && { endedAt: game.endedAt }),
    },
    players: players.map((player) => playerRead(player, playerNames)),
    allianceFacts: facts,
    availability: {
      status: "available",
      eventLogStatus: eventRead.status,
      transcriptStatus: facts.huddles.some((huddle) => huddle.messages.length > 0) ? "available" : "not_available",
      diagnostics: [
        ...eventRead.diagnostics.map((diagnostic) => ({
          code: "event_log_diagnostic",
          severity: "warning" as const,
          message: JSON.stringify(diagnostic),
        })),
        ...(facts.huddles.length > 0 && facts.huddles.every((huddle) => huddle.messages.length === 0)
          ? [{
            code: "missing_huddle_chat",
            severity: "info" as const,
            message: "Alliance huddle sessions were recorded, but no persisted huddle transcript rows were available.",
          }]
          : []),
      ],
    },
  };
}

function buildPublicAllianceFacts(params: {
  events: readonly CanonicalGameEvent[];
  playerNames: Map<string, string>;
  transcriptRows: readonly TranscriptRow[];
  consequencesByAllianceId: ReadonlyMap<string, PublicAllianceConsequenceRead[]>;
}): PublicAllianceFactsRead {
  const proposalByLineageId = new Map<string, PublicAllianceProposalRead>();
  const allianceById = new Map<string, AllianceRecord>();
  const alliancePhaseById = new Map<string, { createdPhase?: string | null; updatedPhase?: string | null }>();
  const outcomeBySessionId = new Map<string, PublicAllianceOutcomeRead>();
  const outcomesByAllianceId = new Map<string, PublicAllianceOutcomeRead[]>();
  const huddleSessions: Array<{
    id: string;
    allianceId: string;
    round: number;
    window: string;
    pass: number;
    phase?: string | null;
    speakerIds: string[];
  }> = [];

  for (const event of params.events) {
    switch (event.type) {
      case "alliance.proposal_submitted":
      case "alliance.response_recorded":
      case "alliance.counter_submitted":
      case "alliance.proposal_expired": {
        const proposal = proposalReadFromLineage(event.payload.lineage, params.playerNames);
        if (proposal) {
          proposalByLineageId.set(
            event.payload.lineage.id,
            proposalWithEventTiming({
              proposal,
              previous: proposalByLineageId.get(event.payload.lineage.id),
              event,
            }),
          );
        }
        break;
      }
      case "alliance.activated":
      case "alliance.amendment_resolved":
      case "alliance.closed":
      case "alliance.archived": {
        if ("lineage" in event.payload) {
          const proposal = proposalReadFromLineage(event.payload.lineage, params.playerNames);
          if (proposal) {
            proposalByLineageId.set(
              event.payload.lineage.id,
              proposalWithEventTiming({
                proposal,
                previous: proposalByLineageId.get(event.payload.lineage.id),
                event,
              }),
            );
          }
        }
        allianceById.set(event.payload.alliance.id, event.payload.alliance);
        alliancePhaseById.set(
          event.payload.alliance.id,
          alliancePhasesWithEventTiming({
            previous: alliancePhaseById.get(event.payload.alliance.id),
            event,
          }),
        );
        break;
      }
      case "alliance.huddle_completed": {
        const session = event.payload.session;
        huddleSessions.push({
          id: session.id,
          allianceId: session.allianceId,
          round: session.round,
          window: session.window,
          pass: session.pass,
          phase: event.phase,
          speakerIds: [...session.speakerIds],
        });
        break;
      }
      case "alliance.huddle_outcome_recorded": {
        const outcome = outcomeRead(event.payload.outcome);
        outcomeBySessionId.set(event.payload.outcome.sessionId, outcome);
        const existing = outcomesByAllianceId.get(event.payload.outcome.allianceId) ?? [];
        outcomesByAllianceId.set(event.payload.outcome.allianceId, [
          ...existing.filter((item) => item.id !== outcome.id),
          outcome,
        ]);
        if (event.payload.alliance) {
          allianceById.set(event.payload.alliance.id, event.payload.alliance);
          alliancePhaseById.set(
            event.payload.alliance.id,
            alliancePhasesWithEventTiming({
              previous: alliancePhaseById.get(event.payload.alliance.id),
              event,
            }),
          );
        }
        break;
      }
    }
  }

  const huddles = huddleSessions
    .filter((session) => allianceById.has(session.allianceId))
    .sort((left, right) => left.round - right.round || left.pass - right.pass || left.id.localeCompare(right.id))
    .map((session) => {
      const alliance = allianceById.get(session.allianceId)!;
      const speakers = session.speakerIds.map((id) => ({ id, name: nameForPlayer(params.playerNames, id) }));
      const messages = huddleMessagesForSession(params.transcriptRows, session, params.playerNames);
      const outcome = outcomeBySessionId.get(session.id) ?? latestOutcome(outcomesByAllianceId.get(session.allianceId) ?? []);
      return {
        allianceId: session.allianceId,
        allianceName: alliance.name,
        round: session.round,
        phase: session.phase,
        window: session.window,
        pass: session.pass,
        speakers,
        messages,
        ...(outcome && { outcome }),
      };
    });

  const alliances = Array.from(allianceById.values())
    .sort((left, right) => left.createdRound - right.createdRound || left.name.localeCompare(right.name))
    .map((alliance) => {
      const outcomes = outcomesByAllianceId.get(alliance.id) ?? [];
      const latest = latestOutcome(outcomes);
      return {
        id: alliance.id,
        status: alliance.status,
        ...termsRead(alliance, params.playerNames),
        createdRound: alliance.createdRound,
        ...(alliancePhaseById.get(alliance.id)?.createdPhase !== undefined && {
          createdPhase: alliancePhaseById.get(alliance.id)?.createdPhase,
        }),
        updatedRound: alliance.updatedRound,
        ...(alliancePhaseById.get(alliance.id)?.updatedPhase !== undefined && {
          updatedPhase: alliancePhaseById.get(alliance.id)?.updatedPhase,
        }),
        huddleOutcomeCount: outcomes.length,
        ...(latest && { latestOutcome: latest }),
        consequences: params.consequencesByAllianceId.get(alliance.id) ?? [],
      };
    });

  const proposals = Array.from(proposalByLineageId.values())
    .sort((left, right) => left.proposedRound - right.proposedRound || left.name.localeCompare(right.name));

  return {
    summary: {
      proposalCount: proposals.length,
      activeAllianceCount: alliances.filter((alliance) => alliance.status === "active").length,
      closedAllianceCount: alliances.filter((alliance) => alliance.status === "closed").length,
      archivedAllianceCount: alliances.filter((alliance) => alliance.status === "archived").length,
      huddleCount: huddles.length,
      latestHuddleRound: huddles.length > 0 ? Math.max(...huddles.map((huddle) => huddle.round)) : null,
    },
    proposals,
    alliances,
    huddles,
  };
}

function proposalWithEventTiming(params: {
  proposal: PublicAllianceProposalRead;
  previous?: PublicAllianceProposalRead;
  event: CanonicalGameEvent;
}): PublicAllianceProposalRead {
  const proposedPhase = params.previous?.proposedPhase
    ?? (params.event.type === "alliance.proposal_submitted" ? params.event.phase : undefined);
  const resolvedPhase = params.proposal.resolvedRound === undefined
    ? undefined
    : (isAllianceProposalResolutionEvent(params.event.type) ? params.event.phase : params.previous?.resolvedPhase);

  return {
    ...params.proposal,
    ...(proposedPhase !== undefined && { proposedPhase }),
    ...(resolvedPhase !== undefined && { resolvedPhase }),
  };
}

function isAllianceProposalResolutionEvent(type: CanonicalGameEvent["type"]): boolean {
  return type === "alliance.activated"
    || type === "alliance.amendment_resolved"
    || type === "alliance.proposal_expired";
}

function alliancePhasesWithEventTiming(params: {
  previous?: { createdPhase?: string | null; updatedPhase?: string | null };
  event: CanonicalGameEvent;
}): { createdPhase?: string | null; updatedPhase?: string | null } {
  return {
    createdPhase: params.previous?.createdPhase
      ?? (params.event.type === "alliance.activated" ? params.event.phase : undefined),
    updatedPhase: params.event.phase,
  };
}

async function loadPublicAllianceConsequences(
  db: PublicAllianceDB,
  idOrSlug: string,
): Promise<Map<string, PublicAllianceConsequenceRead[]>> {
  const result = await getPostgameTurningPoints(db, idOrSlug).catch(() => null);
  const byAllianceId = new Map<string, PublicAllianceConsequenceRead[]>();
  if (!result?.ok) return byAllianceId;

  for (const point of result.turningPoints) {
    if (point.type !== "alliance_member_cut") continue;
    const allianceIds = Array.isArray(point.criteria.allianceIds)
      ? point.criteria.allianceIds.filter((id): id is string => typeof id === "string")
      : [];
    for (const allianceId of allianceIds) {
      const consequences = byAllianceId.get(allianceId) ?? [];
      consequences.push({
        type: "alliance_member_cut",
        round: point.round,
        description: point.description,
        confidence: point.confidence,
        playerNames: point.players.map((player) => player.name),
      });
      byAllianceId.set(allianceId, consequences);
    }
  }

  return byAllianceId;
}

function proposalReadFromLineage(
  lineage: AllianceProposalLineage,
  playerNames: Map<string, string>,
): PublicAllianceProposalRead | null {
  const currentVersion = currentAllianceVersion(lineage);
  if (!currentVersion) return null;
  const responses = lineage.responsesByVersion[lineage.currentVersionId] ?? {};
  return {
    lineageId: lineage.id,
    allianceId: lineage.allianceId,
    name: currentVersion.terms.name,
    status: lineage.status,
    proposedRound: lineage.createdRound,
    ...(lineage.resolvedRound !== null && { resolvedRound: lineage.resolvedRound }),
    memberNames: currentVersion.terms.memberIds.map((id) => nameForPlayer(playerNames, id)),
    currentVersionId: lineage.currentVersionId,
    currentTerms: termsRead(currentVersion.terms, playerNames),
    proposer: {
      id: currentVersion.proposerId,
      name: nameForPlayer(playerNames, currentVersion.proposerId),
    },
    responses: Object.entries(responses)
      .map(([playerId, response]) => ({
        player: { id: playerId, name: nameForPlayer(playerNames, playerId) },
        response,
      }))
      .sort((left, right) => left.player.name.localeCompare(right.player.name)),
    finalResult: lineage.status,
  };
}

function huddleMessagesForSession(
  rows: readonly TranscriptRow[],
  session: { round: number; window: string; speakerIds: string[] },
  playerNames: Map<string, string>,
): PublicAllianceHuddleRead["messages"] {
  const phase = session.window === "pre_vote" ? Phase.PRE_VOTE_HUDDLE : Phase.PRE_COUNCIL_HUDDLE;
  const expectedParticipants = new Set([
    ...session.speakerIds,
    ...session.speakerIds.map((id) => nameForPlayer(playerNames, id)),
  ]);
  return rows
    .filter((row) => row.round === session.round && row.phase === phase)
    .filter((row) => {
      const participants = new Set<string>();
      if (row.fromPlayerId) participants.add(row.fromPlayerId);
      const fromId = playerIdForName(playerNames, row.fromPlayerId ?? "");
      if (fromId) participants.add(fromId);
      for (const target of parseStringArray(row.toPlayerIds)) {
        participants.add(target);
        const targetId = playerIdForName(playerNames, target);
        if (targetId) participants.add(targetId);
      }
      return session.speakerIds.every((id) =>
        participants.has(id) || participants.has(nameForPlayer(playerNames, id))
      ) && Array.from(participants).some((item) => expectedParticipants.has(item));
    })
    .sort((left, right) => left.timestamp - right.timestamp || left.id - right.id)
    .map((row) => {
      const fromId = row.fromPlayerId && playerNames.has(row.fromPlayerId)
        ? row.fromPlayerId
        : playerIdForName(playerNames, row.fromPlayerId ?? "");
      return {
        from: {
          ...(fromId && { id: fromId }),
          name: fromId ? nameForPlayer(playerNames, fromId) : row.fromPlayerId ?? "Unknown",
        },
        text: row.text,
        timestamp: row.timestamp,
      };
    });
}

async function loadGame(db: PublicAllianceDB, idOrSlug: string): Promise<GameRow | null> {
  return (await db
    .select({
      id: schema.games.id,
      slug: schema.games.slug,
      status: schema.games.status,
      createdAt: schema.games.createdAt,
      startedAt: schema.games.startedAt,
      endedAt: schema.games.endedAt,
    })
    .from(schema.games)
    .where(or(eq(schema.games.id, idOrSlug), eq(schema.games.slug, idOrSlug)))
    .limit(1))[0] ?? null;
}

function loadPlayers(db: PublicAllianceDB, gameId: string): Promise<GamePlayerRow[]> {
  return db
    .select({
      id: schema.gamePlayers.id,
      persona: schema.gamePlayers.persona,
      agentProfileId: schema.gamePlayers.agentProfileId,
    })
    .from(schema.gamePlayers)
    .where(eq(schema.gamePlayers.gameId, gameId))
    .orderBy(asc(schema.gamePlayers.joinedAt), asc(schema.gamePlayers.id));
}

function loadHuddleTranscriptRows(db: PublicAllianceDB, gameId: string): Promise<TranscriptRow[]> {
  return db
    .select()
    .from(schema.transcripts)
    .where(and(
      eq(schema.transcripts.gameId, gameId),
      eq(schema.transcripts.scope, "huddle"),
    ))
    .orderBy(asc(schema.transcripts.timestamp), asc(schema.transcripts.id));
}

function termsRead(
  terms: { name: string; memberIds: string[]; purpose: string; timebox: string | null },
  playerNames: Map<string, string>,
): PublicAllianceTermsRead {
  return {
    name: terms.name,
    memberIds: [...terms.memberIds],
    memberNames: terms.memberIds.map((id) => nameForPlayer(playerNames, id)),
    purpose: terms.purpose,
    timebox: terms.timebox,
  };
}

function outcomeRead(outcome: AllianceHuddleOutcome): PublicAllianceOutcomeRead {
  return {
    id: outcome.id,
    round: outcome.round,
    window: outcome.window,
    ask: outcome.ask,
    plan: outcome.plan,
    promises: [...outcome.promises],
    dissent: [...outcome.dissent],
    confidence: outcome.confidence,
    posture: outcome.posture,
    leakOrBetrayalClaims: [...outcome.leakOrBetrayalClaims],
  };
}

function latestOutcome(
  outcomes: readonly PublicAllianceOutcomeRead[],
): PublicAllianceOutcomeRead | undefined {
  return [...outcomes].sort((left, right) =>
    right.round - left.round ||
    right.id.localeCompare(left.id)
  )[0];
}

function currentAllianceVersion(lineage: AllianceProposalLineage) {
  return lineage.versions.find((version) => version.versionId === lineage.currentVersionId) ?? lineage.versions.at(-1) ?? null;
}

function playerRead(player: GamePlayerRow, playerNames: Map<string, string>): PublicAlliancePlayerRead {
  return {
    id: player.id,
    name: nameForPlayer(playerNames, player.id),
    ...(player.agentProfileId && { agentProfileId: player.agentProfileId }),
  };
}

function playerNameMap(players: readonly GamePlayerRow[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const player of players) {
    const parsed = parsePersona(player.persona);
    names.set(player.id, parsed.name ?? player.id);
  }
  return names;
}

function parsePersona(persona: string): { name?: string } {
  try {
    const parsed = JSON.parse(persona) as { name?: unknown };
    return { name: typeof parsed.name === "string" ? parsed.name : undefined };
  } catch {
    return {};
  }
}

function nameForPlayer(playerNames: Map<string, string>, id: string): string {
  return playerNames.get(id) ?? id;
}

function playerIdForName(playerNames: Map<string, string>, name: string): string | undefined {
  const needle = name.toLowerCase();
  for (const [id, playerName] of playerNames) {
    if (playerName.toLowerCase() === needle) return id;
  }
  return undefined;
}

function parseStringArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
