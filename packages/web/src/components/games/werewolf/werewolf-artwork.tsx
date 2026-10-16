import { EpisodeArtwork, episodeFallbackFrames } from "@/app/games/episode-preview";
import { resolveApiUrl, type EpisodeCast } from "@/lib/api";
import { WEREWOLF_CARD_ART } from "@/lib/game-art";

export function WerewolfArtwork({ coverUrl, cast = [] }: { coverUrl?: string | null; cast?: EpisodeCast[] }) {
  const frames = episodeFallbackFrames({ episode: { coverUrl: coverUrl ?? null, cast } });
  return <EpisodeArtwork frames={frames} active title="Werewolf" backgroundUrl={coverUrl ? resolveApiUrl(coverUrl) : WEREWOLF_CARD_ART} />;
}
