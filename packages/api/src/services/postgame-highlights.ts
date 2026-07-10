import {
  buildHouseHighlightsProjection,
  type HouseHighlightReceipt,
  type HouseHighlightSceneCard,
  type HouseHighlightVisualBrief,
  type HouseHighlightVisualCard,
  type HouseHighlightVisualCardFact,
  type HouseHighlightVisualSlot,
  type HouseHighlightVisualSlotKey,
  type HouseHighlightsCut,
  type HouseHighlightsProjection,
  type PostgameAnalysisProjection,
  type PlayerRef,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import {
  getPostgameAnalysis,
  type PostgameGameMetadata,
  type PostgameReadStatus,
} from "./postgame-analysis.js";
import { eq } from "drizzle-orm";
import { schema } from "../db/index.js";

export type PostgameHighlightsReadStatus = Exclude<
  PostgameReadStatus,
  "player_not_found" | "agent_not_found"
>;

export type PublicHouseHighlightReceipt = Omit<HouseHighlightReceipt, "eventRefs">;

export type PublicHouseHighlightVisualBrief = Pick<
  HouseHighlightVisualBrief,
  "visualType" | "templateLabel" | "primaryAgents" | "secondaryAgents" | "backdrop" | "shareFraming"
>;

export type PublicHouseHighlightSceneCard = Pick<
  HouseHighlightSceneCard,
  | "id"
  | "title"
  | "category"
  | "involvedAgents"
  | "houseHook"
  | "setup"
  | "conflict"
  | "payoff"
  | "confidence"
  | "deepLink"
> & {
  receipts: PublicHouseHighlightReceipt[];
  visualBrief: PublicHouseHighlightVisualBrief;
  visualCard: HouseHighlightVisualCard;
};

export type PublicHouseHighlightsCut = Omit<HouseHighlightsCut, "scenes"> & {
  scenes: PublicHouseHighlightSceneCard[];
};

export type PublicHouseHighlightsProjection = Omit<HouseHighlightsProjection, "diagnostics" | "schemaVersion" | "scenes" | "cut"> & {
  schemaVersion: 3;
  cut: PublicHouseHighlightsCut | null;
  scenes: PublicHouseHighlightSceneCard[];
};

type PostgameHighlightsFailure = {
  ok: false;
  status: PostgameHighlightsReadStatus;
  error: string;
};

export type PostgameHighlightsResult =
  | {
    ok: true;
    schemaVersion: 3;
    game: PostgameGameMetadata;
    highlights: PublicHouseHighlightsProjection;
  }
  | PostgameHighlightsFailure;

export type PostgameHighlightsDiagnosticsResult =
  | {
      ok: true;
      schemaVersion: 2;
      game: PostgameGameMetadata;
      highlights: HouseHighlightsProjection;
    }
  | PostgameHighlightsFailure;

type LoadedHouseHighlightsResult =
  | {
      ok: true;
      schemaVersion: 2;
      game: PostgameGameMetadata;
      highlights: HouseHighlightsProjection;
      highlightsContext: VisualFactAnalysis;
    }
  | PostgameHighlightsFailure;

export async function getPostgameHighlights(
  db: DrizzleDB,
  idOrSlug: string,
): Promise<PostgameHighlightsResult> {
  const loaded = await loadHouseHighlights(db, idOrSlug);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    schemaVersion: 3,
    game: loaded.game,
    highlights: redactHouseHighlightsDiagnostics(loaded.highlights, loaded.highlightsContext),
  };
}

export async function getPostgameHighlightsDiagnostics(
  db: DrizzleDB,
  idOrSlug: string,
): Promise<PostgameHighlightsDiagnosticsResult> {
  const loaded = await loadHouseHighlights(db, idOrSlug);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    schemaVersion: 2,
    game: loaded.game,
    highlights: loaded.highlights,
  };
}

export function redactHouseHighlightsDiagnostics(
  projection: HouseHighlightsProjection,
  analysis?: VisualFactAnalysis,
): PublicHouseHighlightsProjection {
  const { diagnostics, ...publicProjection } = projection;
  void diagnostics;
  const context = analysis ? visualFactContextFor(analysis) : null;
  return {
    ...publicProjection,
    schemaVersion: 3,
    cut: publicProjection.cut
      ? {
          ...publicProjection.cut,
          scenes: publicProjection.cut.scenes.map((scene) => redactSceneForPublic(scene, context)),
        }
      : null,
    scenes: publicProjection.scenes.map((scene) => redactSceneForPublic(scene, context)),
  };
}

function redactSceneForPublic(
  scene: HouseHighlightSceneCard,
  context: VisualFactContext | null,
): PublicHouseHighlightSceneCard {
  return {
    id: scene.id,
    title: scene.title,
    category: scene.category,
    involvedAgents: scene.involvedAgents,
    houseHook: scene.houseHook,
    setup: scene.setup,
    conflict: scene.conflict,
    payoff: scene.payoff,
    confidence: scene.confidence,
    deepLink: scene.deepLink,
    visualBrief: redactVisualBriefForPublic(scene.visualBrief),
    visualCard: visualCardForPublicScene(scene, context),
    receipts: scene.receipts.map(redactReceiptForPublic),
  };
}

function redactVisualBriefForPublic(brief: HouseHighlightVisualBrief): PublicHouseHighlightVisualBrief {
  return {
    visualType: brief.visualType,
    templateLabel: brief.templateLabel,
    primaryAgents: brief.primaryAgents,
    secondaryAgents: brief.secondaryAgents,
    backdrop: brief.backdrop,
    shareFraming: brief.shareFraming,
  };
}

function redactReceiptForPublic(receipt: HouseHighlightReceipt): PublicHouseHighlightReceipt {
  const { eventRefs, ...publicReceipt } = receipt;
  void eventRefs;
  return publicReceipt;
}

function visualCardForPublicScene(
  scene: HouseHighlightSceneCard,
  context: VisualFactContext | null,
): HouseHighlightVisualCard {
  const brief = scene.visualBrief;
  const roundLabel = roundLabelForSlot(slotByKey(brief.factualSlots, "round"));
  const outcome = outcomeForScene(scene);
  const factLines = factLinesForScene(scene, context);
  const altText = joinSentences([scene.title, ...factLines.slice(0, 2).map((line) => line.text)]);

  return {
    template: voteActionVisualTypes.has(brief.visualType) ? "hero_vote_action" : "generic_scene",
    title: scene.title,
    eyebrow: brief.templateLabel,
    altText,
    primaryAgents: brief.primaryAgents.length > 0 ? brief.primaryAgents : scene.involvedAgents.slice(0, 1),
    secondaryAgents: brief.secondaryAgents,
    roundLabel,
    outcome,
    factLines,
    backdrop: brief.backdrop,
    shareFraming: brief.shareFraming,
  };
}

function outcomeForScene(scene: HouseHighlightSceneCard): string {
  const payoff = sentenceFrom(scene.payoff);
  if (payoff) return payoff;

  const voteOutcome = slotByKey(scene.visualBrief.factualSlots, "vote_outcome")?.value;
  const structuredOutcome = sentenceFrom(voteOutcome);
  if (structuredOutcome) return structuredOutcome;

  return normalizeCardFactText(scene.title);
}

const voteActionVisualTypes = new Set<HouseHighlightVisualBrief["visualType"]>([
  "betrayal_vote",
  "vote_flip",
  "revenge_vote",
  "council_slate",
]);

function factLinesForScene(
  scene: HouseHighlightSceneCard,
  context: VisualFactContext | null,
): HouseHighlightVisualCardFact[] {
  const slots = new Map(scene.visualBrief.factualSlots.map((slot) => [slot.key, slot]));
  const eliminated = slots.get("eliminated_agent")?.agents ?? [];
  const exposedAgents = slots.get("exposed_agent")?.agents ?? [];
  const protectedAgents = slots.get("protected_agent")?.agents ?? [];
  const survivors = slots.get("surviving_agent")?.agents ?? [];
  const voters = slots.get("voters")?.agents ?? [];
  const allianceMembers = slots.get("alliance_members")?.agents ?? [];
  const finalists = slots.get("finalists")?.agents ?? [];
  const jurors = slots.get("jurors")?.agents ?? [];
  const voteOutcome = slots.get("vote_outcome");
  const facts: HouseHighlightVisualCardFact[] = [];
  const hasVoteAction = voters.length > 0 && eliminated.length > 0;

  if (scene.visualBrief.visualType === "power_streak") {
    const primaryAgent = slots.get("primary_agent")?.agents?.[0] ?? scene.visualBrief.primaryAgents[0];
    const comparison = primaryAgent && context ? context.powerComparisons.get(primaryAgent.id) : null;
    if (primaryAgent && comparison) {
      facts.push(cardFact({
        id: `${scene.id}:power-comparison`,
        kind: "outcome",
        text: comparison.runnerUp
          ? `${primaryAgent.name} held power ${comparison.count} times; ${comparison.runnerUp.name} was next with ${comparison.runnerUp.count}.`
          : `${primaryAgent.name} held power ${comparison.count} times.`,
        agents: comparison.runnerUp ? [primaryAgent, comparison.runnerUp] : [primaryAgent],
        slots: [slots.get("primary_agent")],
      }));
    }
  }

  if (scene.visualBrief.visualType === "vote_flip" && exposedAgents.length > 0 && eliminated.length > 0) {
    facts.push(cardFact({
      id: `${scene.id}:exposure-flip`,
      kind: "round_context",
      text: `${agentNames(exposedAgents)} led exposure pressure before ${agentNames(eliminated)} left.`,
      agents: [...exposedAgents, ...eliminated],
      slots: [slots.get("exposed_agent"), slots.get("eliminated_agent")],
    }));
  }

  if (eliminated.length > 0 && context) {
    const roundNumber = roundNumberForSlot(slots.get("round"));
    const votersAgainstEliminated = roundNumber
      ? context.votersByRoundAndTarget.get(roundTargetKey(roundNumber, eliminated[0]!.id)) ?? []
      : [];
    if (votersAgainstEliminated.length > 0 && !hasVoteAction) {
      facts.push(cardFact({
        id: `${scene.id}:voters-against-eliminated`,
        kind: "vote_action",
        text: `${agentNames(votersAgainstEliminated)} voted against ${agentNames(eliminated)}.`,
        agents: [...votersAgainstEliminated, ...eliminated],
        slots: [slots.get("eliminated_agent")],
      }));
    }
  }

  if (scene.visualBrief.visualType === "endgame_collapse" && context?.finalists.length) {
    facts.push(cardFact({
      id: `${scene.id}:final-field`,
      kind: "jury_outcome",
      text: `${agentNames(context.finalists)} reached the final vote.`,
      agents: context.finalists,
      slots: [slots.get("round")],
    }));
  }

  if (hasVoteAction) {
    facts.push(cardFact({
      id: `${scene.id}:vote-action`,
      kind: "vote_action",
      text: `${agentNames(voters)} voted against ${agentNames(eliminated)}.`,
      agents: [...voters, ...eliminated],
      slots: [slots.get("voters"), slots.get("eliminated_agent")],
    }));
  }

  if (!hasVoteAction && !voteOutcome?.value && eliminated.length > 0) {
    facts.push(cardFact({
      id: `${scene.id}:elimination`,
      kind: "elimination",
      text: `${agentNames(eliminated)} was eliminated.`,
      agents: eliminated,
      slots: [slots.get("eliminated_agent")],
    }));
  }

  if (protectedAgents.length > 0) {
    facts.push(cardFact({
      id: `${scene.id}:protection`,
      kind: "protection",
      text: `${agentNames(protectedAgents)} was protected.`,
      agents: protectedAgents,
      slots: [slots.get("protected_agent")],
    }));
  }

  if (survivors.length > 0) {
    facts.push(cardFact({
      id: `${scene.id}:survival`,
      kind: "survival",
      text: `${agentNames(survivors)} survived.`,
      agents: survivors,
      slots: [slots.get("surviving_agent")],
    }));
  }

  const allianceLabel = allianceName(scene.receipts);
  if (allianceMembers.length > 1 && allianceLabel) {
    facts.push(cardFact({
      id: `${scene.id}:alliance`,
      kind: "alliance_membership",
      text: `${agentNames(allianceMembers)} were in ${allianceLabel}.`,
      agents: allianceMembers,
      slots: [slots.get("alliance_members")],
      receiptIds: scene.receipts
        .filter((receipt) => receipt.tier === "alliance_receipt")
        .map((receipt) => receipt.id),
    }));
  }

  if (scene.visualBrief.visualType !== "endgame_collapse" && finalists.length > 0) {
    facts.push(cardFact({
      id: `${scene.id}:finalists`,
      kind: "jury_outcome",
      text: `${agentNames(finalists)} reached the final vote.`,
      agents: finalists,
      slots: [slots.get("finalists")],
    }));
  }

  if (jurors.length > 0) {
    facts.push(cardFact({
      id: `${scene.id}:jurors`,
      kind: "jury_outcome",
      text: `${agentNames(jurors)} judged the final.`,
      agents: jurors,
      slots: [slots.get("jurors")],
    }));
  }

  return dedupeFacts(facts).slice(0, 5);
}

function cardFact(params: {
  id: string;
  kind: HouseHighlightVisualCardFact["kind"];
  text: string;
  agents: readonly PlayerRef[];
  slots?: Array<HouseHighlightVisualSlot | undefined>;
  receiptIds?: readonly string[];
}): HouseHighlightVisualCardFact {
  return {
    id: params.id,
    kind: params.kind,
    text: normalizeCardFactText(params.text),
    agentIds: uniqueStrings(params.agents.map((agent) => agent.id)),
    receiptIds: uniqueStrings([
      ...(params.receiptIds ?? []),
      ...(params.slots ?? []).flatMap((slot) => slot?.receiptIds ?? []),
    ]),
  };
}

function slotByKey(
  slots: readonly HouseHighlightVisualSlot[],
  key: HouseHighlightVisualSlotKey,
): HouseHighlightVisualSlot | undefined {
  return slots.find((slot) => slot.key === key && slot.status === "filled");
}

function roundLabelForSlot(slot: HouseHighlightVisualSlot | undefined): string | null {
  const value = slot?.value?.trim();
  if (!value) return null;
  return /^round\b/i.test(value) ? value : `Round ${value}`;
}

function joinSentences(parts: readonly string[]): string {
  return parts
    .map(sentenceFrom)
    .filter(Boolean)
    .join(" ");
}

function allianceName(receipts: readonly HouseHighlightReceipt[]): string | null {
  const allianceReceipt = receipts.find((receipt) =>
    receipt.tier === "alliance_receipt" && !/^alliance[- ]member cut$/i.test(receipt.label.trim())
  );
  return allianceReceipt?.label.trim() || null;
}

function agentNames(agents: readonly PlayerRef[]): string {
  const names = uniqueStrings(agents.map((agent) => agent.name).filter(Boolean));
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function dedupeFacts(facts: readonly HouseHighlightVisualCardFact[]): HouseHighlightVisualCardFact[] {
  const seen = new Set<string>();
  const deduped: HouseHighlightVisualCardFact[] = [];
  for (const fact of facts) {
    const key = fact.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(fact);
  }
  return deduped;
}

function sentenceFrom(text: string | null | undefined): string {
  const normalized = normalizeCardFactText(text ?? "").replace(/[.!?]+$/u, "");
  return normalized ? `${normalized}.` : "";
}

function normalizeCardFactText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

async function loadHouseHighlights(
  db: DrizzleDB,
  idOrSlug: string,
): Promise<LoadedHouseHighlightsResult> {
  const analysis = await getPostgameAnalysis(db, idOrSlug, {
    includeEvidence: true,
  });
  if (!analysis.ok) return analysis;

  const avatarIndexPromise = loadPlayerAvatarIndex(db, analysis.game.id);
  const highlights = buildHouseHighlightsProjection({
    analysis: analysis.analysis,
  });

  return {
    ok: true,
    schemaVersion: 2,
    game: analysis.game,
    highlights: enrichProjectionPlayerAvatars(
      highlights,
      await avatarIndexPromise,
    ),
    highlightsContext: analysis.analysis,
  };
}

interface VisualFactContext {
  powerComparisons: Map<string, {
    count: number;
    runnerUp: (PlayerRef & { count: number }) | null;
  }>;
  votersByRoundAndTarget: Map<string, PlayerRef[]>;
  finalists: PlayerRef[];
}

type VisualFactAnalysis = {
  roundSummaries: readonly Pick<PostgameAnalysisProjection["roundSummaries"][number], "round" | "majorityCohort">[];
  summary: Pick<PostgameAnalysisProjection["summary"], "dominantEmpoweredPlayers" | "finalists">;
};

function visualFactContextFor(analysis: VisualFactAnalysis): VisualFactContext {
  const votersByRoundAndTarget = new Map<string, PlayerRef[]>();

  for (const round of analysis.roundSummaries) {
    if (round.majorityCohort.target) {
      for (const voter of round.majorityCohort.alignedPlayers) {
        pushVoter(votersByRoundAndTarget, round.round, round.majorityCohort.target.id, voter);
      }
    }
  }

  const rankedPower = [...analysis.summary.dominantEmpoweredPlayers].sort((left, right) =>
    right.votes - left.votes || left.player.name.localeCompare(right.player.name)
  );
  const powerComparisons = new Map<string, {
    count: number;
    runnerUp: (PlayerRef & { count: number }) | null;
  }>();
  for (const [index, entry] of rankedPower.entries()) {
    const nextRanked = index === 0 ? rankedPower[1] : null;
    const runnerUp = nextRanked && nextRanked.votes < entry.votes ? nextRanked : null;
    powerComparisons.set(entry.player.id, {
      count: entry.votes,
      runnerUp: runnerUp ? { ...runnerUp.player, count: runnerUp.votes } : null,
    });
  }

  return {
    powerComparisons,
    votersByRoundAndTarget,
    finalists: analysis.summary.finalists,
  };
}

function pushVoter(
  votersByRoundAndTarget: Map<string, PlayerRef[]>,
  round: number,
  targetId: string,
  voter: PlayerRef,
): void {
  const key = roundTargetKey(round, targetId);
  let voters = votersByRoundAndTarget.get(key);
  if (!voters) {
    voters = [];
    votersByRoundAndTarget.set(key, voters);
  }
  if (!voters.some((candidate) => candidate.id === voter.id)) voters.push(voter);
}

function roundTargetKey(round: number, targetId: string): string {
  return `${round}:${targetId}`;
}

function roundNumberForSlot(slot: HouseHighlightVisualSlot | undefined): number | null {
  const value = slot?.value?.trim();
  if (!value) return null;
  const match = value.match(/\d+/u);
  return match ? Number(match[0]) : null;
}

type PlayerAvatarIndex = ReadonlyMap<string, string>;

async function loadPlayerAvatarIndex(
  db: DrizzleDB,
  gameId: string,
): Promise<PlayerAvatarIndex> {
  const rows = await db
    .select({
      playerId: schema.gamePlayers.id,
      avatarUrl: schema.agentProfiles.avatarUrl,
    })
    .from(schema.gamePlayers)
    .leftJoin(schema.agentProfiles, eq(schema.gamePlayers.agentProfileId, schema.agentProfiles.id))
    .where(eq(schema.gamePlayers.gameId, gameId));

  return new Map(rows.flatMap((row) =>
    row.avatarUrl ? [[row.playerId, row.avatarUrl] as const] : []
  ));
}

function enrichProjectionPlayerAvatars(
  projection: HouseHighlightsProjection,
  avatarIndex: PlayerAvatarIndex,
): HouseHighlightsProjection {
  if (avatarIndex.size === 0) return projection;
  return {
    ...projection,
    cut: projection.cut
      ? {
          ...projection.cut,
          scenes: projection.cut.scenes.map((scene) => enrichScenePlayerAvatars(scene, avatarIndex)),
        }
      : null,
    scenes: projection.scenes.map((scene) => enrichScenePlayerAvatars(scene, avatarIndex)),
    diagnostics: {
      ...projection.diagnostics,
      selectedCandidates: projection.diagnostics.selectedCandidates.map((candidate) =>
        enrichCandidatePlayerAvatars(candidate, avatarIndex)
      ),
      rejectedCandidates: projection.diagnostics.rejectedCandidates.map((candidate) =>
        enrichCandidatePlayerAvatars(candidate, avatarIndex)
      ),
    },
  };
}

function enrichScenePlayerAvatars(
  scene: HouseHighlightSceneCard,
  avatarIndex: PlayerAvatarIndex,
): HouseHighlightSceneCard {
  return {
    ...scene,
    involvedAgents: scene.involvedAgents.map((agent) => enrichAgentAvatar(agent, avatarIndex)),
    visualBrief: {
      ...scene.visualBrief,
      primaryAgents: scene.visualBrief.primaryAgents.map((agent) => enrichAgentAvatar(agent, avatarIndex)),
      secondaryAgents: scene.visualBrief.secondaryAgents.map((agent) => enrichAgentAvatar(agent, avatarIndex)),
      factualSlots: enrichSlotAvatars(scene.visualBrief.factualSlots, avatarIndex),
    },
  };
}

function enrichCandidatePlayerAvatars<T extends {
  visualBrief: Pick<HouseHighlightVisualBrief, "factualSlots">;
}>(
  candidate: T,
  avatarIndex: PlayerAvatarIndex,
): T {
  return {
    ...candidate,
    visualBrief: {
      ...candidate.visualBrief,
      factualSlots: enrichSlotAvatars(candidate.visualBrief.factualSlots, avatarIndex),
    },
  };
}

function enrichSlotAvatars(
  slots: readonly HouseHighlightVisualSlot[],
  avatarIndex: PlayerAvatarIndex,
): HouseHighlightVisualSlot[] {
  return slots.map((slot) =>
    slot.agents
      ? { ...slot, agents: slot.agents.map((agent) => enrichAgentAvatar(agent, avatarIndex)) }
      : slot
  );
}

function enrichAgentAvatar(agent: PlayerRef, avatarIndex: PlayerAvatarIndex): PlayerRef {
  const avatarUrl = avatarIndex.get(agent.id);
  return avatarUrl ? { ...agent, avatarUrl } : agent;
}
