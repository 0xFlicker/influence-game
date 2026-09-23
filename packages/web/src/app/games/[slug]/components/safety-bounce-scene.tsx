"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import { SafetyBounceStage } from "./safety-bounce-stage";
import { FormatPresentation } from "./format-presentation";
import { bounceArrowPath, safetyBounceAnchors, type SafetyBounceSceneBeat } from "./safety-bounce-scene-model";
import { frameVisualScene } from "./visual-scene-layout";

type Classification = "safe" | "vulnerable" | "unclassified";
const colors = { safe: "#6ee7b7", vulnerable: "#fbbf24", unclassified: "#e2e8f0" };

/** Saved lobby pixels + canonical pointer receipts; no generated or inferred choices. */
export function SafetyBounceScene({ beat, elapsedMs, paused, reducedMotion, currentStateEntry = false, fullscreen = false }: {
  beat: SafetyBounceSceneBeat;
  elapsedMs: number;
  paused: boolean;
  reducedMotion: boolean;
  currentStateEntry?: boolean;
  fullscreen?: boolean;
}) {
  const { cue, roster, scene } = beat;
  const board = cue.after.safetyBounce!;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const markerId = useId().replaceAll(":", "");
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [loaded, setLoaded] = useState<{ url: string; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const element = frameRef.current;
    if (!element) return;
    const measure = () => setSize(old => old.width === element.clientWidth && old.height === element.clientHeight ? old : { width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scene.imageUrl, failedImage]);
  const imageKnown = loaded?.url === scene.imageUrl;
  const frame = frameVisualScene(size.width, size.height, imageKnown ? loaded.width : 0, imageKnown ? loaded.height : 0);
  if (failedImage === scene.imageUrl) return cue.kind === "safety_bounce_started" || cue.kind === "safety_bounce_pointer"
    ? <SafetyBounceStage cue={cue} roster={roster} currentStateEntry={currentStateEntry} />
    : <FormatPresentation cue={cue} roster={roster} currentStateEntry={currentStateEntry} />;

  const anchors = safetyBounceAnchors(scene);
  const participants = roster.filter(player => scene.participantIds.includes(player.id));
  const name = (id: string) => roster.find(player => player.id === id)?.name ?? id;
  const complete = board.benchPlayerIds.length === 0;
  const actorId = cue.kind === "safety_bounce_pointer" && !currentStateEntry ? cue.actorId : !complete ? board.currentActorId : null;
  const targetId = cue.kind === "safety_bounce_pointer" ? cue.targetId : null;
  const classification = (id: string): Classification => board.safePlayerIds.includes(id) ? "safe" : board.vulnerablePlayerIds.includes(id) ? "vulnerable" : "unclassified";
  const order = [board.starterId, ...board.pointers.map(pointer => pointer.targetId)];
  const aggregate = cue.after.resolution?.aggregate;
  const totals = aggregate?.capability === "public_chain" && cue.after.resolution?.resolutionKind !== "auto" ? aggregate.voteTotals : null;
  const title = cue.kind === "safety_bounce_started" ? `${name(cue.starterId)} starts Safe`
    : cue.kind === "safety_bounce_pointer" ? `${name(cue.actorId)} marks ${name(cue.targetId)} ${cue.classification === "safe" ? "Safe" : "Vulnerable"}`
    : cue.kind === "format_tiebreak" ? `${name(cue.tiebreakerId)} breaks the tie`
    : cue.ballotPresentationStatus === "not_applicable" ? "One Vulnerable guest · automatic elimination" : "Votes to eliminate";
  const detail = cue.kind === "format_tiebreak" ? `Tied: ${cue.tiedPlayerIds.map(name).join(" · ")}`
    : complete ? "Chain complete · only Vulnerable guests can be voted out."
    : `Up next: ${name(board.currentActorId)} chooses someone ${board.safePlayerIds.includes(board.currentActorId) ? "Vulnerable" : "Safe"}.`;

  return <section aria-label="Safety Bounce in the lobby" data-format-cue={cue.kind} data-safety-bounce-scene={scene.id}
    className={`flex min-h-0 flex-1 flex-col text-white ${fullscreen ? "pb-[140px]" : ""}`}>
    <header className="shrink-0 px-3 pb-3 pt-2 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/50">Safety Bounce · Round {cue.round}</p>
      <h2 className="mt-1 text-base font-semibold sm:text-xl" aria-live="polite">{title}</h2>
      <p className="mt-1 text-xs text-white/65">{detail}</p>
    </header>
    <div ref={frameRef} className="relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute" style={imageKnown ? frame : { inset: 0 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- immutable published room image */}
        <img src={scene.imageUrl} alt="Safety Bounce lobby" className="block h-full w-full object-contain"
          onLoad={event => setLoaded({ url: scene.imageUrl, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setFailedImage(scene.imageUrl)} />
        {imageKnown && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
          <defs>{(["safe", "vulnerable"] as const).map(state => <marker key={state} id={`${markerId}-${state}`} viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={colors[state]} /></marker>)}</defs>
          {board.pointers.map((pointer, index) => {
            const from = anchors.get(pointer.actorId), to = anchors.get(pointer.targetId);
            if (!from || !to) return null;
            const active = cue.kind === "safety_bounce_pointer" && index === board.pointers.length - 1;
            const progress = paused || reducedMotion || currentStateEntry || !active ? 1 : Math.min(1, elapsedMs / 450);
            const path = bounceArrowPath(from, to, index);
            return <g key={`${pointer.actorId}:${pointer.targetId}`} data-chain-arrow={`${pointer.actorId}:${pointer.targetId}`} data-classification={pointer.classification} opacity={active ? 1 : .55}>
              <path d={path} fill="none" stroke="black" strokeWidth={active ? 6 : 4} vectorEffect="non-scaling-stroke" opacity=".7" />
              <path d={path} fill="none" stroke={colors[pointer.classification]} strokeWidth={active ? 3 : 2} vectorEffect="non-scaling-stroke" pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress} markerEnd={progress === 1 ? `url(#${markerId}-${pointer.classification})` : undefined} />
            </g>;
          })}
        </svg>}
        {imageKnown && participants.map(player => {
          const point = anchors.get(player.id);
          if (!point) return null;
          const state = classification(player.id);
          const number = order.indexOf(player.id) + 1;
          return <div key={player.id} data-scene-player={player.id} data-classification={state} data-chooser={actorId === player.id || undefined} data-selected={targetId === player.id || undefined}
            aria-label={`${player.name}: ${state}${actorId === player.id ? ", current chooser" : ""}${number > 0 ? `, chain position ${number}` : ""}`}
            title={`${player.name} · ${state}${number > 0 ? ` · ${number}` : ""}`}
            className={`absolute flex -translate-x-1/2 items-center gap-0.5 rounded-full border bg-black/90 px-1 py-0.5 shadow-lg ${actorId === player.id ? "ring-2 ring-white ring-offset-2 ring-offset-black" : ""}`}
            style={{ left: `clamp(18px, ${point.x * 100}%, calc(100% - 18px))`, top: `clamp(0px, ${point.y * 100}%, calc(100% - 20px))`, color: colors[state], borderColor: colors[state] }}>
            <StatusIcon state={state} />
            {number > 0 && <span className="text-[9px] font-bold sm:text-[11px]">{number}</span>}
            {totals && board.vulnerablePlayerIds.includes(player.id) && <span aria-label={`${totals[player.id] ?? 0} votes`} className="border-l border-white/30 pl-1 text-[10px] font-bold">{totals[player.id] ?? 0}</span>}
          </div>;
        })}
      </div>
    </div>
    <footer className="shrink-0 px-3 pb-2 pt-3">
      <div className="mb-2 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-white/70">
        <span className="text-emerald-300">✓ Safe {board.safePlayerIds.length}</span>
        <span className="text-amber-300">△ Vulnerable {board.vulnerablePlayerIds.length}</span>
        {!complete && <span>Unclassified {board.benchPlayerIds.length}</span>}
        {actorId && <span>White ring · chooser</span>}
      </div>
      <ol aria-label="Safety Bounce chain" className="flex max-h-28 flex-wrap justify-center gap-1.5 overflow-y-auto text-[10px] sm:text-xs">
        {[...order, ...board.benchPlayerIds].map(id => <li key={id} data-chain-member={id} aria-label={`${name(id)}: ${classification(id)}`} className="flex items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 py-1" style={{ color: colors[classification(id)] }}>
          <StatusIcon state={classification(id)} /><span>{order.includes(id) ? `${order.indexOf(id) + 1}. ` : ""}{name(id)}</span>
          {!anchors.has(id) && <span className="sr-only"> · position unavailable</span>}
        </li>)}
      </ol>
    </footer>
  </section>;
}

function StatusIcon({ state }: { state: Classification }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {state === "safe" ? <><circle cx="10" cy="10" r="8" /><path d="m6 10 3 3 5-6" /></>
      : state === "vulnerable" ? <><path d="M10 2 19 18H1Z" /><path d="M10 7v4m0 3v.2" /></>
      : <circle cx="10" cy="10" r="6" strokeDasharray="2 3" />}
  </svg>;
}
