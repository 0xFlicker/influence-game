import type {
  HouseHighlightCategory,
  HouseHighlightDeepLink,
  HouseHighlightReceiptTier,
  HouseHighlightSceneCard,
  HouseHighlightsResponse,
  HouseHighlightsState,
} from "@/lib/api";
import { completedGameModeHref } from "@/lib/game-links";

export interface HouseHighlightsProofLink {
  label: string;
  href: string;
  surface: "results" | "replay";
}

export interface HouseHighlightsSceneModel {
  id: string;
  title: string;
  categoryLabel: string;
  categoryTone: string;
  agentsLabel: string;
  hook: string;
  setup: string;
  conflict: string;
  payoff: string;
  receiptSummary: string;
  receipts: Array<{
    id: string;
    label: string;
    tierLabel: string;
    description: string;
  }>;
  proofLink: HouseHighlightsProofLink;
  posterDirection: string;
}

export interface HouseHighlightsViewModel {
  state: HouseHighlightsState;
  badge: string;
  title: string;
  subtitle: string;
  shareCaption: string;
  scenes: HouseHighlightsSceneModel[];
  fallbackLinks: HouseHighlightsProofLink[];
  showNoCutState: boolean;
  noCutTitle: string | null;
  noCutMessage: string | null;
}

export function buildHouseHighlightsViewModel(
  response: HouseHighlightsResponse,
  gameSlug: string,
): HouseHighlightsViewModel {
  const highlights = response.highlights;
  const scenes = highlights.scenes.map((scene) => sceneModel(scene, gameSlug));
  const fallbackLinks = highlights.fallbackLinks.map((link) => proofLink(link, gameSlug));
  const stateCopy = copyForState(highlights.state, highlights.noCutReason, highlights.eligibility.reason);
  const title = highlights.thesis ?? stateCopy.title;
  const shareCaption = highlights.cut?.shareCaption ?? title;

  return {
    state: highlights.state,
    badge: stateCopy.badge,
    title,
    subtitle: stateCopy.subtitle,
    shareCaption,
    scenes,
    fallbackLinks,
    showNoCutState: scenes.length === 0,
    noCutTitle: scenes.length === 0 ? stateCopy.title : null,
    noCutMessage: scenes.length === 0 ? stateCopy.noCutMessage : null,
  };
}

export function proofLink(
  link: HouseHighlightDeepLink,
  gameSlug: string,
): HouseHighlightsProofLink {
  return {
    label: link.label,
    href: completedGameModeHref(gameSlug, link.surface, link.anchor || undefined),
    surface: link.surface,
  };
}

function sceneModel(scene: HouseHighlightSceneCard, gameSlug: string): HouseHighlightsSceneModel {
  return {
    id: scene.id,
    title: scene.title,
    categoryLabel: categoryLabel(scene.category),
    categoryTone: categoryTone(scene.category),
    agentsLabel: scene.involvedAgents.map((agent) => agent.name).join(", "),
    hook: scene.houseHook,
    setup: scene.setup,
    conflict: scene.conflict,
    payoff: scene.payoff,
    receiptSummary: receiptSummary(scene),
    receipts: scene.receipts.map((receipt) => ({
      id: receipt.id,
      label: receipt.label,
      tierLabel: receiptTierLabel(receipt.tier),
      description: receipt.description,
    })),
    proofLink: proofLink(scene.deepLink, gameSlug),
    posterDirection: scene.posterDirection,
  };
}

function copyForState(
  state: HouseHighlightsState,
  noCutReason: string | null,
  eligibilityReason: string | null,
) {
  switch (state) {
    case "main_cut":
      return {
        badge: "House Cut",
        title: "This was the game where the receipts found the story.",
        subtitle: "One thesis, selected scenes, and links back to the proof.",
        noCutMessage: null,
      };
    case "mini_highlight_pack":
      return {
        badge: "Highlight Pack",
        title: "The House found sharp scenes, not one clean thesis.",
        subtitle: "Standalone moments survived the evidence gate.",
        noCutMessage: null,
      };
    case "no_cut":
      return {
        badge: "No Cut",
        title: "The House declined the cut.",
        subtitle: "The game completed, but the story did not clear the V1 highlight gate.",
        noCutMessage: noCutReason === "insufficient_scene_evidence"
          ? "Alliance receipts exist, but fewer than two cold-viewer-legible scenes survived selection."
          : "The available receipts were not strong enough for a public highlight.",
      };
    case "unsupported_ineligible":
      return {
        badge: "Ineligible",
        title: "No V1 Highlights cut.",
        subtitle: "This completed game does not have the alliance receipts required by House Highlights V1.",
        noCutMessage: eligibilityReason === "missing_alliance_receipts"
          ? "The House will not invent alliance drama from ordinary vote facts."
          : "The game is outside the supported Highlights path.",
      };
  }
}

function categoryLabel(category: HouseHighlightCategory): string {
  return category
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function categoryTone(category: HouseHighlightCategory): string {
  switch (category) {
    case "betrayal":
    case "humiliation":
    case "collapse":
      return "border-red-300/25 bg-red-500/10 text-red-100";
    case "jury_judgment":
      return "border-cyan-300/25 bg-cyan-500/10 text-cyan-100";
    case "loyalty":
    case "triumph":
      return "border-emerald-300/25 bg-emerald-500/10 text-emerald-100";
    case "suspense":
    case "unlikely_survival":
      return "border-amber-300/25 bg-amber-500/10 text-amber-100";
    default:
      return "border-violet-300/25 bg-violet-500/10 text-violet-100";
  }
}

function receiptTierLabel(tier: HouseHighlightReceiptTier): string {
  switch (tier) {
    case "vote_record":
      return "Vote record";
    case "alliance_receipt":
      return "Alliance receipt";
    case "derived_signal":
      return "Derived signal";
    case "public_quote":
      return "Public quote";
    case "presentation_direction":
      return "Presentation";
  }
}

function receiptSummary(scene: HouseHighlightSceneCard): string {
  const tiers = new Set(scene.receipts.map((receipt) => receiptTierLabel(receipt.tier)));
  return [...tiers].join(" + ");
}
