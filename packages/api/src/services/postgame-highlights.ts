import {
  buildHouseHighlightsProjection,
  type HouseHighlightReceipt,
  type HouseHighlightSceneCard,
  type HouseHighlightVisualBrief,
  type HouseHighlightsCut,
  type HouseHighlightsProjection,
} from "@influence/engine";
import type { DrizzleDB } from "../db/index.js";
import {
  getPostgameAnalysis,
  type PostgameGameMetadata,
  type PostgameReadStatus,
} from "./postgame-analysis.js";

export type PostgameHighlightsReadStatus = Exclude<
  PostgameReadStatus,
  "player_not_found" | "agent_not_found"
>;

export type PublicHouseHighlightReceipt = Omit<HouseHighlightReceipt, "eventRefs">;

export type PublicHouseHighlightVisualBrief = Omit<HouseHighlightVisualBrief, "diagnostics">;

export type PublicHouseHighlightSceneCard = Omit<HouseHighlightSceneCard, "confidence" | "receipts" | "visualBrief"> & {
  receipts: PublicHouseHighlightReceipt[];
  visualBrief: PublicHouseHighlightVisualBrief;
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
    highlights: buildHouseHighlightsProjection({
      analysis: analysis.analysis,
    }),
  };
}
