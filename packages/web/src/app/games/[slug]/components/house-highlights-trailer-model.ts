import type {
  CompletedGameResultsPlayer,
  CompletedGameResultsPlayerRef,
  CompletedGameResultsResponse,
  HouseHighlightPlayerRef,
  HouseHighlightSceneCard,
  HouseHighlightVisualCardFact,
  HouseHighlightsResponse,
} from "@/lib/api";
import {
  houseHighlightBackdropAsset,
  houseHighlightGeneratedBackgroundAsset,
} from "./house-highlights-backgrounds";

export const HOUSE_HIGHLIGHTS_TRAILER_WIDTH = 1920;
export const HOUSE_HIGHLIGHTS_TRAILER_HEIGHT = 1080;
export const HOUSE_HIGHLIGHTS_TRAILER_FPS = 30;
export const HOUSE_HIGHLIGHTS_TRAILER_CAST_SECONDS = 5;
export const HOUSE_HIGHLIGHTS_TRAILER_SCENE_SECONDS = 4;
export const HOUSE_HIGHLIGHTS_TRAILER_FINAL_VOTE_SECONDS = 5;
export const HOUSE_HIGHLIGHTS_TRAILER_WINNER_SECONDS = 4;
export const HOUSE_HIGHLIGHTS_TRAILER_PLAYER_RESULT_SECONDS = 1.8;

type TrailerSegmentKind = "cast_roster" | "scenelet" | "final_vote" | "winner" | "player_result";

export interface HouseHighlightsTrailerAgent {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string;
  placement: number | null;
  status: "winner" | "finalist" | "eliminated" | "unknown";
}

export interface HouseHighlightsTrailerFact {
  id: string;
  kind: HouseHighlightVisualCardFact["kind"];
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

export interface HouseHighlightsTrailerCueSegment {
  id: string;
  kind: TrailerSegmentKind;
  label: string;
  startFrame: number;
  endFrame: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

export interface HouseHighlightsTrailerCueSheet {
  schemaVersion: 1;
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
  schemaVersion: 1;
  game: {
    id: string;
    slug: string | null;
    status: string;
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

export function buildHouseHighlightsTrailerManifest(params: {
  highlightsResponse: HouseHighlightsResponse;
  resultsResponse: CompletedGameResultsResponse;
}): HouseHighlightsTrailerManifest {
  const { highlightsResponse, resultsResponse } = params;
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

  const avatarIndex = avatarIndexForHighlights(highlightsResponse);
  const cast = results.players.map((player) => trailerAgent(player, avatarIndex));
  const agentById = new Map(cast.map((agent) => [agent.id, agent]));
  const scenelets = highlightsResponse.highlights.scenes.map((scene) => sceneletFor(scene, agentById, avatarIndex));
  const finalVote = finalVoteFor(resultsResponse, agentById, avatarIndex);
  const playerResults = playerResultsFor(results, agentById);
  const cueSheet = buildHouseHighlightsTrailerCueSheet({
    cast,
    scenelets,
    playerResults,
  });

  return {
    schemaVersion: 1,
    game: {
      id: resultsResponse.game.id,
      slug: resultsResponse.game.slug ?? highlightsResponse.game.slug ?? null,
      status: resultsResponse.game.status,
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

  cursor = pushCueSegment(segments, cursor, {
    id: "cast_roster",
    kind: "cast_roster",
    label: "Cast roster",
    durationSeconds: HOUSE_HIGHLIGHTS_TRAILER_CAST_SECONDS,
  });

  for (const scenelet of params.scenelets) {
    cursor = pushCueSegment(segments, cursor, {
      id: `scenelet:${scenelet.id}`,
      kind: "scenelet",
      label: scenelet.title,
      durationSeconds: HOUSE_HIGHLIGHTS_TRAILER_SCENE_SECONDS,
    });
  }

  const finalVoteRevealFrame = cursor;
  cursor = pushCueSegment(segments, cursor, {
    id: "final_vote",
    kind: "final_vote",
    label: "Final vote",
    durationSeconds: HOUSE_HIGHLIGHTS_TRAILER_FINAL_VOTE_SECONDS,
  });

  const winnerRevealFrame = cursor;
  cursor = pushCueSegment(segments, cursor, {
    id: "winner",
    kind: "winner",
    label: "Winner reveal",
    durationSeconds: HOUSE_HIGHLIGHTS_TRAILER_WINNER_SECONDS,
  });

  for (const result of params.playerResults) {
    cursor = pushCueSegment(segments, cursor, {
      id: `player_result:${result.agent.id}`,
      kind: "player_result",
      label: result.agent.name,
      durationSeconds: HOUSE_HIGHLIGHTS_TRAILER_PLAYER_RESULT_SECONDS,
    });
  }

  return {
    schemaVersion: 1,
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
  params: {
    id: string;
    kind: TrailerSegmentKind;
    label: string;
    durationSeconds: number;
  },
): number {
  const durationFrames = Math.round(params.durationSeconds * HOUSE_HIGHLIGHTS_TRAILER_FPS);
  const endFrame = startFrame + durationFrames;
  segments.push({
    id: params.id,
    kind: params.kind,
    label: params.label,
    startFrame,
    endFrame,
    startSeconds: secondsForFrame(startFrame),
    endSeconds: secondsForFrame(endFrame),
    durationSeconds: secondsForFrame(durationFrames),
  });
  return endFrame;
}

function secondsForFrame(frame: number): number {
  return Number((frame / HOUSE_HIGHLIGHTS_TRAILER_FPS).toFixed(3));
}

function sceneletFor(
  scene: HouseHighlightSceneCard,
  agentById: ReadonlyMap<string, HouseHighlightsTrailerAgent>,
  avatarIndex: ReadonlyMap<string, string>,
): HouseHighlightsTrailerScenelet {
  return {
    id: scene.id,
    title: scene.visualCard.title || scene.title,
    visualType: scene.visualBrief.visualType,
    backgroundImage: houseHighlightGeneratedBackgroundAsset(scene.visualBrief.visualType)
      ?? fallbackBackdropAsset(scene.visualCard.backdrop.category),
    backdropCategory: scene.visualCard.backdrop.category,
    primaryAgents: scene.visualCard.primaryAgents.map((agent) => trailerAgentFromRef(agent, agentById, avatarIndex)),
    secondaryAgents: scene.visualCard.secondaryAgents.map((agent) => trailerAgentFromRef(agent, agentById, avatarIndex)),
    outcome: scene.visualCard.outcome,
    facts: trailerFactsForScene(scene),
  };
}

function finalVoteFor(
  resultsResponse: CompletedGameResultsResponse,
  agentById: ReadonlyMap<string, HouseHighlightsTrailerAgent>,
  avatarIndex: ReadonlyMap<string, string>,
): HouseHighlightsTrailerFinalVote {
  const results = resultsResponse.results;
  const finalists = results.jury.finalists.map((finalist) => trailerAgentFromRef(finalist, agentById, avatarIndex));
  const votesByFinalist = new Map(results.jury.voteCounts.map((entry) => [entry.finalist.id, entry.votes]));
  const jurorsByFinalist = new Map<string, HouseHighlightsTrailerAgent[]>();
  for (const entry of results.jury.ledger) {
    const jurors = jurorsByFinalist.get(entry.finalist.id) ?? [];
    jurors.push(trailerAgentFromRef(entry.juror, agentById, avatarIndex));
    jurorsByFinalist.set(entry.finalist.id, jurors);
  }
  const winnerRef = results.jury.winner ?? results.summary.winner;
  if (!winnerRef) {
    throw new HouseHighlightsTrailerManifestError(
      "missing_winner",
      "Winner facts are unavailable for this game.",
    );
  }

  return {
    finalists,
    groups: finalists.map((finalist) => ({
      finalist,
      votes: votesByFinalist.get(finalist.id) ?? 0,
      jurors: jurorsByFinalist.get(finalist.id) ?? [],
    })),
    voteLabel: finalVoteLabel(results.jury.voteCounts.map((entry) => entry.votes)),
    winner: trailerAgentFromRef(winnerRef, agentById, avatarIndex),
  };
}

function playerResultsFor(
  results: CompletedGameResultsResponse["results"],
  agentById: ReadonlyMap<string, HouseHighlightsTrailerAgent>,
): HouseHighlightsTrailerPlayerResult[] {
  const seen = new Set<string>();
  const orderedAgents: HouseHighlightsTrailerAgent[] = [];
  for (const entry of results.eliminationOrder) {
    const agent = agentById.get(entry.player.id);
    if (!agent || seen.has(agent.id)) continue;
    seen.add(agent.id);
    orderedAgents.push(agent);
  }
  for (const player of [...results.players].sort((left, right) =>
    (right.placement ?? 0) - (left.placement ?? 0)
  )) {
    const agent = agentById.get(player.id);
    if (!agent || seen.has(agent.id)) continue;
    seen.add(agent.id);
    orderedAgents.push(agent);
  }

  const voteStats = voteStatsFor(results);
  const finalistIds = new Set(results.summary.finalists.map((finalist) => finalist.id));
  const jurorIds = new Set(results.jury.ledger.map((entry) => entry.juror.id));
  const winnerId = results.summary.winner?.id ?? results.jury.winner?.id ?? null;
  const finalVoteLabelValue = finalVoteLabel(results.jury.voteCounts.map((entry) => entry.votes));
  const mostTargetedIds = leaders(voteStats.received);
  const playersById = new Map(results.players.map((player) => [player.id, player] as const));
  const eliminationsByPlayerId = new Map(results.eliminationOrder.map((entry) => [entry.player.id, entry] as const));

  return orderedAgents.map((agent) => {
    const tags: string[] = [];
    const player = playersById.get(agent.id);
    const elimination = eliminationsByPlayerId.get(agent.id);
    const empoweredCount = voteStats.empowered.get(agent.id) ?? 0;
    if (winnerId === agent.id) {
      tags.push("Winner");
      if (finalVoteLabelValue) tags.push(`Won final vote ${finalVoteLabelValue}`);
    }
    if (finalistIds.has(agent.id)) tags.push("Reached final");
    if (winnerId !== agent.id && finalistIds.has(agent.id) && player?.placement === 2) tags.push("Runner-up");
    if (jurorIds.has(agent.id)) tags.push("Juror");
    if (elimination) tags.push(elimination.source === "jury" ? "Eliminated by jury vote" : `Eliminated in round ${elimination.round}`);
    if (empoweredCount > 0) tags.push(`Empowered ${empoweredCount}x`);
    if (mostTargetedIds.has(agent.id)) tags.push("Most targeted");

    return {
      agent,
      placementLabel: placementLabel(agent),
      tags: tags.slice(0, 5),
    };
  });
}

function voteStatsFor(results: CompletedGameResultsResponse["results"]): {
  empowered: Map<string, number>;
  received: Map<string, number>;
} {
  const empowered = new Map<string, number>();
  const received = new Map<string, number>();
  for (const round of results.rounds) {
    const roundFacts = round.canonicalFacts.roundFacts;
    const empoweredPlayer = roundFacts.standardVote.empowered;
    if (empoweredPlayer) increment(empowered, empoweredPlayer.id);
    for (const entry of roundFacts.standardVote.ledger) increment(received, entry.exposeTarget.id);
    for (const entry of roundFacts.council.ledger) increment(received, entry.target.id);
    for (const elimination of round.endgameEliminations) {
      for (const entry of elimination.ledger) increment(received, entry.target.id);
      for (const entry of elimination.juryTiebreakerLedger) increment(received, entry.target.id);
    }
  }
  return { empowered, received };
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function leaders(counts: Map<string, number>): Set<string> {
  const max = Math.max(0, ...counts.values());
  if (max === 0) return new Set();
  return new Set([...counts.entries()].filter(([, value]) => value === max).map(([key]) => key));
}

function trailerFactsForScene(scene: HouseHighlightSceneCard): HouseHighlightsTrailerFact[] {
  return scene.visualCard.factLines
    .filter((fact) => TRAILER_FACT_KINDS.has(fact.kind))
    .slice(0, 2)
    .map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      text: fact.text,
      agentIds: fact.agentIds,
    }));
}

const TRAILER_FACT_KINDS = new Set<HouseHighlightVisualCardFact["kind"]>([
  "vote_action",
  "alliance_membership",
  "elimination",
  "protection",
  "survival",
  "jury_outcome",
  "outcome",
]);

function avatarIndexForHighlights(response: HouseHighlightsResponse): Map<string, string> {
  const avatars = new Map<string, string>();
  for (const scene of response.highlights.scenes) {
    collectAvatars(avatars, scene.involvedAgents);
    collectAvatars(avatars, scene.visualBrief.primaryAgents);
    collectAvatars(avatars, scene.visualBrief.secondaryAgents);
    collectAvatars(avatars, scene.visualCard.primaryAgents);
    collectAvatars(avatars, scene.visualCard.secondaryAgents);
  }
  return avatars;
}

function collectAvatars(
  avatars: Map<string, string>,
  agents: readonly HouseHighlightPlayerRef[],
): void {
  for (const agent of agents) {
    if (agent.avatarUrl && !avatars.has(agent.id)) {
      avatars.set(agent.id, agent.avatarUrl);
    }
  }
}

function trailerAgent(
  player: CompletedGameResultsPlayer,
  avatarIndex: ReadonlyMap<string, string>,
): HouseHighlightsTrailerAgent {
  return {
    id: player.id,
    name: player.name,
    initials: initialsFor(player.name),
    avatarUrl: avatarIndex.get(player.id) ?? fallbackPersonaAvatarUrl(player.name),
    placement: player.placement,
    status: player.status,
  };
}

function trailerAgentFromRef(
  ref: CompletedGameResultsPlayerRef | HouseHighlightPlayerRef,
  agentById: ReadonlyMap<string, HouseHighlightsTrailerAgent>,
  avatarIndex: ReadonlyMap<string, string>,
): HouseHighlightsTrailerAgent {
  const existing = agentById.get(ref.id);
  if (existing) {
    return {
      ...existing,
      avatarUrl: avatarUrlForRef(ref) ?? existing.avatarUrl,
    };
  }
  return {
    id: ref.id,
    name: ref.name,
    initials: initialsFor(ref.name),
    avatarUrl: avatarUrlForRef(ref) ?? avatarIndex.get(ref.id) ?? fallbackPersonaAvatarUrl(ref.name),
    placement: null,
    status: "unknown",
  };
}

function avatarUrlForRef(ref: CompletedGameResultsPlayerRef | HouseHighlightPlayerRef): string | null {
  return "avatarUrl" in ref ? ref.avatarUrl ?? null : null;
}

function finalVoteLabel(votes: number[]): string {
  return [...votes].sort((left, right) => right - left).join("-");
}

function placementLabel(agent: HouseHighlightsTrailerAgent): string {
  if (agent.placement === 1) return "1st";
  if (agent.placement === 2) return "2nd";
  if (agent.placement === 3) return "3rd";
  return agent.placement ? `${agent.placement}th` : labelFromToken(agent.status);
}

function labelFromToken(value: string): string {
  return value
    .split(/[_: -]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function fallbackBackdropAsset(category: string): string {
  return houseHighlightBackdropAsset(category) ?? "/house-highlights/plates/abstract-vote-board.svg";
}

const PERSONA_AVATAR_KEYS = [
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

function fallbackPersonaAvatarUrl(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const key = PERSONA_AVATAR_KEYS[hash % PERSONA_AVATAR_KEYS.length] ?? "strategic";
  return `/avatars/personas/${key}.png`;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";
}
