"use client";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { VoiceAssignment, PlayerVoiceId } from "@influence/engine/voice-catalog";
interface VoiceResponse { assignment: VoiceAssignment; voices: {id:PlayerVoiceId;name:string;gender:string}[] }
/** A separate explicit save keeps this preference independent of character drafts. */
export function AgentVoicePicker({agentId}:{agentId:string}) {
  const [data,setData]=useState<VoiceResponse|null>(null),[selected,setSelected]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  useEffect(() => {
    const controller=new AbortController();setData(null);setError(null);
    void apiFetch<VoiceResponse>(`/api/agent-profiles/${encodeURIComponent(agentId)}/voice`,{signal:controller.signal}).then(value => {if (!value?.assignment || !Array.isArray(value.voices)) throw new Error("Voice unavailable");if (!controller.signal.aborted) {setData(value);setSelected(value.assignment.voiceId);}}).catch(cause => {if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Voice unavailable");});
    return () => controller.abort();
  },[agentId]);
  async function save() {
    if (!data || busy) return;setBusy(true);setError(null);
    try {const result=await apiFetch<{assignment:VoiceAssignment}>(`/api/agent-profiles/${encodeURIComponent(agentId)}/voice`,{method:"PUT",body:JSON.stringify({voiceId:selected})});setData({...data,assignment:result.assignment});}
    catch(cause) {setError(cause instanceof Error ? cause.message : "Voice could not be saved");}
    finally {setBusy(false);}
  }
  return <section className="space-y-2"><label className="block" htmlFor={`voice-${agentId}`}>Voice preset</label>
    {data ? <><select id={`voice-${agentId}`} value={selected} onChange={event=>setSelected(event.target.value)} disabled={busy} className="rounded border border-white/20 bg-black p-2">{data.voices.map(voice=><option key={voice.id} value={voice.id}>{voice.name} · {voice.gender}</option>)}</select>
      <button type="button" disabled={busy||selected===data.assignment.voiceId} onClick={()=>void save()} className="ml-3 rounded border border-white/20 p-2">{busy?"Saving…":"Save voice"}</button></> : !error && <p role="status">Loading voice…</p>}
    <p className="text-sm text-white/50">Used for future Audio Mode games and new historical tracks. Existing tracks keep their frozen voices.</p>{error&&<p role="alert">{error}</p>}
  </section>;
}
