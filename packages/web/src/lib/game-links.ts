export type CompletedGameMode = "replay" | "results";

export function gamePathSegment(gameIdOrSlug: string): string {
  return encodeURIComponent(gameIdOrSlug);
}

export function gameHref(gameIdOrSlug: string): string {
  return `/games/${gamePathSegment(gameIdOrSlug)}`;
}

export function gameHighlightsHref(gameIdOrSlug: string): string {
  return `${gameHref(gameIdOrSlug)}/highlights`;
}

export function houseHighlightSceneAnchor(sceneId: string): string {
  return `scene-${sceneId}`;
}

export function gameHighlightSceneHref(gameIdOrSlug: string, sceneId: string): string {
  const anchor = encodeURIComponent(houseHighlightSceneAnchor(sceneId));
  return `${gameHighlightsHref(gameIdOrSlug)}?scene=${encodeURIComponent(sceneId)}#${anchor}`;
}

export function gameHighlightCardImageHref(gameIdOrSlug: string, sceneId: string): string {
  return `${gameHighlightsHref(gameIdOrSlug)}/card-image/${encodeURIComponent(sceneId)}`;
}

export function gameResultsHref(gameIdOrSlug: string, anchor?: string): string {
  return `${gameHref(gameIdOrSlug)}/results${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
}

export function gameReplayHref(gameIdOrSlug: string, anchor?: string): string {
  return `${gameHref(gameIdOrSlug)}/replay${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
}

export function completedGameModeHref(
  gameIdOrSlug: string,
  mode: CompletedGameMode,
  anchor?: string,
): string {
  return mode === "results"
    ? gameResultsHref(gameIdOrSlug, anchor)
    : gameReplayHref(gameIdOrSlug, anchor);
}
