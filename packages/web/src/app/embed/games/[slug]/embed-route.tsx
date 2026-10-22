import {notFound} from "next/navigation";
import {getPlayerCardGame} from "@/lib/server-player-card";
import {ServerApiError} from "@/lib/server-api";
import {playerSearch, type ReplaySearch} from "@/lib/player-card";
import {parseReplayAudience, parseReplayCursor, parseReplaySequenceParam} from "@/lib/game-links";
import {EmbeddedReplay} from "@/components/watch/embedded-replay";
export async function EmbedRoute({slug,sequence,search}: {slug:string;sequence?:string;search:ReplaySearch}) {
  let game;
  try { game = await getPlayerCardGame(slug); }
  catch (error) { if (error instanceof ServerApiError && [401,403,404].includes(error.status)) notFound(); throw error; }
  if (game.status !== "completed") return <p role="status" className="p-6">This replay is not available yet.</p>;
  try { playerSearch(search,game.gameKind); } catch { return <p role="alert" className="p-6">Invalid replay link.</p>; }
  const startSequence = sequence === undefined ? undefined : parseReplaySequenceParam(sequence);
  if (sequence !== undefined && (startSequence === undefined || game.gameKind !== "influence")) notFound();
  const audience = parseReplayAudience(search.audience), cursor = parseReplayCursor(search.cursor);
  if (audience === "invalid" || cursor === "invalid") notFound();
  return <EmbeddedReplay game={game} audience={audience ?? "mystery"} startCursor={cursor} startSequence={startSequence} />;
}
