import { notFound } from "next/navigation";
import { HouseGameEntry, type HouseGameEntryProps } from "@/components/games/house-game-entry";
import { getServerGameEntry, getServerGame, ServerApiError } from "@/lib/server-api";
import { loadReplayPageData } from "./replay/replay-page";

export async function HouseGameRoute(props: Omit<HouseGameEntryProps, "identity" | "initialStatus">) {
  let identity;
  try { identity = await getServerGameEntry(props.slug); }
  catch (error) {
    return <HouseGameEntry {...props} initialStatus={error instanceof ServerApiError ? error.status : 503} />;
  }
  if (identity.gameKind === "werewolf") {
    if (props.startSequence !== undefined) notFound();
    return <HouseGameEntry {...props} identity={identity} />;
  }
  const initial: Partial<Awaited<ReturnType<typeof loadReplayPageData>>> = props.mode === "replay" ? await loadReplayPageData(identity.slug) : {};
  let initialGame = initial.initialGame;
  if (!initialGame && props.mode !== "highlights" && props.mode !== "replay") {
    try { initialGame = await getServerGame(identity.slug); }
    catch (error) { console.error("[HouseEntry] Game preparation failed", error); }
  }
  return <HouseGameEntry {...props} identity={identity} {...initial} initialGame={initialGame} />;
}
