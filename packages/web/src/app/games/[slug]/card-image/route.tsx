/* eslint-disable @next/next/no-img-element -- Satori embeds bounded artwork in generated PNGs. */
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getPlayerCardGame } from "@/lib/server-player-card";
import type { PlayerCardGame } from "@/lib/player-card";
import { resolveServerApiUrl, serverApiFetch, ServerApiError } from "@/lib/server-api";
import { createCardImageRenderQueue, CardImageRenderOverloadedError } from "../highlights/card-image/card-image-render-queue";

export const dynamic = "force-dynamic";
const queue = createCardImageRenderQueue<{response: Response; cast: string}>();
const headers = { "Cache-Control": "private, no-store" };
class PortraitUnavailableError extends Error {
  constructor(message: string, readonly retryAfter?: string) { super(message); }
}
function castIdentity(game: PlayerCardGame): string {
  return JSON.stringify([game.gameKind, game.title, game.cast.slice(0, 4).map(({id, name}) => [id, name])]);
}

/** Only our own bounded portrait endpoint is contacted; never fetch a stored URL. */
async function portrait(slug: string, id: string, cutout: boolean): Promise<string | null> {
  const path = `/api/game-entries/${encodeURIComponent(slug)}/card/portrait/${encodeURIComponent(id)}${cutout ? "?kind=cutout" : ""}`;
  let response: Response;
  try {
    response = await fetch(resolveServerApiUrl(path), { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8_000) });
  } catch (error) {
    throw new PortraitUnavailableError(`Portrait request failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new PortraitUnavailableError(`Portrait request returned ${response.status}`, response.status === 503 ? response.headers.get("retry-after") ?? undefined : undefined);
  if (response.headers.get("content-type")?.split(";")[0] !== "image/png" || Number(response.headers.get("content-length") ?? 0) > 2_000_000) throw new PortraitUnavailableError("Portrait response is not a bounded PNG");
  let bytes: ArrayBuffer;
  try { bytes = await response.arrayBuffer(); }
  catch { throw new PortraitUnavailableError("Portrait response could not be read"); }
  if (bytes.byteLength > 2_000_000) throw new PortraitUnavailableError("Portrait response exceeds its limit");
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}

async function backdrop(kind: PlayerCardGame["gameKind"]): Promise<string> {
  const root = process.cwd().endsWith("packages/web") ? "public" : "packages/web/public";
  const path = kind === "werewolf" ? "visual/werewolf/opening-v1/alley.jpg" : "visual/influence/rooms-v1/mingle-2.jpg";
  return `data:image/jpeg;base64,${(await readFile(resolve(process.cwd(), root, path))).toString("base64")}`;
}

function castLeft(index: number, count: number): number {
  if (count === 1) return 780;
  if (count === 2) return 680 + index * 210;
  if (count === 3) return 560 + index * 165;
  return 490 + index * 135;
}

/** Recede toward the center: the rightmost character is largest and appears in front. */
function gameCastPlacement(index: number, count: number, height: number) {
  const depth = count <= 1 ? 1 : index / (count - 1);
  const width = Math.round((height === 800 ? 320 : 288) + depth * 80);
  return { left: castLeft(index, count), width, height: Math.round(width * 1.25) };
}

function titleSize(title: string): number {
  if (title.length > 65) return 44;
  if (title.length > 45) return 52;
  if (title.length > 28) return 62;
  return 72;
}

export async function GET(request: Request, {params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params;
  const height = new URL(request.url).searchParams.get("format") === "farcaster" ? 800 : 630;
  try {
    const rendered = await queue.run(`${slug}\0${height}`, async () => {
      const game = await getPlayerCardGame(slug);
      const cast: Array<{id: string; image: string; cutout: boolean}> = [];
      // Keep one generated card from consuming the whole shared artwork budget.
      for (const player of game.cast.slice(0, 4)) {
        const cutout = await portrait(game.slug, player.id, true);
        const image = cutout ?? await portrait(game.slug, player.id, false);
        if (image) cast.push({id: player.id, image, cutout: !!cutout});
      }
      // The large, foreground figures occupy the outer edge; draw them last.
      const displayedCast = cast.toReversed();
      const gameName = game.gameKind === "werewolf" ? "WEREWOLF" : "INFLUENCE";
      const background = await backdrop(game.gameKind);
      const image = new ImageResponse(<div style={{display:"flex",position:"relative",width:"100%",height:"100%",overflow:"hidden",background:"#18130f",color:"#fff4dc"}}>
        <img src={background} alt="" width={1200} height={height} style={{position:"absolute",left:0,top:0,objectFit:"cover"}} />
        <div style={{display:"flex",position:"absolute",left:0,top:0,width:1200,height,background:"linear-gradient(90deg,rgba(13,10,8,.94),rgba(13,10,8,.72) 35%,rgba(13,10,8,.15) 75%)"}} />
        {displayedCast.map((player, index) => {
          const placement = gameCastPlacement(index, displayedCast.length, height);
          const portraitSize = Math.round(placement.width * .75);
          return <div key={player.id} style={{display:"flex",position:"absolute",left:placement.left,bottom:0,width:placement.width,height:placement.height,alignItems:"flex-end",justifyContent:"center"}}>
            {player.cutout
              ? <img src={player.image} alt="" width={placement.width} height={placement.height} style={{objectFit:"contain",objectPosition:"center bottom"}} />
              : <div style={{display:"flex",width:portraitSize,height:portraitSize,marginBottom:40,borderRadius:portraitSize / 2,overflow:"hidden",border:"4px solid #d6b474",background:"#23190f"}}><img src={player.image} alt="" width={portraitSize} height={portraitSize} style={{objectFit:"cover"}} /></div>}
          </div>;
        })}
        <div style={{display:"flex",position:"absolute",left:58,top:55,fontSize:38,fontWeight:700,letterSpacing:2,color:"#f0d49a"}}>THE HOUSE · {gameName}</div>
        <div style={{display:"flex",position:"absolute",left:58,top:height === 800 ? 230 : 190,width:420,flexDirection:"column"}}>
          <div style={{display:"flex",fontSize:titleSize(game.title),fontWeight:700,lineHeight:1.04,wordBreak:game.title.split(/\s+/).some(word => word.length > 16) ? "break-all" : "normal",textShadow:"0 3px 20px #090603"}}>{game.title}</div>
        </div>
      </div>, {width:1200,height,headers});
      return {response:new Response(await image.arrayBuffer(), image), cast:castIdentity(game)};
    });
    // Queue results are shared. Recheck each request independently so hiding a
    // game or changing its waiting cast while rendering cannot leak stale art.
    const current = await serverApiFetch<PlayerCardGame>(`/api/game-entries/${encodeURIComponent(slug)}/card`, {cache:"no-store"});
    if (castIdentity(current) !== rendered.cast) throw new PortraitUnavailableError("Game cast changed while rendering", "5");
    return rendered.response.clone();
  } catch (error) {
    console.error("[game-card] Rendering failed", error);
    return new Response(null, {status:error instanceof ServerApiError && error.status === 404 ? 404 : 503,
      headers:{...headers,...(error instanceof CardImageRenderOverloadedError ? {"Retry-After":"5"} : error instanceof PortraitUnavailableError && error.retryAfter && /^\d{1,4}$/.test(error.retryAfter) ? {"Retry-After":error.retryAfter} : {})}});
  }
}
