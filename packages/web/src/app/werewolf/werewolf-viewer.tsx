"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
import { getWerewolf, stopWerewolf, type WerewolfRead } from "@/lib/werewolf-api";
import { usePermissions } from "@/hooks/use-permissions";
import type { WerewolfAudience, WerewolfPublicEntry } from "@influence/engine/werewolf/observation";

const roleNames = { werewolf: "Werewolf", villager: "Villager", seer: "Seer", doctor: "Doctor" };
export function WerewolfViewer({ slug }: { slug: string }) {
  const [audience, setAudience] = useState<WerewolfAudience>("mystery");
  const [cursor, setCursor] = useState<number | null>(1);
  const [playing, setPlaying] = useState(false);
  const [read, setRead] = useState<{ key: string; value: WerewolfRead } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [stopping, setStopping] = useState(false);
  const { hasPermission } = usePermissions();
  const key = `${slug}:${audience}:${cursor}`;
  // A previous prefix is safe while advancing. Never retain future facts when
  // seeking backward or switching audience, even for a single paint.
  const data = read?.value.slug === slug && read.value.view.audience === audience
    && (cursor === null || read.value.view.cursor <= cursor) ? read.value : null;
  const error = failure?.key === key ? failure.message : null;
  useEffect(() => {
    const controller = new AbortController();
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const value = await getWerewolf(slug, audience, cursor, controller.signal);
        if (!controller.signal.aborted) { setRead({ key, value }); setFailure(null); }
      } catch (e) {
        if (!controller.signal.aborted) setFailure({ key, message: e instanceof Error ? e.message : "Could not load game" });
      } finally { fetching = false; }
    };
    void refresh(); const timer = setInterval(() => { void refresh(); }, 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [slug, audience, cursor, key]);
  useEffect(() => {
    if (!playing || !data || cursor === null || cursor !== data.view.cursor || cursor >= data.latestCursor) return;
    const timer = setTimeout(() => setCursor(cursor + 1), 2200);
    return () => clearTimeout(timer);
  }, [playing, data, cursor]);
  const name = (id: string | null) => data?.view.players.find((player) => player.id === id)?.name ?? "Nobody";
  function entryText(entry: WerewolfPublicEntry) {
    switch (entry.kind) {
      case "phase": return entry.phase === "introduction" ? "Meet the village" : `${entry.phase === "night" ? "Night" : entry.phase === "vote" ? "The vote" : "Day"} ${entry.day}`;
      case "speech": return entry.text;
      case "discussion": return `Day ${entry.day} · Discussion beat ${entry.result.beat}/6`;
      case "night": return entry.killedId ? `${name(entry.killedId)} died during the night.` : "Everyone survived the night.";
      case "vote": return entry.result.eliminatedId ? `${name(entry.result.eliminatedId)} was eliminated by the village.` : "The vote tied. Nobody was eliminated.";
      case "result": return entry.outcome.faction === "wolves" ? "The wolves win." : entry.outcome.faction === "village" ? "The village wins." : "The game ends in a draw.";
    }
  }
  return <>
    <Link href="/werewolf" className="text-sm text-white/50 hover:text-white">← Werewolf games</Link>
    <div className="mt-6 flex flex-wrap items-end justify-between gap-5"><div><p className="text-xs uppercase tracking-[0.2em] text-amber-200/65">Werewolf · {cursor === null ? "Live view" : "Replay"}</p><h1 className="mt-2 break-words text-3xl font-semibold tracking-tight">{slug}</h1></div>
      <fieldset className="flex rounded-xl border border-white/20 p-1"><legend className="sr-only">Spectator mode</legend>{(["mystery", "omniscient"] as const).map((mode) => <button key={mode} type="button" aria-pressed={audience === mode} onClick={() => { setAudience(mode); setCursor(1); setPlaying(false); }} className={`min-h-11 rounded-lg px-4 text-sm ${audience === mode ? "bg-amber-100 text-black" : "text-white/60"}`}>{mode === "mystery" ? "Mystery" : "Omniscient"}</button>)}</fieldset>
    </div>
    <p className="mt-3 text-sm text-white/50">{audience === "mystery" ? "Roles stay hidden until the ending. Follow the public conversation." : "All roles are visible. Pack discussion and night outcomes are included."}</p>
    {error && <p role="alert" className="mt-5 text-red-200">{error}</p>}
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-white/15 p-3">
      <button className="influence-button-secondary min-h-11 rounded-lg px-4" onClick={() => { setCursor(1); setPlaying(false); }}>Beginning</button>
      <button className="influence-button-secondary min-h-11 rounded-lg px-4" disabled={!data || cursor === null} onClick={() => setPlaying(!playing)}>{playing ? "Pause" : "Play"}</button>
      <button className="influence-button-secondary min-h-11 rounded-lg px-4" disabled={!data || cursor === null || cursor >= data.latestCursor} onClick={() => { setPlaying(false); setCursor((cursor ?? 1) + 1); }}>Next</button>
      <button className="influence-button-secondary min-h-11 rounded-lg px-4" onClick={() => { setCursor(null); setPlaying(false); }}>Latest</button>
      <label className="flex min-w-40 flex-1 items-center gap-3 text-xs text-white/60"><span>Position</span><input aria-label="Replay position" className="w-full accent-amber-200" type="range" min={1} max={data?.latestCursor ?? Math.max(1, cursor ?? 1)} value={cursor ?? data?.latestCursor ?? 1} onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }} /><span>{data?.view.cursor ?? cursor ?? "…"}</span></label>
    </div>
    {!data ? <p role="status" className="py-10 text-white/50">Loading the village…</p> : <>
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{data.view.players.map((player) => <div key={player.id} className={`influence-panel rounded-xl p-4 ${player.alive ? "" : "opacity-50"}`}><div className="mb-3"><AgentAvatar name={player.name} avatarUrl={player.avatarUrl} personaKey={player.personaKey} persona="" size="12" /></div><p className="font-semibold">{player.name}</p><p className="mt-1 text-xs text-white/50">{player.role ? roleNames[player.role] : "Role unknown"} · {player.alive ? "Alive" : "Dead"}</p></div>)}</div>
      <div className="mt-7 flex items-center justify-between gap-4"><p className="text-sm text-white/60">{data.view.phase === "complete" ? "Game complete" : `Day ${data.view.day} · ${data.view.phase}`} · {data.view.players.filter((p) => p.alive).length} alive</p>{data.status === "in_progress" && hasPermission("stop_game") && <button disabled={stopping} className="text-sm text-white/50 underline" onClick={async () => { setStopping(true); try { await stopWerewolf(data.view.gameId); } catch (e) { setFailure({ key, message: e instanceof Error ? e.message : "Could not stop game" }); } finally { setStopping(false); } }}>Stop game</button>}</div>
      {data.view.discussion && <p className="mt-3 text-sm text-amber-100/70">{data.view.discussion.ended ? "Discussion closed. Voting follows." : `Discussion beat ${data.view.discussion.beat}/${data.view.discussion.maxBeats} · Messages reveal together.`} Each player has up to four messages; passing preserves them.</p>}
      {data.status === "suspended" && <p role="status" className="mt-4 text-amber-200">The game stopped after an execution error. Committed play remains available.</p>}
      {data.status === "cancelled" && <p role="status" className="mt-4 text-amber-200">An operator stopped this game.</p>}
      <ol className="mt-6 space-y-4">{data.view.entries.map((entry, index) => <li key={index} className={entry.kind === "phase" ? "pt-6 text-lg font-semibold" : `rounded-xl border p-5 ${entry.kind === "speech" && entry.audience === "pack" ? "border-red-300/25 bg-red-950/15" : "border-white/10 bg-white/[0.025]"}`}>
        {entry.kind === "speech" && <p className="mb-2 text-sm font-semibold text-amber-100/85">{name(entry.actorId)}{entry.audience === "pack" ? " · Pack discussion" : ""}</p>}
        <p className="whitespace-pre-wrap break-words leading-7">{entryText(entry)}</p>
        {entry.kind === "discussion" && <>
          <p className="mt-1 text-xs text-white/45">These decisions were made before anyone saw this beat’s messages.</p>
          <ul className="mt-4 space-y-4">{entry.result.contributions.map((contribution) => <li key={contribution.actorId} className="border-t border-white/10 pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-sm font-semibold text-amber-100/85">{name(contribution.actorId)}</p><span className="text-xs text-white/45">{entry.result.messagesRemaining[contribution.actorId]}/4 messages left</span></div>
            <p className={`mt-1 whitespace-pre-wrap break-words leading-7 ${contribution.text === null ? "text-white/45" : ""}`}>{contribution.unavailable ? "Unable to respond this beat." : contribution.text ?? "Passed."}</p>
          </li>)}</ul>
          {entry.result.endReason ? <p className="mt-4 text-sm text-amber-100/70">{entry.result.endReason === "all_passed" ? "Nobody added a message." : entry.result.endReason === "message_limit" ? "Everyone has used their four messages." : "Six discussion beats are complete."} Voting follows.</p>
            : entry.result.beat === 1 && entry.result.contributions.every((contribution) => contribution.text === null) ? <p className="mt-4 text-sm text-amber-100/70">A quiet opening. Everyone gets another beat.</p> : null}
        </>}
        {entry.kind === "night" && entry.attackTargetId && <div className="mt-3 text-sm leading-7 text-white/50"><p>Pack targeted {name(entry.attackTargetId)}. {entry.protectedId ? `Doctor protected ${name(entry.protectedId)}.` : "No protection."}</p>{entry.investigation && <p>{name(entry.investigation.seerId)} checked {name(entry.investigation.targetId)}: {entry.investigation.isWolf ? "wolf" : "not a wolf"}.</p>}</div>}
        {entry.kind === "vote" && <div className="mt-3 grid gap-1 text-sm text-white/55 sm:grid-cols-2">{entry.result.ballots.map((ballot) => <p key={ballot.voterId}>{name(ballot.voterId)} → {name(ballot.targetId)}</p>)}</div>}
        {entry.kind === "result" && entry.outcome.winnerIds.length > 0 && <p className="mt-3 text-sm text-amber-100/70">Winners: {entry.outcome.winnerIds.map(name).join(", ")}</p>}
      </li>)}</ol>
    </>}
  </>;
}
