import { notFound } from "next/navigation";
import { HouseGameEntry, type HouseGameEntryProps } from "@/components/games/house-game-entry";
import { getServerGameEntry, getServerGame, getServerWerewolfLobby, ServerApiError } from "@/lib/server-api";

const bootstrapOptions = (): RequestInit => ({ signal: AbortSignal.timeout(1500) });

export async function HouseGameRoute(props: Omit<HouseGameEntryProps, "identity" | "initialStatus">) {
  let identity;
  try { identity = await getServerGameEntry(props.slug); }
  catch (error) {
    return <HouseGameEntry {...props} initialStatus={error instanceof ServerApiError ? error.status : 503} />;
  }
  if (identity.gameKind === "werewolf") {
    if (props.startSequence !== undefined) notFound();
    let initialWerewolfLobby;
    if (props.mode === "entry") {
      try { initialWerewolfLobby = await getServerWerewolfLobby(identity.slug, bootstrapOptions()); }
      catch (error) { console.error("[HouseEntry] Werewolf lobby preparation failed", error); }
    }
    return <HouseGameEntry {...props} identity={identity} initialWerewolfLobby={initialWerewolfLobby} />;
  }
  let initialGame;
  if (props.mode !== "highlights" && props.mode !== "replay") {
    try { initialGame = await getServerGame(identity.slug, bootstrapOptions()); }
    catch (error) { console.error("[HouseEntry] Game preparation failed", error); }
  }
  return <HouseGameEntry {...props} identity={identity} initialGame={initialGame} />;
}
