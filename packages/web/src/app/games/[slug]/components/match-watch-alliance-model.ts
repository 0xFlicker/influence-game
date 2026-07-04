import type {
  GamePlayer,
  PhaseKey,
  PublicAllianceHuddleRead,
  PublicAllianceProposalRead,
  PublicAllianceRecordRead,
  PublicGameAlliancesResponse,
} from "@/lib/api";
import type { MatchWatchModel } from "./match-watch-model";

export type AllianceFactsLoadState = "idle" | "loading" | "ready" | "error";

export interface AllianceFactsState {
  loadState: AllianceFactsLoadState;
  facts: PublicGameAlliancesResponse | null;
  error?: string | null;
}

export interface MatchWatchAllianceHuddleModel {
  id: string;
  allianceId: string;
  allianceName: string;
  round: number;
  window: string;
  pass: number;
  speakerNames: string[];
  messageCount: number;
  outcomeSummary: string | null;
  messages: Array<{ fromName: string; text: string; timestamp: number }>;
}

export interface MatchWatchAllianceCardModel {
  id: string;
  name: string;
  status: string;
  members: Array<{
    id: string | null;
    name: string;
    persona?: string;
    personaKey?: string;
    avatarUrl?: string;
  }>;
  memberNames: string[];
  purpose: string | null;
  timebox: string | null;
  proposedRound: number | null;
  createdRound: number | null;
  updatedRound: number | null;
  proposalCount: number;
  latestProposalStatus: string | null;
  latestOutcomeSummary: string | null;
  consequences: Array<{
    type: string;
    round: number;
    description: string;
    confidence: string;
    playerNames: string[];
  }>;
  huddles: MatchWatchAllianceHuddleModel[];
}

export interface MatchWatchAlliancePanelModel {
  status: "select_player" | "loading" | "error" | "empty" | "ready";
  selectedPlayerName: string | null;
  reason: string | null;
  summary: {
    proposalCount: number;
    allianceCount: number;
    huddleCount: number;
    latestHuddleRound: number | null;
  };
  cards: MatchWatchAllianceCardModel[];
}

export interface CompletedAllianceArcsModel {
  status: "loading" | "error" | "empty" | "ready";
  reason: string | null;
  summary: {
    proposalCount: number;
    allianceCount: number;
    huddleCount: number;
    latestHuddleRound: number | null;
  };
  cards: MatchWatchAllianceCardModel[];
}

export function buildMatchWatchAlliancePanelModel({
  model,
  allianceState,
}: {
  model: MatchWatchModel;
  allianceState: AllianceFactsState;
}): MatchWatchAlliancePanelModel {
  const selectedPlayerId = model.selectedPlayerId;
  const selectedPlayerName = model.selectedPlayer?.player.name ?? null;

  if (!selectedPlayerId) {
    return emptyPanel("select_player", selectedPlayerName, "Select a player to inspect their alliance arc.");
  }

  if (allianceState.loadState === "loading" && !allianceState.facts) {
    return emptyPanel("loading", selectedPlayerName, "Loading alliance facts...");
  }

  if (allianceState.loadState === "error" && !allianceState.facts) {
    return emptyPanel("error", selectedPlayerName, allianceState.error ?? "Alliance facts are unavailable.");
  }

  if (!allianceState.facts) {
    return emptyPanel("empty", selectedPlayerName, "No alliance facts are available yet.");
  }

  const visibleFacts = sliceAllianceFactsThroughCursor(allianceState.facts, {
    round: model.round,
    phase: model.phase,
  });
  const playerById = new Map(model.players.map((card) => [card.player.id, card.player]));
  const cards = buildAllianceCards(
    visibleFacts,
    (entry) => playerIsInAllianceEntry(entry, selectedPlayerId),
    playerById,
  );
  if (cards.length === 0) {
    return {
      ...emptyPanel("empty", selectedPlayerName, `${selectedPlayerName ?? "This player"} has no recorded named alliances yet.`),
      summary: {
        proposalCount: 0,
        allianceCount: 0,
        huddleCount: 0,
        latestHuddleRound: null,
      },
    };
  }

  return {
    status: "ready",
    selectedPlayerName,
    reason: null,
    summary: summarizeCards(cards),
    cards,
  };
}

export function buildCompletedAllianceArcsModel(
  allianceState: AllianceFactsState,
  players: readonly GamePlayer[] = [],
): CompletedAllianceArcsModel {
  if (allianceState.loadState === "loading" && !allianceState.facts) {
    return emptyCompleted("loading", "Loading alliance arcs...");
  }
  if (allianceState.loadState === "error" && !allianceState.facts) {
    return emptyCompleted("error", allianceState.error ?? "Alliance arcs are unavailable.");
  }
  if (!allianceState.facts) {
    return emptyCompleted("empty", "No alliance facts are available for this game.");
  }

  const playerById = new Map(players.map((player) => [player.id, player]));
  const cards = buildAllianceCards(allianceState.facts, () => true, playerById);
  if (cards.length === 0) {
    return {
      ...emptyCompleted("empty", "No named alliances were recorded in this game."),
      summary: {
        proposalCount: allianceState.facts.allianceFacts.summary.proposalCount,
        allianceCount: 0,
        huddleCount: 0,
        latestHuddleRound: null,
      },
    };
  }

  return {
    status: "ready",
    reason: null,
    summary: summarizeCards(cards),
    cards,
  };
}

type AllianceEntry =
  | { kind: "record"; record: PublicAllianceRecordRead; proposal?: PublicAllianceProposalRead }
  | { kind: "proposal"; proposal: PublicAllianceProposalRead };

const ALLIANCE_REPLAY_PHASE_ORDER: readonly PhaseKey[] = [
  "INIT",
  "INTRODUCTION",
  "LOBBY",
  "MINGLE_I",
  "PRE_VOTE_HUDDLE",
  "VOTE",
  "WHISPER",
  "MINGLE",
  "POST_VOTE_MINGLE",
  "RUMOR",
  "POWER",
  "REVEAL",
  "PRE_COUNCIL_HUDDLE",
  "COUNCIL",
  "PLEA",
  "ACCUSATION",
  "DEFENSE",
  "DIARY_ROOM",
  "OPENING_STATEMENTS",
  "JURY_QUESTIONS",
  "CLOSING_ARGUMENTS",
  "JURY_VOTE",
  "END",
  "SUSPENDED",
];

function sliceAllianceFactsThroughCursor(
  facts: PublicGameAlliancesResponse,
  cursor: { round: number; phase: PhaseKey },
): PublicGameAlliancesResponse {
  const huddles = facts.allianceFacts.huddles
    .filter((huddle) => isAllianceFactAtOrBeforeCursor({
      round: huddle.round,
      phase: huddle.phase ?? phaseForHuddleWindow(huddle.window),
      cursor,
    }));
  const proposals = facts.allianceFacts.proposals
    .filter((proposal) => isAllianceFactAtOrBeforeCursor({
      round: proposal.proposedRound,
      phase: proposal.proposedPhase ?? "MINGLE_I",
      cursor,
    }))
    .map((proposal) => sliceProposalThroughCursor(proposal, cursor));
  const alliances = facts.allianceFacts.alliances
    .filter((record) => isAllianceFactAtOrBeforeCursor({
      round: record.createdRound,
      phase: record.createdPhase ?? "MINGLE_I",
      cursor,
    }))
    .map((record) => sliceAllianceRecordThroughCursor(record, huddles, cursor));

  return {
    ...facts,
    allianceFacts: {
      ...facts.allianceFacts,
      summary: {
        proposalCount: proposals.length,
        activeAllianceCount: alliances.filter((record) => record.status === "active").length,
        closedAllianceCount: alliances.filter((record) => record.status === "closed").length,
        archivedAllianceCount: alliances.filter((record) => record.status === "archived").length,
        huddleCount: huddles.length,
        latestHuddleRound: Math.max(0, ...huddles.map((huddle) => huddle.round)) || null,
      },
      proposals,
      alliances,
      huddles,
    },
  };
}

function sliceProposalThroughCursor(
  proposal: PublicAllianceProposalRead,
  cursor: { round: number; phase: PhaseKey },
): PublicAllianceProposalRead {
  if (
    proposal.resolvedRound === undefined
    || isAllianceFactAtOrBeforeCursor({
      round: proposal.resolvedRound,
      phase: proposal.resolvedPhase ?? "PRE_VOTE_HUDDLE",
      cursor,
    })
  ) {
    return proposal;
  }

  const pendingProposal = {
    ...proposal,
    status: "pending",
    finalResult: "pending",
  };
  delete pendingProposal.resolvedRound;
  return pendingProposal;
}

function sliceAllianceRecordThroughCursor(
  record: PublicAllianceRecordRead,
  visibleHuddles: readonly PublicAllianceHuddleRead[],
  cursor: { round: number; phase: PhaseKey },
): PublicAllianceRecordRead {
  const visibleOutcomes = visibleHuddles
    .filter((huddle) => huddle.allianceId === record.id && huddle.outcome)
    .map((huddle) => huddle.outcome)
    .filter((outcome): outcome is NonNullable<PublicAllianceHuddleRead["outcome"]> => Boolean(outcome))
    .sort((left, right) => right.round - left.round);
  const latestOutcome = visibleOutcomes[0];
  const futureStatusUpdate = !isAllianceFactAtOrBeforeCursor({
    round: record.updatedRound,
    phase: record.updatedPhase ?? "PRE_VOTE_HUDDLE",
    cursor,
  });
  const status = futureStatusUpdate && record.status !== "active"
    ? "active"
    : record.status;
  const slicedRecord = {
    ...record,
    status,
    updatedRound: record.updatedRound > cursor.round ? cursor.round : record.updatedRound,
    huddleOutcomeCount: visibleOutcomes.length,
    consequences: record.consequences.filter((consequence) => consequence.round < cursor.round),
  };

  if (latestOutcome) {
    return {
      ...slicedRecord,
      latestOutcome,
    };
  }

  const withoutFutureOutcome = { ...slicedRecord };
  delete withoutFutureOutcome.latestOutcome;
  return withoutFutureOutcome;
}

function phaseForHuddleWindow(window: string): PhaseKey {
  return window === "pre_council" ? "PRE_COUNCIL_HUDDLE" : "PRE_VOTE_HUDDLE";
}

function isAllianceFactAtOrBeforeCursor({
  round,
  phase,
  cursor,
}: {
  round: number;
  phase?: PhaseKey | null;
  cursor: { round: number; phase: PhaseKey };
}): boolean {
  if (round < cursor.round) return true;
  if (round > cursor.round) return false;
  if (!phase) return true;
  const factIndex = ALLIANCE_REPLAY_PHASE_ORDER.indexOf(phase);
  const cursorIndex = ALLIANCE_REPLAY_PHASE_ORDER.indexOf(cursor.phase);
  if (factIndex === -1 || cursorIndex === -1) return true;
  return factIndex <= cursorIndex;
}

function buildAllianceCards(
  facts: PublicGameAlliancesResponse,
  includeEntry: (entry: AllianceEntry) => boolean,
  playerById = new Map<string, GamePlayer>(),
): MatchWatchAllianceCardModel[] {
  const proposalsByAlliance = new Map<string, PublicAllianceProposalRead[]>();
  for (const proposal of facts.allianceFacts.proposals) {
    const proposals = proposalsByAlliance.get(proposal.allianceId) ?? [];
    proposals.push(proposal);
    proposalsByAlliance.set(proposal.allianceId, proposals);
  }

  const entries: AllianceEntry[] = [
    ...facts.allianceFacts.alliances.map((record): AllianceEntry => ({
      kind: "record",
      record,
      proposal: latestProposal(proposalsByAlliance.get(record.id)),
    })),
    ...facts.allianceFacts.proposals
      .filter((proposal) => !facts.allianceFacts.alliances.some((record) => record.id === proposal.allianceId))
      .map((proposal): AllianceEntry => ({ kind: "proposal", proposal })),
  ];

  return entries
    .filter(includeEntry)
    .map((entry) => cardFromEntry(
      entry,
      proposalsByAlliance.get(entry.kind === "record" ? entry.record.id : entry.proposal.allianceId) ?? [],
      facts.allianceFacts.huddles,
      playerById,
    ))
    .sort(compareAllianceCards);
}

function cardFromEntry(
  entry: AllianceEntry,
  proposals: PublicAllianceProposalRead[],
  huddles: PublicAllianceHuddleRead[],
  playerById: ReadonlyMap<string, GamePlayer>,
): MatchWatchAllianceCardModel {
  const record = entry.kind === "record" ? entry.record : null;
  const proposal = entry.kind === "proposal" ? entry.proposal : entry.proposal ?? latestProposal(proposals);
  const allianceId = record?.id ?? proposal?.allianceId ?? "unknown-alliance";
  const allianceHuddles = huddles
    .filter((huddle) => huddle.allianceId === allianceId)
    .map(toHuddleModel)
    .sort((left, right) => right.round - left.round || right.pass - left.pass || left.allianceName.localeCompare(right.allianceName));
  const latestOutcome = record?.latestOutcome ?? allianceHuddles.find((huddle) => huddle.outcomeSummary)?.outcomeSummary;

  return {
    id: allianceId,
    name: record?.name ?? proposal?.name ?? "Unnamed alliance",
    status: record?.status ?? proposal?.status ?? "unknown",
    members: buildAllianceMembers(record, proposal, playerById),
    memberNames: record?.memberNames ?? proposal?.memberNames ?? [],
    purpose: record?.purpose ?? proposal?.currentTerms.purpose ?? null,
    timebox: record?.timebox ?? proposal?.currentTerms.timebox ?? null,
    proposedRound: proposal?.proposedRound ?? null,
    createdRound: record?.createdRound ?? null,
    updatedRound: record?.updatedRound ?? proposal?.resolvedRound ?? proposal?.proposedRound ?? null,
    proposalCount: proposals.length || 1,
    latestProposalStatus: proposal?.status ?? null,
    latestOutcomeSummary: typeof latestOutcome === "string" ? latestOutcome : outcomeSummary(latestOutcome ?? undefined),
    consequences: record?.consequences ?? [],
    huddles: allianceHuddles,
  };
}

function buildAllianceMembers(
  record: PublicAllianceRecordRead | null,
  proposal: PublicAllianceProposalRead | undefined,
  playerById: ReadonlyMap<string, GamePlayer>,
): MatchWatchAllianceCardModel["members"] {
  const ids = record?.memberIds ?? proposal?.currentTerms.memberIds ?? [];
  const names = record?.memberNames ?? proposal?.currentTerms.memberNames ?? proposal?.memberNames ?? [];
  return names.map((name, index) => {
    const id = ids[index] ?? null;
    const player = id ? playerById.get(id) : undefined;
    return {
      id,
      name,
      ...(player?.persona ? { persona: player.persona } : {}),
      ...(player?.personaKey ? { personaKey: player.personaKey } : {}),
      ...(player?.avatarUrl ? { avatarUrl: player.avatarUrl } : {}),
    };
  });
}

function toHuddleModel(huddle: PublicAllianceHuddleRead): MatchWatchAllianceHuddleModel {
  return {
    id: `${huddle.allianceId}:${huddle.round}:${huddle.window}:${huddle.pass}`,
    allianceId: huddle.allianceId,
    allianceName: huddle.allianceName,
    round: huddle.round,
    window: huddle.window,
    pass: huddle.pass,
    speakerNames: huddle.speakers.map((speaker) => speaker.name),
    messageCount: huddle.messages.length,
    outcomeSummary: outcomeSummary(huddle.outcome),
    messages: huddle.messages.map((message) => ({
      fromName: message.from.name,
      text: message.text,
      timestamp: message.timestamp,
    })),
  };
}

function playerIsInAllianceEntry(entry: AllianceEntry, playerId: string): boolean {
  if (entry.kind === "record") {
    if (entry.record.memberIds.includes(playerId)) return true;
    if (entry.proposal && playerIsInProposal(entry.proposal, playerId)) return true;
    return false;
  }
  return playerIsInProposal(entry.proposal, playerId);
}

function playerIsInProposal(proposal: PublicAllianceProposalRead, playerId: string): boolean {
  return proposal.currentTerms.memberIds.includes(playerId)
    || proposal.proposer.id === playerId
    || proposal.responses.some((response) => response.player.id === playerId);
}

function summarizeCards(cards: readonly MatchWatchAllianceCardModel[]): MatchWatchAlliancePanelModel["summary"] {
  const proposalCount = cards.reduce((sum, card) => sum + card.proposalCount, 0);
  const huddleCount = cards.reduce((sum, card) => sum + card.huddles.length, 0);
  const latestHuddleRound = Math.max(0, ...cards.flatMap((card) => card.huddles.map((huddle) => huddle.round))) || null;
  return {
    proposalCount,
    allianceCount: cards.length,
    huddleCount,
    latestHuddleRound,
  };
}

function latestProposal(proposals: PublicAllianceProposalRead[] | undefined): PublicAllianceProposalRead | undefined {
  return [...(proposals ?? [])].sort((left, right) => (
    (right.resolvedRound ?? right.proposedRound) - (left.resolvedRound ?? left.proposedRound)
      || right.proposedRound - left.proposedRound
      || right.name.localeCompare(left.name)
  ))[0];
}

function outcomeSummary(outcome: PublicAllianceHuddleRead["outcome"] | PublicAllianceRecordRead["latestOutcome"] | undefined): string | null {
  if (!outcome) return null;
  const fragments = [
    outcome.ask ? labeledFragment("Ask", outcome.ask) : null,
    outcome.plan ? labeledFragment("Plan", outcome.plan) : null,
    outcome.promises.length > 0 ? labeledFragment("Promises", outcome.promises.join("; ")) : null,
    outcome.dissent.length > 0 ? labeledFragment("Dissent", outcome.dissent.join("; ")) : null,
    outcome.leakOrBetrayalClaims.length > 0 ? labeledFragment("Claims", outcome.leakOrBetrayalClaims.join("; ")) : null,
  ].filter((fragment): fragment is string => Boolean(fragment));
  return fragments.join(" ");
}

function labeledFragment(label: string, value: string): string {
  const trimmed = value.trim();
  const prefix = `${label}:`;
  return trimmed.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
    ? trimmed
    : `${prefix} ${trimmed}`;
}

function compareAllianceCards(left: MatchWatchAllianceCardModel, right: MatchWatchAllianceCardModel): number {
  const leftLatest = left.updatedRound ?? left.createdRound ?? left.proposedRound ?? 0;
  const rightLatest = right.updatedRound ?? right.createdRound ?? right.proposedRound ?? 0;
  return right.huddles.length - left.huddles.length
    || rightLatest - leftLatest
    || left.name.localeCompare(right.name);
}

function emptyPanel(
  status: MatchWatchAlliancePanelModel["status"],
  selectedPlayerName: string | null,
  reason: string,
): MatchWatchAlliancePanelModel {
  return {
    status,
    selectedPlayerName,
    reason,
    summary: {
      proposalCount: 0,
      allianceCount: 0,
      huddleCount: 0,
      latestHuddleRound: null,
    },
    cards: [],
  };
}

function emptyCompleted(
  status: CompletedAllianceArcsModel["status"],
  reason: string,
): CompletedAllianceArcsModel {
  return {
    status,
    reason,
    summary: {
      proposalCount: 0,
      allianceCount: 0,
      huddleCount: 0,
      latestHuddleRound: null,
    },
    cards: [],
  };
}
