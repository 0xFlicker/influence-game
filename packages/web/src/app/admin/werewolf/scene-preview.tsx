"use client";
import { useEffect, useState } from "react";
import { selectVisualShot, type AcceptedVisualScene } from "@influence/engine/visual-mode";
import { apiFetch } from "@/lib/api";
import { VisualSceneView } from "../../games/[slug]/components/visual-scene-view";

type Preview = { scene: AcceptedVisualScene; players: Array<{ id: string; name: string; fallback: string; imageUrl: string | null }> };
export function WerewolfScenePreview({ gameId, sceneId }: { gameId: string; sceneId: string }) {
  const [data, setData] = useState<Preview | null>(null), [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(""), [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<Preview>(`/api/admin/production/games/${gameId}/visual/scenes/${sceneId}/preview`, { signal: controller.signal }).then(setData).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [gameId, sceneId]);
  useEffect(() => { const start = performance.now(); const timer = setInterval(() => { const next = performance.now() - start; setElapsed(next); if (next >= 10_000) clearInterval(timer); }, 50); return () => clearInterval(timer); }, [selected]);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p role="status">Loading scene preview…</p>;
  const player = data.players.find(p => p.id === selected) ?? data.players[0];
  if (!player) return <p>No participants in this scene.</p>;
  const shot = data.scene.shots ? selectVisualShot(data.scene.shots, player.id) : null;
  const covered = shot ? shot.visibleParticipantIds.includes(player.id) : data.scene.anchors.some(a => a.playerId === player.id && a.confidence === "clear");
  return <div className="space-y-3">
    <label className="flex flex-wrap items-center gap-3 text-sm">Frame character<select aria-label="Frame character" className="influence-field min-h-11 rounded px-3" value={player.id} onChange={e => { setSelected(e.target.value); setElapsed(0); }}>{data.players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    <div className="relative flex h-[26rem] max-h-[65dvh] overflow-hidden rounded-xl bg-neutral-900" aria-label="Character framing preview">
      {covered && data.scene.imageUrl ? <VisualSceneView scene={data.scene} speech={{ id: player.id, playerId: player.id, speaker: player.name, text: "" }} elapsedMs={elapsed} />
        : player.imageUrl ? <div className="flex w-full flex-col items-center justify-center bg-[radial-gradient(ellipse_at_center,#403c36_0%,#151515_75%)] p-5">
          {/* eslint-disable-next-line @next/next/no-img-element -- private frozen reference supplied by authenticated preview */}
          <img src={player.imageUrl} alt={`${player.name} ${player.fallback.replaceAll("_", " ")} fallback`} className="min-h-0 flex-1 object-contain" /><p className="mt-3 text-sm">{player.name} · {player.fallback.replaceAll("_", " ")} fallback</p>
        </div> : <p className="m-auto p-6">No verified panel or frozen reference for {player.name}.</p>}
    </div>
    <p className="text-xs text-white/50">Production preview. Original dialogue and public playback are unchanged.</p>
  </div>;
}
