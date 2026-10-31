"use client";

import {useState} from "react";
import {visualSpeechDurationMs, VISUAL_SPEECH_FADE_MS} from "@influence/engine/visual-speech";
import type {GamePlayer} from "@/lib/api";
import {AgentAvatar} from "@/components/agent-avatar";
import {useSceneThinking} from "@/components/watch/watch-thinking";
import type {FormatPresentationCue, SafetyBouncePresentationSnapshot} from "./types";
import type {VisualSpeech} from "./visual-scene-view";
import {INFLUENCE_ROOMS} from "./influence-rooms";
import {RoomBackdrop} from "./stage-backdrop";
import {TimedSpeech} from "./timed-speech";
import {soloPresentationDurationMs, soloPresentationMotion} from "./solo-presentation-timing";

type ChainCue = Extract<FormatPresentationCue, {kind: "safety_bounce_started" | "safety_bounce_pointer"}>;
export interface SafetyChainBeat {
  kind: "safety-chain";
  cue: ChainCue;
  roster: Array<GamePlayer & {fullBodyReferenceUrl?: string | null}>;
  speech?: VisualSpeech;
}

/** All positions derive from the accepted prefix, including when entering mid-chain. */
export function safetyChainPosition(board: SafetyBouncePresentationSnapshot, id: string) {
  const complete = board.benchPlayerIds.length === 0;
  if (!complete && id === board.currentActorId) return {x: 24, y: 48, width: 32, height: 58, pool: false};
  const bench = board.benchPlayerIds.indexOf(id);
  if (bench >= 0) return {x: 56 + (bench + .5) / board.benchPlayerIds.length * 40, y: 52, width: Math.min(23, 65 / Math.max(2, board.benchPlayerIds.length)), height: 45, pool: false};
  const safe = board.safePlayerIds.includes(id);
  const ids = (safe ? board.safePlayerIds : board.vulnerablePlayerIds).filter(player => complete || player !== board.currentActorId);
  return {x: (safe ? 3 : 52) + (ids.indexOf(id) + .5) / Math.max(1, ids.length) * 44, y: 90, width: Math.min(14, 42 / Math.max(1, ids.length)), height: 14, pool: true};
}

export function SafetyChain({beat, elapsedMs, reducedMotion = false, currentStateEntry = false, controlsInset = 0}: {
  beat: SafetyChainBeat; elapsedMs: number; reducedMotion?: boolean; currentStateEntry?: boolean; controlsInset?: number;
}) {
  const {cue, speech, roster} = beat;
  const thought = useSceneThinking();
  const thinkingReadingMs = thought ? VISUAL_SPEECH_FADE_MS + thought.elapsedMs / thought.durationMs * (visualSpeechDurationMs(thought.text) - 2 * VISUAL_SPEECH_FADE_MS) : 0;
  const after = cue.after.safetyBounce!;
  const before = cue.kind === "safety_bounce_pointer" ? cue.before.safetyBounce! : after;
  const revealAt = speech ? soloPresentationDurationMs(speech.text) : 1200;
  const reveal = !thought && (currentStateEntry || elapsedMs >= revealAt);
  const progress = !reveal ? 0 : reducedMotion || currentStateEntry ? 1 : Math.min(1, (elapsedMs - revealAt) / 1000);
  const board = progress === 1 ? after : before;
  const motion = soloPresentationMotion(speech?.text ?? "", elapsedMs, false, reducedMotion);
  const activeIds = new Set([...after.safePlayerIds, ...after.vulnerablePlayerIds, ...after.benchPlayerIds]);
  const name = (id: string) => roster.find(player => player.id === id)?.name ?? id;
  const title = cue.kind === "safety_bounce_started" ? `${name(cue.starterId)} starts the chain`
    : reveal ? `${name(cue.actorId)} picks ${name(cue.targetId)} · ${cue.classification === "safe" ? "Safe" : "Vulnerable"}`
      : `${name(cue.actorId)} chooses someone ${before.safePlayerIds.includes(cue.actorId) ? "Vulnerable" : "Safe"}`;
  return <section aria-label="Safety Bounce" data-safety-chain data-chain-count={after.pointers.length} data-accepted-target={cue.kind === "safety_bounce_pointer" ? cue.targetId : undefined} data-format-cue={cue.kind} className="relative min-h-0 flex-1 overflow-hidden text-white" style={{marginBottom: controlsInset}}>
    <RoomBackdrop source={INFLUENCE_ROOMS.council} />
    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/40" />
    <header className="absolute inset-x-2 top-3 z-20 text-center"><p className="text-xs uppercase tracking-[.2em] text-amber-100"><span>Safety Bounce</span> · Round {cue.round}</p><h2 className="mt-1 text-lg font-semibold sm:text-2xl" aria-live="polite">{title}</h2></header>
    <div className="absolute bottom-0 left-[2%] h-[22%] w-[46%] rounded-t-2xl border border-emerald-300/40 bg-emerald-950/65"><p className="pt-1 text-center text-xs font-semibold uppercase tracking-widest text-emerald-200">Safe · {board.safePlayerIds.length}</p></div>
    <div className="absolute bottom-0 right-[2%] h-[22%] w-[46%] rounded-t-2xl border border-amber-300/40 bg-amber-950/65"><p className="pt-1 text-center text-xs font-semibold uppercase tracking-widest text-amber-200">Vulnerable · {board.vulnerablePlayerIds.length}</p></div>
    {roster.filter(player => activeIds.has(player.id)).map(player => {
      const from = safetyChainPosition(before, player.id), to = safetyChainPosition(after, player.id);
      const mix = (a: number, b: number) => a + (b - a) * progress;
      const blend = from.pool === to.pool ? Number(to.pool) : from.pool ? 1 - progress : progress;
      return <div key={player.id} data-chain-player={player.id} data-chain-classification={after.safePlayerIds.includes(player.id) ? "safe" : after.vulnerablePlayerIds.includes(player.id) ? "vulnerable" : "unclassified"} data-chooser={player.id === board.currentActorId && board.benchPlayerIds.length > 0 || undefined} data-chain-pool={blend === 1 ? after.safePlayerIds.includes(player.id) ? "safe" : "vulnerable" : undefined}
        className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-end"
        style={{left: `${mix(from.x, to.x)}%`, top: `${mix(from.y, to.y)}%`, width: `${mix(from.width, to.width)}%`, height: `${mix(from.height, to.height)}%`, zIndex: player.id === before.currentActorId ? 12 : 10}}>
        <ChainCharacter player={player} blend={blend} />
        <span className="max-w-full truncate rounded bg-black/75 px-1.5 py-0.5 text-xs font-semibold sm:text-sm">{player.name}</span>
      </div>;
    })}
    {thought ? <aside data-in-scene-thinking className="absolute left-[41%] right-3 top-[23%] z-30 flex h-[43%] min-h-0 flex-col rounded-[2rem] border border-slate-300/40 bg-slate-950/95 p-4 text-slate-200" style={{opacity: thought.opacity}}><p className="mb-2 text-xs">{thought.speaker} thinks</p><TimedSpeech text={thought.text} elapsedMs={thinkingReadingMs} /></aside>
      : speech && !reveal && motion.speechOpacity > 0 && <blockquote data-speech-bubble className="absolute left-[39%] right-3 top-[23%] z-30 flex h-[43%] min-h-0 flex-col rounded-2xl border border-white/20 bg-black/90 p-4 text-base sm:text-xl" style={{opacity: motion.speechOpacity}}><TimedSpeech text={speech.text} elapsedMs={motion.speechElapsedMs} /></blockquote>}
    {board.benchPlayerIds.length === 0 && <p className="absolute inset-x-2 top-[68%] text-center text-sm text-white/85">The pools are set.</p>}
  </section>;
}

function ChainCharacter({player, blend}: {player: SafetyChainBeat["roster"][number]; blend: number}) {
  const [failed, setFailed] = useState<string | null>(null);
  const body = player.fullBodyReferenceUrl;
  return <div className="relative min-h-0 w-full flex-1">
    {body && failed !== body && blend < 1 && /* eslint-disable-next-line @next/next/no-img-element -- frozen full-body art */
      <img src={body} alt={player.name} onError={() => setFailed(body)} className="absolute inset-0 h-full w-full object-contain object-bottom" style={{opacity: 1 - blend}} />}
    {(!body || failed === body || blend > 0) && <div className="absolute inset-0 flex items-center justify-center" style={{opacity: !body || failed === body ? 1 : blend}}><AgentAvatar {...player} size={blend > 0 ? "8" : "16"} /></div>}
  </div>;
}
