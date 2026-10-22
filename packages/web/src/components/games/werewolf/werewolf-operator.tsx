"use client";
import {useState} from "react";
import {usePermissions} from "@/hooks/use-permissions";
import {stopWerewolf} from "@/lib/werewolf-api";
export function WerewolfOperator({gameId}: {gameId:string}) {
  const {hasPermission} = usePermissions();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string>();
  if (!hasPermission("stop_game")) return null;
  return <><button disabled={busy} onClick={async () => {
    setBusy(true); setError(undefined);
    try { await stopWerewolf(gameId); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not stop game."); }
    finally { setBusy(false); }
  }}>Stop game</button>{error && <p role="alert">{error}</p>}</>;
}
