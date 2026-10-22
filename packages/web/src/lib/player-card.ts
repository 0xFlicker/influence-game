import type {Metadata} from "next";
import type {GameStatus, GameVisibility} from "./api";
import {WEREWOLF_CARD_ART} from "./game-art";
import {parseReplayAudience, parseReplayCursor, parseReplaySequenceParam} from "./game-links";
import {parseReplayShare, REPLAY_SHARE_KEYS} from "./replay-share";
import {serializeMiniAppEmbedMeta} from "./farcaster-miniapp";
export interface PlayerCardGame {
  id:string; slug:string; gameKind:"influence"|"werewolf"; status:GameStatus;
  visibility:GameVisibility; title:string; description:string; coverUrl:string|null;
}
export type ReplaySearch = Record<string,string|string[]|undefined>;
/** Forward only validated playback inputs; never a token, redirect, or arbitrary query. */
export function playerSearch(search:ReplaySearch, kind:PlayerCardGame["gameKind"]): string {
  const query = new URLSearchParams();
  for (const key of REPLAY_SHARE_KEYS) {
    const value = search[key];
    if (Array.isArray(value)) throw new Error("Invalid replay setting.");
    if (value !== undefined) query.set(key,value);
  }
  parseReplayShare(query);
  const audience = parseReplayAudience(search.audience), cursor = parseReplayCursor(search.cursor);
  if (audience === "invalid" || cursor === "invalid" || kind === "influence" && (audience || cursor !== undefined)) throw new Error("Invalid viewing mode.");
  if (kind === "werewolf") {
    if (cursor !== undefined && !audience) throw new Error("A Werewolf moment needs a viewing mode.");
    query.set("audience",audience ?? "mystery");
    if (cursor !== undefined) query.set("cursor",String(cursor));
  }
  return query.size ? `?${query}` : "";
}
export function playerCardMetadata(game:PlayerCardGame, origin:string, search:ReplaySearch = {}, sequence?:string): Metadata {
  const title = `${game.title} — ${game.gameKind === "werewolf" ? "Werewolf" : "Influence"} · The House`;
  const image = new URL(game.coverUrl ?? (game.gameKind === "werewolf" ? WEREWOLF_CARD_ART : "/promo.png"),origin).href;
  const metadata:Metadata = {title,description:game.description, alternates:{canonical:`/games/${encodeURIComponent(game.slug)}`},
    robots:game.visibility === "unlisted" ? {index:false,follow:false} : undefined,
    openGraph:{title,description:game.description,type:"website",images:[image]},
    twitter:{card:"summary_large_image",title,description:game.description,images:[image]}};
  if (game.status !== "completed") return metadata;
  if (sequence !== undefined && (game.gameKind !== "influence" || parseReplaySequenceParam(sequence) === undefined)) return metadata;
  let query:string;
  try { query = playerSearch(search,game.gameKind); } catch { return metadata; }
  metadata.other = {"fc:miniapp":serializeMiniAppEmbedMeta(origin, {
    path:`/games/${encodeURIComponent(game.slug)}/replay${sequence === undefined ? "" : `/${sequence}`}${query}`,
    buttonTitle:"Watch replay",
  })};
  // Next 16 requires streamUrl, but emits no stream tag for an empty value.
  // This is an HTML player, not a direct MP4 stream.
  metadata.twitter = {card:"player",title,description:game.description,images:[image],players:[{
    playerUrl:new URL(`/embed/games/${encodeURIComponent(game.slug)}${sequence === undefined ? "" : `/${sequence}`}${query}`,origin).href,
    streamUrl:"",width:640,height:640,
  }]};
  return metadata;
}
