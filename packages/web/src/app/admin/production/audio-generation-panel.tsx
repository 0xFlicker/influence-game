"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { VoiceAssignment } from "@influence/engine/voice-catalog";
import { useAdminSession } from "../admin-session";
interface Preview {
  resumeOwnerEpoch: string | null; previewHash: string; voices: Record<string, VoiceAssignment>; clipCount: number; characters: number;
  estimateUsd: number; retryBudgetUsd: number;
  tracks: { id: string; status: string; error: string | null }[];
}
export function AudioGenerationPanel({ root }: { root: string }) {
  const session = useAdminSession(), client = useQueryClient();
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const preview = useQuery({ queryKey: ["admin", session.scope, `${root}/audio`], queryFn: ({ signal }) => session.read<Preview>(`${root}/audio`, signal),
    refetchInterval: query => query.state.data?.tracks.some(track => ["queued", "running"].includes(track.status)) ? 3000 : false });
  async function generate(trackId?: string) {
    if (!preview.data || busy) return;
    setBusy(true); setError(null);
    try {
      await session.execute(`operation:${root}/audio:${trackId ?? "first-track"}`, trackId ? `${root}/audio/${trackId}/retry` : `${root}/audio`, trackId ? {} : { previewHash: preview.data.previewHash });
      await client.invalidateQueries({ queryKey: ["admin", session.scope, `${root}/audio`] });
      await client.invalidateQueries({ predicate: query => query.queryKey[0] === "admin" && query.queryKey[1] === session.scope && String(query.queryKey[2]).endsWith(":generated-audio") });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Audio request failed"); }
    finally { setBusy(false); }
  }
  async function resume() {
    if (!preview.data?.resumeOwnerEpoch || busy) return;
    setBusy(true);setError(null);
    try {
      await session.execute(`operation:${root}/audio:resume`,`${root}/audio/resume`,{ownerEpoch:preview.data.resumeOwnerEpoch});
      await client.invalidateQueries({queryKey:["admin",session.scope,`${root}/audio`]});
    } catch(cause) {setError(cause instanceof Error ? cause.message : "Game could not resume");}
    finally {setBusy(false);}
  }
  if (preview.error) return <p role="alert">Audio preview unavailable: {preview.error.message}</p>;
  if (!preview.data) return <p role="status">Preparing audio estimate…</p>;
  const data = preview.data;
  return <section aria-label="Generate game audio"><h3>Game audio</h3><p>{data.clipCount} speech and thinking clips. Estimated ${data.estimateUsd.toFixed(3)}, with up to ${data.retryBudgetUsd.toFixed(3)} including retries.</p>
    <p>House: Helios. Player presets: {[...new Set(Object.entries(data.voices).filter(([id]) => id !== "house").map(([, voice]) => voice.voiceId))].join(", ")}.</p>
    <p>Voices freeze when generation starts. Existing clips are kept when retrying.</p>
    {data.tracks.length ? data.tracks.map(track => <div key={track.id}><p role="status">Audio: {track.status}</p>{track.error && <p role="alert">{track.error}</p>}{track.status === "failed" && <button disabled={busy} onClick={() => void generate(track.id)}>Retry missing clips</button>}</div>)
      : <button disabled={busy || !data.clipCount} onClick={() => void generate()}>{busy ? "Starting…" : "Generate full audio track"}</button>}
    {data.resumeOwnerEpoch && <button disabled={busy} onClick={()=>void resume()}>Resume game with ready audio</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
