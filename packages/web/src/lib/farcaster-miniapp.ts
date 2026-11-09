/**
 * Pure builders for Farcaster Mini App embed metadata and domain manifest.
 * Association signatures are committed public data (optional until domain is signed).
 */

import { HOUSE_VENUE } from "./product-identity";

export const FARCASTER_MINI_APP_QUERY = "app";
export const FARCASTER_MINI_APP_QUERY_VALUE = "mini";
export const FARCASTER_SPLASH_BACKGROUND = "#050508";
export const FARCASTER_BUTTON_TITLE = "Open The House";

export interface FarcasterAccountAssociation {
  header: string;
  payload: string;
  signature: string;
}

export interface MiniAppManifestConfig {
  /** Absolute origin, e.g. https://thehouse.game */
  baseUrl: string;
  accountAssociation?: FarcasterAccountAssociation | null;
}

/**
 * Production-oriented absolute URLs for the live domain.
 * Local preview can still open any host; signed association is for thehouse.game.
 */
export const FARCASTER_PRODUCTION_ORIGIN = `https://${HOUSE_VENUE.domain}`;

/** Committed domain association — paste signed values after Farcaster developer tooling. */
export const FARCASTER_ACCOUNT_ASSOCIATION: FarcasterAccountAssociation | null =
  null;

export function withMiniAppQuery(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(FARCASTER_MINI_APP_QUERY, FARCASTER_MINI_APP_QUERY_VALUE);
  return parsed.toString();
}

export function isMiniAppModeHint(search: string | URLSearchParams): boolean {
  const params = typeof search === "string"
    ? new URLSearchParams(
      search.startsWith("?") ? search.slice(1) : search,
    )
    : search;
  return params.get(FARCASTER_MINI_APP_QUERY) === FARCASTER_MINI_APP_QUERY_VALUE;
}

export function absoluteAssetUrl(baseUrl: string, path: string): string {
  const origin = baseUrl.replace(/\/+$/, "");
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${normalized}`;
}

interface MiniAppEmbedOptions {
  path?: string;
  buttonTitle?: string;
  imagePath?: string;
}

export function buildMiniAppEmbed(baseUrl: string, options: MiniAppEmbedOptions = {}) {
  const origin = baseUrl.replace(/\/+$/, "");
  const launchUrl = new URL(options.path ?? "/", origin);
  if (launchUrl.origin !== new URL(origin).origin) throw new Error("Mini App launch must stay on its own origin.");
  const imageUrl = new URL(options.imagePath ?? "/social/house-farcaster.png", origin);
  if (imageUrl.origin !== new URL(origin).origin) throw new Error("Mini App image must stay on its own origin.");
  return {
    version: "1" as const,
    imageUrl: imageUrl.href,
    button: {
      title: options.buttonTitle ?? FARCASTER_BUTTON_TITLE,
      action: {
        type: "launch_frame" as const,
        name: HOUSE_VENUE.name,
        url: withMiniAppQuery(launchUrl.href),
        splashImageUrl: absoluteAssetUrl(origin, "/logo.png"),
        splashBackgroundColor: FARCASTER_SPLASH_BACKGROUND,
      },
    },
  };
}

export function buildMiniAppManifest(config: MiniAppManifestConfig) {
  const origin = config.baseUrl.replace(/\/+$/, "");
  const homeUrl = withMiniAppQuery(`${origin}/`);
  const miniapp = {
    version: "1" as const,
    name: HOUSE_VENUE.name,
    iconUrl: absoluteAssetUrl(origin, "/logo.png"),
    homeUrl,
    imageUrl: absoluteAssetUrl(origin, "/social/house-farcaster.png"),
    buttonTitle: FARCASTER_BUTTON_TITLE,
    splashImageUrl: absoluteAssetUrl(origin, "/logo.png"),
    splashBackgroundColor: FARCASTER_SPLASH_BACKGROUND,
    subtitle: "AI agent social strategy",
    description:
      "Watch AI characters make allies and tell lies in Influence and Werewolf.",
  };

  if (config.accountAssociation) {
    return {
      accountAssociation: config.accountAssociation,
      miniapp,
    };
  }
  return { miniapp };
}

export function serializeMiniAppEmbedMeta(baseUrl: string, options: MiniAppEmbedOptions = {}): string {
  return JSON.stringify(buildMiniAppEmbed(baseUrl, options));
}
