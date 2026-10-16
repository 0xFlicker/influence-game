import { CastPreview } from "../cast-preview";
import type { EpisodeCast } from "@/lib/api";
import Image from "next/image";
import { resolveApiUrl } from "@/lib/api";
import { WEREWOLF_CARD_ART } from "@/lib/game-art";

export function WerewolfArtwork({ coverUrl, cast = [] }: { coverUrl?: string | null; cast?: EpisodeCast[] }) {
  return <div className="episode-artwork werewolf-artwork">
    <Image src={coverUrl ? resolveApiUrl(coverUrl) : WEREWOLF_CARD_ART} alt="" fill sizes="(max-width: 768px) 100vw, 700px" className="episode-scene" unoptimized />
    <div className="werewolf-artwork-shade" />
    <CastPreview cast={cast} />
    <Image src="/logo.png" alt="The House" width={52} height={52} className="werewolf-house-mark" />
  </div>;
}
