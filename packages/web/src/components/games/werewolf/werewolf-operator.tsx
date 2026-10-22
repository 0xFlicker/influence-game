"use client";
import {usePermissions} from "@/hooks/use-permissions";
export function WerewolfOperator({busy, onStop}: {busy:boolean; onStop:()=>Promise<void>}) {
  const {hasPermission} = usePermissions();
  if (!hasPermission("stop_game")) return null;
  return <button disabled={busy} onClick={() => void onStop()}>Stop game</button>;
}
