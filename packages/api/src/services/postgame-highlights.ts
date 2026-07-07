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

export type PublicHouseHighlightVisualBrief = Omit<HouseHighlightVisualBrief, "diagnostics">;

export type PublicHouseHighlightSceneCard = Omit<HouseHighlightSceneCard, "confidence" | "receipts" | "visualBrief"> & {
  receipts: PublicHouseHighlightReceipt[];
  visualBrief: PublicHouseHighlightVisualBrief;
  visualCard: HouseHighlightVisualCard;
};

export type PublicHouseHighlightsCut = Omit<HouseHighlightsCut, "scenes"> & {
  scenes: PublicHouseHighlightSceneCard[];
};

export type PublicHouseHighlightsProjection = Omit<HouseHighlightsProjection, "diagnostics" | "scenes" | "cut"> & {
  cut: PublicHouseHighlightsCut | null;
  scenes: PublicHouseHighlightSceneCard[];
};

export type PostgameHighlightsResult =
  | {
      ok: true;
      schemaVersion: 2;
      game: PostgameGameMetadata;
      highlights: PublicHouseHighlightsProjection;
    }
  | {
      ok: false;
      status: PostgameHighlightsReadStatus;
      error: string;
    };

export type PostgameHighlightsDiagnosticsResult =
  | {
      ok: true;
      schemaVersion: 2;
      game: PostgameGameMetadata;
      highlights: HouseHighlightsProjection;
    }
  | {
      ok: false;
      status: PostgameHighlightsReadStatus;
      error: string;
    };

export async function getPostgameHighlights(
  db: DrizzleDB,
  idOrSlug: string,
): Promise<PostgameHighlightsResult> {
  const loaded = await loadHouseHighlights(db, idOrSlug);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    schemaVersion: 2,
    game: loaded.game,
    highlights: redactHouseHighlightsDiagnostics(loaded.highlights),
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
): PublicHouseHighlightsProjection {
  const { diagnostics, ...publicProjection } = projection;
  void diagnostics;
  return {
    ...publicProjection,
    cut: publicProjection.cut
      ? {
          ...publicProjection.cut,
          scenes: publicProjection.cut.scenes.map(redactSceneForPublic),
        }
      : null,
    scenes: publicProjection.scenes.map(redactSceneForPublic),
  };
}

function redactSceneForPublic(scene: HouseHighlightSceneCard): PublicHouseHighlightSceneCard {
  const { confidence, receipts, visualBrief, ...publicScene } = scene;
  void confidence;
  return {
    ...publicScene,
    visualBrief: redactVisualBriefForPublic(visualBrief),
    visualCard: visualCardForPublicScene(scene),
    receipts: receipts.map(redactReceiptForPublic),
  };
}

function redactVisualBriefForPublic(brief: HouseHighlightVisualBrief): PublicHouseHighlightVisualBrief {
  const { diagnostics, ...publicBrief } = brief;
  void diagnostics;
  return publicBrief;
}

function redactReceiptForPublic(receipt: HouseHighlightReceipt): PublicHouseHighlightReceipt {
  const { eventRefs, ...publicReceipt } = receipt;
  void eventRefs;
  return publicReceipt;
}

function visualCardForPublicScene(scene: HouseHighlightSceneCard): HouseHighlightVisualCard {
  const brief = scene.visualBrief;
  const roundLabel = roundLabelForSlot(slotByKey(brief.factualSlots, "round"));
  const outcome = outcomeForScene(scene, roundLabel);
  const factLines = factLinesForScene(scene);
  const altText = cleanCardFactText(
    joinSentences([scene.title, ...factLines.slice(0, 2).map((line) => line.text)]),
  );

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

function outcomeForScene(
  scene: HouseHighlightSceneCard,
  roundLabel: string | null,
): string {
  const payoff = cleanCardFactText(stripRedundantRoundText(scene.payoff, roundLabel));
  if (payoff) return payoff;

  const voteOutcome = slotByKey(scene.visualBrief.factualSlots, "vote_outcome")?.value;
  if (voteOutcome) {
    return cleanCardFactText(stripRedundantRoundText(voteOutcome, roundLabel));
  }

  return cleanCardFactText(scene.title);
}

const voteActionVisualTypes = new Set<HouseHighlightVisualBrief["visualType"]>([
  "betrayal_vote",
  "vote_flip",
  "revenge_vote",
  "council_slate",
]);

function factLinesForScene(scene: HouseHighlightSceneCard): HouseHighlightVisualCardFact[] {
  const slots = new Map(scene.visualBrief.factualSlots.map((slot) => [slot.key, slot]));
  const eliminated = slots.get("eliminated_agent")?.agents ?? [];
  const protectedAgents = slots.get("protected_agent")?.agents ?? [];
  const survivors = slots.get("surviving_agent")?.agents ?? [];
  const voters = slots.get("voters")?.agents ?? [];
  const allianceMembers = slots.get("alliance_members")?.agents ?? [];
  const finalists = slots.get("finalists")?.agents ?? [];
  const jurors = slots.get("jurors")?.agents ?? [];
  const voteOutcome = slots.get("vote_outcome");
  const facts: HouseHighlightVisualCardFact[] = [];
  const hasVoteAction = voters.length > 0 && eliminated.length > 0;

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

  const allianceAgents = allianceMembers;
  const allianceLabel = allianceName(scene.receipts);
  if (allianceAgents.length > 1 && allianceLabel) {
    facts.push(cardFact({
      id: `${scene.id}:alliance`,
      kind: "alliance_membership",
      text: `${agentNames(allianceAgents)} were in ${allianceLabel}.`,
      agents: allianceAgents,
      slots: [slots.get("alliance_members")],
      receiptIds: scene.receipts
        .filter((receipt) => receipt.tier === "alliance_receipt")
        .map((receipt) => receipt.id),
    }));
  }

  if (finalists.length > 0) {
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
    text: cleanCardFactText(params.text),
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
    .map((part) => cleanCardFactText(part).replace(/[.!?]+$/u, ""))
    .filter(Boolean)
    .map((part) => `${part}.`)
    .join(" ");
}

function stripRedundantRoundText(text: string, roundLabel: string | null): string {
  const cleaned = cleanCardFactText(text).replace(/[.!?]+$/u, "");
  if (!roundLabel) return `${cleaned}.`;

  const escapedRoundLabel = escapeRegExp(roundLabel);
  return `${cleaned
    .replace(new RegExp(`\\s+in\\s+${escapedRoundLabel}\\b`, "iu"), "")
    .replace(new RegExp(`\\s+during\\s+${escapedRoundLabel}\\b`, "iu"), "")
    .replace(new RegExp(`\\s+${escapedRoundLabel}\\b`, "iu"), "")
    .trim()}.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function cleanCardFactText(text: string): string {
  return text
    .replace(/\bproof links?\b/gi, "supporting context")
    .replace(/\bvote records?\b/gi, "vote facts")
    .replace(/\balliance receipts?\b/gi, "alliance facts")
    .replace(/\breceipt badges?\b/gi, "fact markers")
    .replace(/\breceipt trail\b/gi, "public record")
    .replace(/\breceipts?\b/gi, "records")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadHouseHighlights(
  db: DrizzleDB,
  idOrSlug: string,
): Promise<PostgameHighlightsDiagnosticsResult> {
  const analysis = await getPostgameAnalysis(db, idOrSlug, {
    includeEvidence: true,
  });
  if (!analysis.ok) return analysis;

  return {
    ok: true,
    schemaVersion: 2,
    game: analysis.game,
    highlights: enrichProjectionPlayerAvatars(
      buildHouseHighlightsProjection({
        analysis: analysis.analysis,
      }),
      await loadPlayerAvatarIndex(db, analysis.game.id),
    ),
  };
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
