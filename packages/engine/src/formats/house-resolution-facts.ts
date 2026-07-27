/**
 * Pure House/producer format-resolution facts derived only from durable events.
 * Option A: no in-memory bag — live MC and resume use the same path.
 */

import type { CanonicalGameEvent } from "../canonical-events";
import type {
  HouseFormatBallotLine,
  HouseFormatBouncePointerLine,
  HouseFormatResolutionFacts,
  HouseFormatScoreLine,
} from "../game-runner.types";
import type { UUID } from "../types";
import { projectFormatBallotPresentation } from "../viewer-decision-events";
import { isLaunchFormatId } from "./menu";
import { displayNameForFormat, type LaunchFormatId } from "./types";

export type PlayerNameResolver = (playerId: UUID) => string;

/**
 * Build omniscient House format resolution facts for one round from the event log.
 * Returns null when that round has no `format.resolved` event.
 */
export function buildHouseFormatResolutionFacts(
  events: readonly CanonicalGameEvent[],
  round: number,
  playerName: PlayerNameResolver,
): HouseFormatResolutionFacts | null {
  const roundEvents = events.filter((event) => event.round === round);
  const resolved = latestOfType(roundEvents, "format.resolved");
  if (!resolved) return null;

  const payload = resolved.payload;
  const formatId = payload.formatId;
  if (!isLaunchFormatId(formatId)) return null;

  const menu = latestOfType(roundEvents, "format.menu_offered");
  const offeredRaw = menu?.payload.offeredFormatIds;
  const offeredFormatIds =
    offeredRaw
    && offeredRaw.length === 2
    && isLaunchFormatId(offeredRaw[0]!)
    && isLaunchFormatId(offeredRaw[1]!)
      ? ([offeredRaw[0]!, offeredRaw[1]!] as [LaunchFormatId, LaunchFormatId])
      : null;

  const roster = events.find((event) => event.type === "game.roster_initialized");
  if (!roster || roster.type !== "game.roster_initialized") return null;
  const eliminatedBeforeRound = new Set(
    events
      .filter(
        (event): event is Extract<CanonicalGameEvent, { type: "player.eliminated" }> =>
          event.type === "player.eliminated" && event.payload.eliminatedRound < round,
      )
      .map((event) => event.payload.playerId),
  );
  const eligibleVoterIds = roster.payload.players
    .map((player) => player.id)
    .filter((playerId) => !eliminatedBeforeRound.has(playerId));
  const ballotPresentation = projectFormatBallotPresentation({
    events,
    round,
    eligibleVoterIds,
  });
  if (ballotPresentation.status === "unavailable" || ballotPresentation.status === "sealed") {
    return null;
  }
  const ballots: HouseFormatBallotLine[] = ballotPresentation.rollCall
    .map((entry) => ({
      voterName: playerName(entry.voterId),
      targetName: playerName(entry.targetId),
      ...(entry.polarity ? { polarity: entry.polarity } : {}),
    }));

  const bouncePointers: HouseFormatBouncePointerLine[] = roundEvents
    .filter((event): event is Extract<CanonicalGameEvent, { type: "format.safety_bounce_pointer" }> =>
      event.type === "format.safety_bounce_pointer"
    )
    .map((event) => ({
      actorName: playerName(event.payload.actorId),
      targetName: playerName(event.payload.targetId),
      classification: event.payload.classification === "vulnerable" ? "VULNERABLE" : "SAFE",
    }));

  const scores = buildScores(formatId, payload, playerName);
  const zeroSafeNames = (payload.voteBomb?.zeroSafePlayerIds ?? []).map(playerName);
  const safeNames = (payload.safetyBounce?.safePlayerIds ?? []).map(playerName);
  const vulnerableNames = (payload.safetyBounce?.vulnerablePlayerIds ?? []).map(playerName);

  const eliminatedName = playerName(payload.eliminatedId);
  const tiedNames = payload.tiedPlayerIds.map(playerName);
  const resolutionSummary = summarizeResolution({
    formatId,
    kind: payload.resolutionKind,
    eliminatedName,
    tiedNames,
    soleVulnerable:
      formatId === "safety_bounce"
      && payload.resolutionKind === "auto"
      && Object.keys(payload.safetyBounce?.voteTotals ?? {}).length === 0
      && ballots.length === 0,
  });

  return {
    round,
    formatId,
    formatName: displayNameForFormat(formatId),
    offeredFormatIds: offeredFormatIds ? [...offeredFormatIds] : null,
    offeredFormatNames: offeredFormatIds
      ? [displayNameForFormat(offeredFormatIds[0]), displayNameForFormat(offeredFormatIds[1])]
      : null,
    ballots,
    scores,
    zeroSafeNames,
    safeNames,
    vulnerableNames,
    bouncePointers,
    resolutionKind: payload.resolutionKind,
    resolutionSummary,
    eliminatedName,
    tiebreakByEmpoweredName:
      payload.tiebreakerId && payload.tiedPlayerIds.length > 1
        ? playerName(payload.tiebreakerId)
        : null,
  };
}

function buildScores(
  formatId: LaunchFormatId,
  payload: Extract<CanonicalGameEvent, { type: "format.resolved" }>["payload"],
  playerName: PlayerNameResolver,
): HouseFormatScoreLine[] {
  if (formatId === "save_or_eliminate" && payload.saveOrEliminate) {
    return Object.entries(payload.saveOrEliminate.nets).map(([id, value]) => ({
      playerName: playerName(id as UUID),
      value,
      bucket: "net",
    }));
  }
  if (formatId === "vote_bomb" && payload.voteBomb) {
    return Object.entries(payload.voteBomb.totals).map(([id, value]) => ({
      playerName: playerName(id as UUID),
      value,
      bucket: value === 0 ? "zero_safe" : "positive",
    }));
  }
  if (formatId === "safety_bounce" && payload.safetyBounce) {
    const totals = payload.safetyBounce.voteTotals;
    const vulnerable = payload.safetyBounce.vulnerablePlayerIds;
    if (Object.keys(totals).length === 0) return [];
    return vulnerable.map((id) => ({
      playerName: playerName(id),
      value: totals[id] ?? 0,
      bucket: "vulnerable_total",
    }));
  }
  return [];
}

function summarizeResolution(input: {
  formatId: LaunchFormatId;
  kind: "clear" | "auto";
  eliminatedName: string;
  tiedNames: string[];
  soleVulnerable: boolean;
}): string {
  const criterion =
    input.formatId === "save_or_eliminate"
      ? "lowest net"
      : input.formatId === "vote_bomb"
        ? "fewest positive votes"
        : "most votes in vulnerable pool";

  if (input.soleVulnerable) {
    return `Elimination: ${input.eliminatedName} alone vulnerable (sole_vulnerable) — no final ballot.`;
  }
  if (input.kind === "auto") {
    return `Elimination: ${input.eliminatedName} alone had ${criterion} — no empowered tiebreak.`;
  }
  if (input.tiedNames.length > 1) {
    return `Elimination: ${input.eliminatedName} chosen by empowered tiebreak among tied set [${input.tiedNames.join(", ")}] on ${criterion}.`;
  }
  return `Elimination: ${input.eliminatedName} under ${criterion}.`;
}

function latestOfType<TType extends CanonicalGameEvent["type"]>(
  events: readonly CanonicalGameEvent[],
  type: TType,
): Extract<CanonicalGameEvent, { type: TType }> | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === type) {
      return event as Extract<CanonicalGameEvent, { type: TType }>;
    }
  }
  return null;
}
