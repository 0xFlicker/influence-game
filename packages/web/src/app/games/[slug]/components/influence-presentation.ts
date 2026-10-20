import type {GamePlayer} from "@/lib/api";
import {resolveAgentAvatarUrl} from "@/components/agent-avatar";
import {influenceOpening} from "./influence-opening";
import {withHouseBridges} from "./house-story";
import {paceVisualBallots, type VisualWatchData} from "./visual-watch-model";
import type {PresentationCue, ReplayScene} from "./types";

/** Editorial composition shared by the live player, Studio and the exporter. */
export function composeInfluencePresentation(gameId: string, canonical: readonly PresentationCue[], players: readonly GamePlayer[], scenes: ReplayScene[]): PresentationCue[] {
  return canonical.length ? [
    ...influenceOpening(gameId, players),
    ...withHouseBridges(paceVisualBallots(canonical, players), scenes),
  ] : [];
}

/** Cast art is independent of scene generation and uses the same fallback order everywhere. */
export function influenceCastArt(player: GamePlayer | undefined, visual: Pick<VisualWatchData, "portraits" | "fullBodies"> | null) {
  return player ? {
    fullBodyUrl: visual?.fullBodies?.[player.id],
    portraitUrl: visual?.portraits[player.id] ?? resolveAgentAvatarUrl(player.avatarUrl, player.persona, player.name, player.personaKey),
    fallbackPortraitUrl: resolveAgentAvatarUrl(null, player.persona, player.name, player.personaKey),
  } : {};
}
