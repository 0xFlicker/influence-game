import { createHash } from "node:crypto";
import type { HouseHighlightVisualCardFactKind } from "../postgame-highlights/types";

export const HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION = 1 as const;
export const HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE = "house_highlights_trailer" as const;
export const HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION =
  "house-highlights-trailer-timing-v1" as const;

export type HouseHighlightsTrailerAgentStatus =
  | "winner"
  | "finalist"
  | "eliminated"
  | "unknown";

export interface HouseHighlightsTrailerAgent {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string;
  placement: number | null;
  status: HouseHighlightsTrailerAgentStatus;
}

export interface HouseHighlightsTrailerFact {
  id: string;
  kind: HouseHighlightVisualCardFactKind;
  text: string;
  agentIds: string[];
}

export interface HouseHighlightsTrailerPlayerResult {
  agent: HouseHighlightsTrailerAgent;
  placementLabel: string;
  tags: string[];
}

export interface HouseHighlightsTrailerScenelet {
  id: string;
  title: string;
  visualType: string;
  backgroundImage: string;
  backdropCategory: string;
  primaryAgents: HouseHighlightsTrailerAgent[];
  secondaryAgents: HouseHighlightsTrailerAgent[];
  outcome: string;
  facts: HouseHighlightsTrailerFact[];
}

export interface HouseHighlightsTrailerFinalVoteGroup {
  finalist: HouseHighlightsTrailerAgent;
  votes: number;
  jurors: HouseHighlightsTrailerAgent[];
}

export interface HouseHighlightsTrailerFinalVote {
  finalists: HouseHighlightsTrailerAgent[];
  groups: HouseHighlightsTrailerFinalVoteGroup[];
  voteLabel: string;
  winner: HouseHighlightsTrailerAgent;
}

export type HouseHighlightsTrailerCueSegmentKind =
  | "cast_roster"
  | "scenelet"
  | "final_vote"
  | "winner"
  | "player_result";

export interface HouseHighlightsTrailerCueSegment {
  id: string;
  kind: HouseHighlightsTrailerCueSegmentKind;
  label: string;
  startFrame: number;
  endFrame: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface HouseHighlightsTrailerCueSheet {
  schemaVersion: 1;
  timingContractVersion: typeof HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION;
  frameRate: number;
  totalFrames: number;
  totalDurationSeconds: number;
  segments: HouseHighlightsTrailerCueSegment[];
  markers: {
    finalVoteRevealSeconds: number;
    winnerRevealSeconds: number;
  };
}

export interface HouseHighlightsTrailerManifest {
  schemaVersion: typeof HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION;
  mediaType: typeof HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE;
  timingContractVersion: typeof HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION;
  game: {
    id: string;
    slug: string | null;
    status: "completed";
  };
  frameRate: number;
  width: number;
  height: number;
  cast: HouseHighlightsTrailerAgent[];
  scenelets: HouseHighlightsTrailerScenelet[];
  finalVote: HouseHighlightsTrailerFinalVote;
  playerResults: HouseHighlightsTrailerPlayerResult[];
  cueSheet: HouseHighlightsTrailerCueSheet;
}

export interface HouseHighlightsTrailerManifestValidationResult {
  ok: boolean;
  errors: string[];
}

export const HOUSE_HIGHLIGHTS_TRAILER_WIDTH = 1920;
export const HOUSE_HIGHLIGHTS_TRAILER_HEIGHT = 1080;
export const HOUSE_HIGHLIGHTS_TRAILER_FPS = 30;
export const HOUSE_HIGHLIGHTS_TRAILER_CAST_SECONDS = 5;
export const HOUSE_HIGHLIGHTS_TRAILER_SCENE_SECONDS = 4;
export const HOUSE_HIGHLIGHTS_TRAILER_FINAL_VOTE_SECONDS = 5;
export const HOUSE_HIGHLIGHTS_TRAILER_WINNER_SECONDS = 4;
export const HOUSE_HIGHLIGHTS_TRAILER_PLAYER_RESULT_SECONDS = 1.8;

export type HouseHighlightsTrailerManifestErrorCode =
  | "game_not_completed"
  | "missing_completed_results"
  | "missing_finalists"
  | "missing_jury_vote"
  | "missing_winner";

export class HouseHighlightsTrailerManifestError extends Error {
  constructor(
    public readonly code: HouseHighlightsTrailerManifestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "HouseHighlightsTrailerManifestError";
  }
}

/**
 * Deliberately small structural input contract shared by the API snapshot
 * coordinator and the local developer adapter. It keeps web/Next response
 * types out of the renderer-facing engine package.
 */
export interface HouseHighlightsTrailerManifestBuildInput {
  highlightsResponse: HouseHighlightsTrailerHighlightsResponse;
  resultsResponse: HouseHighlightsTrailerResultsResponse;
  avatarUrls?: readonly { playerId: string; avatarUrl: string }[];
}

export interface HouseHighlightsTrailerPlayerRef {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export interface HouseHighlightsTrailerHighlightsResponse {
  game: { slug?: string | null };
  highlights: {
    scenes: readonly HouseHighlightsTrailerSourceScene[];
  };
}

export interface HouseHighlightsTrailerSourceScene {
  id: string;
  title: string;
  involvedAgents: readonly HouseHighlightsTrailerPlayerRef[];
  visualBrief: {
    visualType: string;
    primaryAgents: readonly HouseHighlightsTrailerPlayerRef[];
    secondaryAgents: readonly HouseHighlightsTrailerPlayerRef[];
  };
  visualCard: {
    title: string;
    backdrop: { category: string };
    primaryAgents: readonly HouseHighlightsTrailerPlayerRef[];
    secondaryAgents: readonly HouseHighlightsTrailerPlayerRef[];
    outcome: string;
    factLines: readonly {
      id: string;
      kind: HouseHighlightVisualCardFactKind;
      text: string;
      agentIds: readonly string[];
    }[];
  };
}

export interface HouseHighlightsTrailerResultsResponse {
  game: { id: string; slug?: string | null; status: string };
  results: {
    availability: { status: string };
    players: readonly HouseHighlightsTrailerSourcePlayer[];
    jury: {
      status: string;
      finalists: readonly HouseHighlightsTrailerPlayerRef[];
      voteCounts: readonly { finalist: HouseHighlightsTrailerPlayerRef; votes: number }[];
      ledger: readonly { juror: HouseHighlightsTrailerPlayerRef; finalist: HouseHighlightsTrailerPlayerRef }[];
      winner: HouseHighlightsTrailerPlayerRef | null;
    };
    summary: {
      finalists: readonly HouseHighlightsTrailerPlayerRef[];
      winner: HouseHighlightsTrailerPlayerRef | null;
    };
    eliminationOrder: readonly {
      player: HouseHighlightsTrailerPlayerRef;
      source: string;
      round: number;
    }[];
    rounds: readonly HouseHighlightsTrailerSourceRound[];
  };
}

export interface HouseHighlightsTrailerSourcePlayer {
  id: string;
  name: string;
  placement: number | null;
  status: HouseHighlightsTrailerAgentStatus;
}

export interface HouseHighlightsTrailerSourceRound {
  canonicalFacts: {
    roundFacts: {
      standardVote: {
        empowered: HouseHighlightsTrailerPlayerRef | null;
        ledger: readonly { exposeTarget: HouseHighlightsTrailerPlayerRef }[];
      };
      council: { ledger: readonly { target: HouseHighlightsTrailerPlayerRef }[] };
    };
  };
  endgameEliminations: readonly {
    ledger: readonly { target: HouseHighlightsTrailerPlayerRef }[];
    juryTiebreakerLedger: readonly { target: HouseHighlightsTrailerPlayerRef }[];
  }[];
}

const AGENT_STATUSES = new Set<HouseHighlightsTrailerAgentStatus>([
  "winner",
  "finalist",
  "eliminated",
  "unknown",
]);
const FACT_KINDS = new Set<HouseHighlightVisualCardFactKind>([
  "vote_action",
  "alliance_membership",
  "elimination",
  "protection",
  "survival",
  "jury_outcome",
  "round_context",
  "outcome",
]);
const CUE_KINDS = new Set<HouseHighlightsTrailerCueSegmentKind>([
  "cast_roster",
  "scenelet",
  "final_vote",
  "winner",
  "player_result",
]);

export function validateHouseHighlightsTrailerManifest(
  value: unknown,
): HouseHighlightsTrailerManifestValidationResult {
  const errors: string[] = [];
  const manifest = recordAt(value, "manifest", errors);
  if (!manifest) return { ok: false, errors };

  if (manifest.schemaVersion !== HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION) {
    errors.push(`schemaVersion must be ${HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION}`);
  }
  if (manifest.mediaType !== HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE) {
    errors.push(`mediaType must be ${HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE}`);
  }
  if (manifest.timingContractVersion !== HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION) {
    errors.push(
      `timingContractVersion must be ${HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION}`,
    );
  }

  validateGame(manifest.game, errors);
  positiveInteger(manifest.frameRate, "frameRate", errors);
  positiveInteger(manifest.width, "width", errors);
  positiveInteger(manifest.height, "height", errors);
  validateArray(manifest.cast, "cast", errors, validateAgent);
  validateArray(manifest.scenelets, "scenelets", errors, validateScenelet);
  validateFinalVote(manifest.finalVote, errors);
  validateArray(manifest.playerResults, "playerResults", errors, validatePlayerResult);
  validateCueSheet(manifest.cueSheet, manifest.frameRate, errors);

  return { ok: errors.length === 0, errors };
}

export function assertHouseHighlightsTrailerManifest(
  value: unknown,
): asserts value is HouseHighlightsTrailerManifest {
  const result = validateHouseHighlightsTrailerManifest(value);
  if (!result.ok) {
    throw new Error(`Invalid House Highlights trailer manifest: ${result.errors.join("; ")}`);
  }
}

export function parseHouseHighlightsTrailerManifest(
  value: string | unknown,
): HouseHighlightsTrailerManifest {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  assertHouseHighlightsTrailerManifest(parsed);
  return parsed;
}

export function serializeHouseHighlightsTrailerManifest(
  manifest: HouseHighlightsTrailerManifest,
): string {
  return stableJson(manifest);
}

export function hashHouseHighlightsTrailerManifest(
  manifest: HouseHighlightsTrailerManifest,
): string {
  return `sha256:${createHash("sha256")
    .update(serializeHouseHighlightsTrailerManifest(manifest))
    .digest("hex")}`;
}

export function buildHouseHighlightsTrailerManifest(
  input: HouseHighlightsTrailerManifestBuildInput,
): HouseHighlightsTrailerManifest {
  const { highlightsResponse, resultsResponse } = input;
  const results = resultsResponse.results;
  if (resultsResponse.game.status !== "completed") {
    throw new HouseHighlightsTrailerManifestError(
      "game_not_completed",
      "House Highlights trailers can only be rendered for completed games.",
    );
  }
  if (results.availability.status === "unavailable") {
    throw new HouseHighlightsTrailerManifestError(
      "missing_completed_results",
      "Completed results are unavailable for this game.",
    );
  }
  if (results.jury.status !== "available" || results.jury.ledger.length === 0) {
    throw new HouseHighlightsTrailerManifestError(
      "missing_jury_vote",
      "Final jury vote facts are unavailable for this game.",
    );
  }
  if (results.jury.finalists.length === 0) {
    throw new HouseHighlightsTrailerManifestError(
      "missing_finalists",
      "Finalists are unavailable for this game.",
    );
  }
  if (!results.jury.winner && !results.summary.winner) {
    throw new HouseHighlightsTrailerManifestError(
      "missing_winner",
      "Winner facts are unavailable for this game.",
    );
  }

  const avatarIndex = avatarIndexForHighlights(highlightsResponse, input.avatarUrls);
  const cast = results.players.map((player) => trailerAgent(player, avatarIndex));
  const agentById = new Map(cast.map((agent) => [agent.id, agent]));
  const scenelets = highlightsResponse.highlights.scenes.map((scene) =>
    sceneletFor(scene, agentById, avatarIndex),
  );
  const finalVote = finalVoteFor(results, agentById, avatarIndex);
  const playerResults = playerResultsFor(results, agentById);
  const cueSheet = buildHouseHighlightsTrailerCueSheet({ cast, scenelets, playerResults });

  return {
    schemaVersion: HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION,
    mediaType: HOUSE_HIGHLIGHTS_TRAILER_MEDIA_TYPE,
    timingContractVersion: HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION,
    game: {
      id: resultsResponse.game.id,
      slug: resultsResponse.game.slug ?? highlightsResponse.game.slug ?? null,
      status: "completed",
    },
    frameRate: HOUSE_HIGHLIGHTS_TRAILER_FPS,
    width: HOUSE_HIGHLIGHTS_TRAILER_WIDTH,
    height: HOUSE_HIGHLIGHTS_TRAILER_HEIGHT,
    cast,
    scenelets,
    finalVote,
    playerResults,
    cueSheet,
  };
}

export function buildHouseHighlightsTrailerCueSheet(params: {
  cast: readonly Pick<HouseHighlightsTrailerAgent, "id" | "name">[];
  scenelets: readonly Pick<HouseHighlightsTrailerScenelet, "id" | "title">[];
  playerResults: readonly Pick<HouseHighlightsTrailerPlayerResult, "agent">[];
}): HouseHighlightsTrailerCueSheet {
  const segments: HouseHighlightsTrailerCueSegment[] = [];
  let cursor = 0;
  cursor = pushCueSegment(segments, cursor, "cast_roster", "cast_roster", "Cast roster", HOUSE_HIGHLIGHTS_TRAILER_CAST_SECONDS);
  for (const scenelet of params.scenelets) {
    cursor = pushCueSegment(segments, cursor, `scenelet:${scenelet.id}`, "scenelet", scenelet.title, HOUSE_HIGHLIGHTS_TRAILER_SCENE_SECONDS);
  }
  const finalVoteRevealFrame = cursor;
  cursor = pushCueSegment(segments, cursor, "final_vote", "final_vote", "Final vote", HOUSE_HIGHLIGHTS_TRAILER_FINAL_VOTE_SECONDS);
  const winnerRevealFrame = cursor;
  cursor = pushCueSegment(segments, cursor, "winner", "winner", "Winner reveal", HOUSE_HIGHLIGHTS_TRAILER_WINNER_SECONDS);
  for (const result of params.playerResults) {
    cursor = pushCueSegment(segments, cursor, `player_result:${result.agent.id}`, "player_result", result.agent.name, HOUSE_HIGHLIGHTS_TRAILER_PLAYER_RESULT_SECONDS);
  }
  return {
    schemaVersion: HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION,
    timingContractVersion: HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION,
    frameRate: HOUSE_HIGHLIGHTS_TRAILER_FPS,
    totalFrames: cursor,
    totalDurationSeconds: secondsForFrame(cursor),
    segments,
    markers: {
      finalVoteRevealSeconds: secondsForFrame(finalVoteRevealFrame),
      winnerRevealSeconds: secondsForFrame(winnerRevealFrame),
    },
  };
}

function pushCueSegment(
  segments: HouseHighlightsTrailerCueSegment[],
  startFrame: number,
  id: string,
  kind: HouseHighlightsTrailerCueSegmentKind,
  label: string,
  durationSeconds: number,
): number {
  const durationFrames = Math.round(durationSeconds * HOUSE_HIGHLIGHTS_TRAILER_FPS);
  const endFrame = startFrame + durationFrames;
  segments.push({
    id,
    kind,
    label,
    startFrame,
    endFrame,
    startSeconds: secondsForFrame(startFrame),
    endSeconds: secondsForFrame(endFrame),
    durationSeconds: secondsForFrame(durationFrames),
  });
  return endFrame;
}

function sceneletFor(
  scene: HouseHighlightsTrailerSourceScene,
  agentById: ReadonlyMap<string, HouseHighlightsTrailerAgent>,
  avatarIndex: ReadonlyMap<string, string>,
): HouseHighlightsTrailerScenelet {
  return {
    id: scene.id,
    title: scene.visualCard.title || scene.title,
    visualType: scene.visualBrief.visualType,
    backgroundImage: generatedBackgroundAsset(scene.visualBrief.visualType)
      ?? fallbackBackdropAsset(scene.visualCard.backdrop.category),
    backdropCategory: scene.visualCard.backdrop.category,
    primaryAgents: scene.visualCard.primaryAgents.map((agent) => trailerAgentFromRef(agent, agentById, avatarIndex)),
    secondaryAgents: scene.visualCard.secondaryAgents.map((agent) => trailerAgentFromRef(agent, agentById, avatarIndex)),
    outcome: scene.visualCard.outcome,
    facts: scene.visualCard.factLines
      .filter((fact) => TRAILER_FACT_KINDS.has(fact.kind))
      .slice(0, 2)
      .map((fact) => ({ id: fact.id, kind: fact.kind, text: fact.text, agentIds: [...fact.agentIds] })),
  };
}

function finalVoteFor(
  results: HouseHighlightsTrailerResultsResponse["results"],
  agentById: ReadonlyMap<string, HouseHighlightsTrailerAgent>,
  avatarIndex: ReadonlyMap<string, string>,
): HouseHighlightsTrailerFinalVote {
  const finalists = results.jury.finalists.map((finalist) => trailerAgentFromRef(finalist, agentById, avatarIndex));
  const votesByFinalist = new Map(results.jury.voteCounts.map((entry) => [entry.finalist.id, entry.votes]));
  const jurorsByFinalist = new Map<string, HouseHighlightsTrailerAgent[]>();
  for (const entry of results.jury.ledger) {
    const jurors = jurorsByFinalist.get(entry.finalist.id) ?? [];
    jurors.push(trailerAgentFromRef(entry.juror, agentById, avatarIndex));
    jurorsByFinalist.set(entry.finalist.id, jurors);
  }
  const winner = results.jury.winner ?? results.summary.winner;
  if (!winner) {
    throw new HouseHighlightsTrailerManifestError("missing_winner", "Winner facts are unavailable for this game.");
  }
  return {
    finalists,
    groups: finalists.map((finalist) => ({
      finalist,
      votes: votesByFinalist.get(finalist.id) ?? 0,
      jurors: jurorsByFinalist.get(finalist.id) ?? [],
    })),
    voteLabel: finalVoteLabel(results.jury.voteCounts.map((entry) => entry.votes)),
    winner: trailerAgentFromRef(winner, agentById, avatarIndex),
  };
}

function playerResultsFor(
  results: HouseHighlightsTrailerResultsResponse["results"],
  agentById: ReadonlyMap<string, HouseHighlightsTrailerAgent>,
): HouseHighlightsTrailerPlayerResult[] {
  const seen = new Set<string>();
  const orderedAgents: HouseHighlightsTrailerAgent[] = [];
  for (const entry of results.eliminationOrder) {
    const agent = agentById.get(entry.player.id);
    if (agent && !seen.has(agent.id)) {
      seen.add(agent.id);
      orderedAgents.push(agent);
    }
  }
  for (const player of [...results.players].sort((left, right) => (right.placement ?? 0) - (left.placement ?? 0))) {
    const agent = agentById.get(player.id);
    if (agent && !seen.has(agent.id)) {
      seen.add(agent.id);
      orderedAgents.push(agent);
    }
  }
  const voteStats = voteStatsFor(results);
  const finalistIds = new Set(results.summary.finalists.map((finalist) => finalist.id));
  const jurorIds = new Set(results.jury.ledger.map((entry) => entry.juror.id));
  const winnerId = results.summary.winner?.id ?? results.jury.winner?.id ?? null;
  const finalVote = finalVoteLabel(results.jury.voteCounts.map((entry) => entry.votes));
  const mostTargetedIds = leaders(voteStats.received);
  const playersById = new Map(results.players.map((player) => [player.id, player]));
  const eliminationsByPlayerId = new Map(results.eliminationOrder.map((entry) => [entry.player.id, entry]));
  return orderedAgents.map((agent) => {
    const tags: string[] = [];
    const player = playersById.get(agent.id);
    const elimination = eliminationsByPlayerId.get(agent.id);
    const empoweredCount = voteStats.empowered.get(agent.id) ?? 0;
    if (winnerId === agent.id) {
      tags.push("Winner");
      if (finalVote) tags.push(`Won final vote ${finalVote}`);
    }
    if (finalistIds.has(agent.id)) tags.push("Reached final");
    if (winnerId !== agent.id && finalistIds.has(agent.id) && player?.placement === 2) tags.push("Runner-up");
    if (jurorIds.has(agent.id)) tags.push("Juror");
    if (elimination) tags.push(elimination.source === "jury" ? "Eliminated by jury vote" : `Eliminated in round ${elimination.round}`);
    if (empoweredCount > 0) tags.push(`Empowered ${empoweredCount}x`);
    if (mostTargetedIds.has(agent.id)) tags.push("Most targeted");
    return { agent, placementLabel: placementLabel(agent), tags: tags.slice(0, 5) };
  });
}

function voteStatsFor(results: HouseHighlightsTrailerResultsResponse["results"]): { empowered: Map<string, number>; received: Map<string, number> } {
  const empowered = new Map<string, number>();
  const received = new Map<string, number>();
  for (const round of results.rounds) {
    const facts = round.canonicalFacts.roundFacts;
    if (facts.standardVote.empowered) increment(empowered, facts.standardVote.empowered.id);
    for (const entry of facts.standardVote.ledger) increment(received, entry.exposeTarget.id);
    for (const entry of facts.council.ledger) increment(received, entry.target.id);
    for (const elimination of round.endgameEliminations) {
      for (const entry of elimination.ledger) increment(received, entry.target.id);
      for (const entry of elimination.juryTiebreakerLedger) increment(received, entry.target.id);
    }
  }
  return { empowered, received };
}

function avatarIndexForHighlights(
  response: HouseHighlightsTrailerHighlightsResponse,
  supplied: readonly { playerId: string; avatarUrl: string }[] = [],
): Map<string, string> {
  const avatars = new Map(supplied.map(({ playerId, avatarUrl }) => [playerId, avatarUrl]));
  for (const scene of response.highlights.scenes) {
    for (const agents of [scene.involvedAgents, scene.visualBrief.primaryAgents, scene.visualBrief.secondaryAgents, scene.visualCard.primaryAgents, scene.visualCard.secondaryAgents]) {
      for (const agent of agents) if (agent.avatarUrl && !avatars.has(agent.id)) avatars.set(agent.id, agent.avatarUrl);
    }
  }
  return avatars;
}

function trailerAgent(player: HouseHighlightsTrailerSourcePlayer, avatarIndex: ReadonlyMap<string, string>): HouseHighlightsTrailerAgent {
  return { id: player.id, name: player.name, initials: initialsFor(player.name), avatarUrl: avatarIndex.get(player.id) ?? fallbackPersonaAvatarUrl(player.name), placement: player.placement, status: player.status };
}

function trailerAgentFromRef(ref: HouseHighlightsTrailerPlayerRef, agentById: ReadonlyMap<string, HouseHighlightsTrailerAgent>, avatarIndex: ReadonlyMap<string, string>): HouseHighlightsTrailerAgent {
  const existing = agentById.get(ref.id);
  if (existing) return { ...existing, avatarUrl: ref.avatarUrl ?? existing.avatarUrl };
  return { id: ref.id, name: ref.name, initials: initialsFor(ref.name), avatarUrl: ref.avatarUrl ?? avatarIndex.get(ref.id) ?? fallbackPersonaAvatarUrl(ref.name), placement: null, status: "unknown" };
}

function finalVoteLabel(votes: readonly number[]): string { return [...votes].sort((left, right) => right - left).join("-"); }
function placementLabel(agent: HouseHighlightsTrailerAgent): string {
  if (agent.placement === 1) return "1st";
  if (agent.placement === 2) return "2nd";
  if (agent.placement === 3) return "3rd";
  return agent.placement ? `${agent.placement}th` : labelFromToken(agent.status);
}
function labelFromToken(value: string): string { return value.split(/[_: -]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" "); }
function secondsForFrame(frame: number): number { return Number((frame / HOUSE_HIGHLIGHTS_TRAILER_FPS).toFixed(3)); }
function increment(counts: Map<string, number>, key: string): void { counts.set(key, (counts.get(key) ?? 0) + 1); }
function leaders(counts: Map<string, number>): Set<string> { const max = Math.max(0, ...counts.values()); return max === 0 ? new Set() : new Set([...counts.entries()].filter(([, value]) => value === max).map(([key]) => key)); }
function fallbackBackdropAsset(category: string): string { return BACKDROP_ASSETS[category] ?? "/house-highlights/plates/abstract-vote-board.svg"; }
function generatedBackgroundAsset(visualType: string): string | null { return GENERATED_BACKGROUND_ASSETS[visualType] ?? null; }
function fallbackPersonaAvatarUrl(name: string): string { let hash = 0; for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return `/avatars/personas/${PERSONA_AVATAR_KEYS[hash % PERSONA_AVATAR_KEYS.length] ?? "strategic"}.png`; }
function initialsFor(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?"; }

const TRAILER_FACT_KINDS = new Set<HouseHighlightVisualCardFactKind>(["vote_action", "alliance_membership", "elimination", "protection", "survival", "jury_outcome", "outcome"]);
const GENERATED_BACKGROUND_ASSETS: Record<string, string> = {
  alliance_formation: "/house-highlights/generated/alliance-formation.jpg", alliance_rupture: "/house-highlights/generated/alliance-rupture.jpg", betrayal_vote: "/house-highlights/generated/betrayal-vote.jpg", vote_flip: "/house-highlights/generated/vote-flip.jpg", unlikely_survival: "/house-highlights/generated/unlikely-survival.jpg", shield_survival: "/house-highlights/generated/shield-survival.jpg", power_streak: "/house-highlights/generated/power-streak.jpg", council_slate: "/house-highlights/generated/council-slate.jpg", revenge_vote: "/house-highlights/generated/revenge-vote.jpg", jury_judgment: "/house-highlights/generated/jury-judgment.jpg", endgame_collapse: "/house-highlights/generated/endgame-collapse.jpg",
};
const BACKDROP_ASSETS: Record<string, string> = {
  empty_council_chamber: "/house-highlights/plates/empty-council-chamber.svg", jury_wall: "/house-highlights/plates/jury-wall.svg", abstract_vote_board: "/house-highlights/plates/abstract-vote-board.svg", fractured_alliance_table: "/house-highlights/plates/fractured-alliance-table.svg", spotlight_stage: "/house-highlights/plates/spotlight-stage.svg", surveillance_board_texture: "/house-highlights/plates/surveillance-board-texture.svg",
};
const PERSONA_AVATAR_KEYS = ["honest", "strategic", "deceptive", "paranoid", "social", "aggressive", "loyalist", "observer", "diplomat", "wildcard", "contrarian", "provocateur", "martyr"] as const;

function validateGame(value: unknown, errors: string[]): void {
  const game = recordAt(value, "game", errors);
  if (!game) return;
  nonEmptyString(game.id, "game.id", errors);
  if (game.slug !== null) nonEmptyString(game.slug, "game.slug", errors);
  if (game.status !== "completed") errors.push("game.status must be completed");
}

function validateAgent(value: unknown, path: string, errors: string[]): void {
  const agent = recordAt(value, path, errors);
  if (!agent) return;
  nonEmptyString(agent.id, `${path}.id`, errors);
  nonEmptyString(agent.name, `${path}.name`, errors);
  nonEmptyString(agent.initials, `${path}.initials`, errors);
  stringValue(agent.avatarUrl, `${path}.avatarUrl`, errors);
  if (agent.placement !== null) positiveInteger(agent.placement, `${path}.placement`, errors);
  if (!AGENT_STATUSES.has(agent.status as HouseHighlightsTrailerAgentStatus)) {
    errors.push(`${path}.status is invalid`);
  }
}

function validateScenelet(value: unknown, path: string, errors: string[]): void {
  const scenelet = recordAt(value, path, errors);
  if (!scenelet) return;
  nonEmptyString(scenelet.id, `${path}.id`, errors);
  nonEmptyString(scenelet.title, `${path}.title`, errors);
  nonEmptyString(scenelet.visualType, `${path}.visualType`, errors);
  nonEmptyString(scenelet.backgroundImage, `${path}.backgroundImage`, errors);
  nonEmptyString(scenelet.backdropCategory, `${path}.backdropCategory`, errors);
  nonEmptyString(scenelet.outcome, `${path}.outcome`, errors);
  validateArray(scenelet.primaryAgents, `${path}.primaryAgents`, errors, validateAgent);
  validateArray(scenelet.secondaryAgents, `${path}.secondaryAgents`, errors, validateAgent);
  validateArray(scenelet.facts, `${path}.facts`, errors, validateFact);
}

function validateFact(value: unknown, path: string, errors: string[]): void {
  const fact = recordAt(value, path, errors);
  if (!fact) return;
  nonEmptyString(fact.id, `${path}.id`, errors);
  nonEmptyString(fact.text, `${path}.text`, errors);
  if (!FACT_KINDS.has(fact.kind as HouseHighlightVisualCardFactKind)) {
    errors.push(`${path}.kind is invalid`);
  }
  stringArray(fact.agentIds, `${path}.agentIds`, errors);
}

function validateFinalVote(value: unknown, errors: string[]): void {
  const finalVote = recordAt(value, "finalVote", errors);
  if (!finalVote) return;
  validateArray(finalVote.finalists, "finalVote.finalists", errors, validateAgent);
  validateArray(finalVote.groups, "finalVote.groups", errors, validateFinalVoteGroup);
  nonEmptyString(finalVote.voteLabel, "finalVote.voteLabel", errors);
  if (!isRecord(finalVote.winner)) {
    errors.push("finalVote.winner must be an agent");
  } else {
    validateAgent(finalVote.winner, "finalVote.winner", errors);
  }
}

function validateFinalVoteGroup(value: unknown, path: string, errors: string[]): void {
  const group = recordAt(value, path, errors);
  if (!group) return;
  validateAgent(group.finalist, `${path}.finalist`, errors);
  nonNegativeInteger(group.votes, `${path}.votes`, errors);
  validateArray(group.jurors, `${path}.jurors`, errors, validateAgent);
}

function validatePlayerResult(value: unknown, path: string, errors: string[]): void {
  const result = recordAt(value, path, errors);
  if (!result) return;
  validateAgent(result.agent, `${path}.agent`, errors);
  nonEmptyString(result.placementLabel, `${path}.placementLabel`, errors);
  stringArray(result.tags, `${path}.tags`, errors);
}

function validateCueSheet(value: unknown, frameRate: unknown, errors: string[]): void {
  const cueSheet = recordAt(value, "cueSheet", errors);
  if (!cueSheet) return;
  if (cueSheet.schemaVersion !== HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION) {
    errors.push(`cueSheet.schemaVersion must be ${HOUSE_HIGHLIGHTS_TRAILER_MANIFEST_VERSION}`);
  }
  if (cueSheet.timingContractVersion !== HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION) {
    errors.push(
      `cueSheet.timingContractVersion must be ${HOUSE_HIGHLIGHTS_TRAILER_TIMING_CONTRACT_VERSION}`,
    );
  }
  positiveInteger(cueSheet.frameRate, "cueSheet.frameRate", errors);
  if (typeof frameRate === "number" && cueSheet.frameRate !== frameRate) {
    errors.push("cueSheet.frameRate must match frameRate");
  }
  nonNegativeInteger(cueSheet.totalFrames, "cueSheet.totalFrames", errors);
  nonNegativeNumber(
    cueSheet.totalDurationSeconds,
    "cueSheet.totalDurationSeconds",
    errors,
  );
  validateArray(cueSheet.segments, "cueSheet.segments", errors, validateCueSegment);

  const markers = recordAt(cueSheet.markers, "cueSheet.markers", errors);
  if (markers) {
    nonNegativeNumber(
      markers.finalVoteRevealSeconds,
      "cueSheet.markers.finalVoteRevealSeconds",
      errors,
    );
    nonNegativeNumber(
      markers.winnerRevealSeconds,
      "cueSheet.markers.winnerRevealSeconds",
      errors,
    );
  }
}

function validateCueSegment(value: unknown, path: string, errors: string[]): void {
  const segment = recordAt(value, path, errors);
  if (!segment) return;
  nonEmptyString(segment.id, `${path}.id`, errors);
  nonEmptyString(segment.label, `${path}.label`, errors);
  if (!CUE_KINDS.has(segment.kind as HouseHighlightsTrailerCueSegmentKind)) {
    errors.push(`${path}.kind is invalid`);
  }
  nonNegativeInteger(segment.startFrame, `${path}.startFrame`, errors);
  nonNegativeInteger(segment.endFrame, `${path}.endFrame`, errors);
  nonNegativeNumber(segment.startSeconds, `${path}.startSeconds`, errors);
  nonNegativeNumber(segment.endSeconds, `${path}.endSeconds`, errors);
  nonNegativeNumber(segment.durationSeconds, `${path}.durationSeconds`, errors);
  if (
    typeof segment.startFrame === "number"
    && typeof segment.endFrame === "number"
    && segment.endFrame <= segment.startFrame
  ) {
    errors.push(`${path}.endFrame must be greater than startFrame`);
  }
}

function validateArray(
  value: unknown,
  path: string,
  errors: string[],
  validateEntry: (entry: unknown, path: string, errors: string[]) => void,
): void {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return;
  }
  value.forEach((entry, index) => validateEntry(entry, `${path}[${index}]`, errors));
}

function stringArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    errors.push(`${path} must be an array of strings`);
  }
}

function nonEmptyString(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function stringValue(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string") errors.push(`${path} must be a string`);
}

function positiveInteger(value: unknown, path: string, errors: string[]): void {
  if (!Number.isInteger(value) || Number(value) < 1) {
    errors.push(`${path} must be a positive integer`);
  }
}

function nonNegativeInteger(value: unknown, path: string, errors: string[]): void {
  if (!Number.isInteger(value) || Number(value) < 0) {
    errors.push(`${path} must be a non-negative integer`);
  }
}

function nonNegativeNumber(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${path} must be a non-negative number`);
  }
}

function recordAt(
  value: unknown,
  path: string,
  errors: string[],
): Record<string, unknown> | null {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => entry === undefined ? "null" : stableJson(entry)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}
