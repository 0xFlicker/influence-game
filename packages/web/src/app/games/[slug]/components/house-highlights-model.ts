import type {
  HouseHighlightCategory,
  HouseHighlightDeepLink,
  HouseHighlightSceneCard,
  HouseHighlightsResponse,
  HouseHighlightsState,
} from "@/lib/api";
import {
  completedGameModeHref,
  gameHighlightSceneHref,
  houseHighlightSceneAnchor,
} from "@/lib/game-links";
import { houseHighlightGeneratedBackgroundAsset } from "./house-highlights-backgrounds";

export interface HouseHighlightsProofLink {
  label: string;
  href: string;
  surface: "results" | "replay";
}

export interface HouseHighlightsShareLink {
  label: string;
  href: string;
}

export interface HouseHighlightsSceneModel {
  id: string;
  title: string;
  categoryLabel: string;
  categoryTone: string;
  hook: string;
  setup: string;
  conflict: string;
  payoff: string;
  visualCard: {
    template: string;
    title: string;
    eyebrow: string;
    altText: string;
    primaryAgents: Array<{ id: string; name: string; initials: string; avatarUrl: string | null }>;
    secondaryAgents: Array<{ id: string; name: string; initials: string; avatarUrl: string | null }>;
    roundLabel: string | null;
    outcome: string;
    factLines: Array<{
      id: string;
      text: string;
    }>;
    backgroundImage: string | null;
    backdropCategory: string;
    visualType: string;
  };
  proofLink: HouseHighlightsProofLink;
  shareLink: HouseHighlightsShareLink;
  anchorId: string;
  isSelected: boolean;
}

export interface HouseHighlightsViewModel {
  state: HouseHighlightsState;
  badge: string;
  title: string;
  subtitle?: string;
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
  selectedSceneId?: string | null,
): HouseHighlightsViewModel {
  const highlights = response.highlights;
  const scenes = highlights.scenes.map((scene) => sceneModel(scene, gameSlug, selectedSceneId ?? null));
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

function sceneModel(
  scene: HouseHighlightSceneCard,
  gameSlug: string,
  selectedSceneId: string | null,
): HouseHighlightsSceneModel {
  return {
    id: scene.id,
    title: scene.title,
    categoryLabel: categoryLabel(scene.category),
    categoryTone: categoryTone(scene.category),
    hook: normalizeSceneText(scene.houseHook),
    setup: normalizeSceneText(scene.setup),
    conflict: normalizeSceneText(scene.conflict),
    payoff: normalizeSceneText(scene.payoff),
    visualCard: {
      template: scene.visualCard.template,
      title: scene.visualCard.title,
      eyebrow: scene.visualCard.eyebrow,
      altText: scene.visualCard.altText,
      primaryAgents: scene.visualCard.primaryAgents.map(cardAgent),
      secondaryAgents: scene.visualCard.secondaryAgents.map(cardAgent),
      roundLabel: scene.visualCard.roundLabel,
      outcome: scene.visualCard.outcome,
      factLines: scene.visualCard.factLines.map((fact) => ({
        id: fact.id,
        text: fact.text,
      })),
      backgroundImage: houseHighlightGeneratedBackgroundAsset(scene.visualBrief.visualType),
      backdropCategory: scene.visualCard.backdrop.category,
      visualType: scene.visualBrief.visualType,
    },
    proofLink: proofLink(scene.deepLink, gameSlug),
    shareLink: {
      label: "Share scene",
      href: gameHighlightSceneHref(gameSlug, scene.id),
    },
    anchorId: houseHighlightSceneAnchor(scene.id),
    isSelected: selectedSceneId === scene.id,
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
        title: "This was the game where the facts found the story.",
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
          ? "Named-alliance facts exist, but no scenes were selected by the House."
          : "The available facts were not strong enough for a public highlight.",
      };
    case "unsupported_ineligible":
      return {
        badge: "Ineligible",
        title: "No V1 Highlights cut.",
        subtitle: "This completed game does not have the named-alliance facts required by House Highlights V1.",
        noCutMessage: eligibilityReason === "missing_alliance_receipts"
          ? "The House will not invent alliance drama from ordinary vote facts."
          : "The game is outside the supported Highlights path.",
      };
  }
}

function categoryLabel(category: HouseHighlightCategory): string {
  return formatLabel(category);
}

function formatLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function normalizeSceneText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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

function cardAgent(agent: { id: string; name: string; avatarUrl?: string | null }) {
  return {
    ...agent,
    avatarUrl: agent.avatarUrl ?? fallbackPersonaAvatarUrl(agent.name),
    initials: agent.name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?",
  };
}

function fallbackPersonaAvatarUrl(name: string): string {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const key = PERSONA_AVATAR_KEYS[hash % PERSONA_AVATAR_KEYS.length] ?? "strategic";
  return `/avatars/personas/${key}.png`;
}
