"use client";

import {useLayoutEffect, useRef, useState} from "react";
import type {HeadRectangle} from "@influence/engine/character-portrait";
import {thinkingFocus, ThinkingFocusOverlay} from "@/components/watch/thinking-focus";
import {useBubbleTypography} from "@/components/watch/use-bubble-typography";
import {SpeechBubble} from "@/components/watch/speech-bubble";
import type {SceneFrame} from "./visual-scene-layout";
import type {GamePlayer} from "@/lib/api";
import {AgentAvatar} from "@/components/agent-avatar";
import {useSceneThinking} from "@/components/watch/watch-thinking";
import type {FormatPresentationCue, SafetyBouncePresentationSnapshot} from "./types";
import type {VisualSpeech} from "./visual-scene-view";
import {INFLUENCE_ROOMS} from "./influence-rooms";
import {RoomBackdrop} from "./stage-backdrop";

import {soloPresentationDurationMs, soloPresentationMotion} from "./solo-presentation-timing";

const DEFAULT_HEAD = {x:.4,y:.04,width:.2,height:.16};

type ChainCue = Extract<FormatPresentationCue, {kind: "safety_bounce_started" | "safety_bounce_pointer"}>;
export interface SafetyChainBeat {
  kind: "safety-chain";
  cue: ChainCue;
  roster: Array<GamePlayer & {fullBodyReferenceUrl?: string | null; headRectangle?: HeadRectangle}>;
  speech?: VisualSpeech;
}

/** All positions derive from the accepted prefix, including when entering mid-chain. */
export function safetyChainPosition(board: SafetyBouncePresentationSnapshot, id: string, mobile = false) {
  const complete = board.benchPlayerIds.length === 0;
  if (!complete && id === board.currentActorId) return {x: 24, y: mobile ? 58 : 48, width: 32, height: mobile ? 38 : 58, pool: false};
  const bench = board.benchPlayerIds.indexOf(id);
  if (bench >= 0) return {x: 56 + (bench + .5) / board.benchPlayerIds.length * 40, y: 52, width: Math.min(23, 65 / Math.max(2, board.benchPlayerIds.length)), height: 45, pool: false};
  const safe = board.safePlayerIds.includes(id);
  const ids = (safe ? board.safePlayerIds : board.vulnerablePlayerIds).filter(player => complete || player !== board.currentActorId);
  return {x: (safe ? 3 : 52) + (ids.indexOf(id) + .5) / Math.max(1, ids.length) * 44, y: 90, width: Math.min(14, 42 / Math.max(1, ids.length)), height: 14, pool: true};
}

/** The actual object-contain/object-bottom pixels, before any thinking camera transform. */
export function chainCharacterHead(area: SceneFrame, image: {width:number;height:number}, body:boolean, head:HeadRectangle): SceneFrame {
  const scale = body ? Math.min(area.width / Math.max(1,image.width),area.height / Math.max(1,image.height)) : 1;
  const width = image.width * scale, height = image.height * scale;
  const left = area.left + (area.width - width) / 2;
  const top = area.top + (area.height - height) / (body ? 1 : 2);
  const target = body ? head : {x:.24,y:.12,width:.52,height:.52};
  return {left:left + width * target.x,top:top + height * target.y,width:width * target.width,height:height * target.height};
}

/** Desktop speech covers the speaker's body; mobile speech uses the space above their head. */
export function chainSpeechBox(width:number,height:number,face:SceneFrame): SceneFrame {
  const desktop = width >= 640;
  const bubbleWidth = Math.max(0,desktop ? Math.min(960,width * .44) : width - 32);
  const top = desktop ? face.top + face.height + 16 : 84;
  return {left:desktop ? Math.max(16,Math.min(width * .49 - bubbleWidth,face.left + face.width / 2 - bubbleWidth / 2)) : 16,
    top,width:bubbleWidth,height:Math.max(0,desktop ? height * .76 - top - 16 : face.top - 16 - top)};
}

export function SafetyChain({beat, elapsedMs, reducedMotion = false, currentStateEntry = false, controlsInset = 0}: {
  beat: SafetyChainBeat; elapsedMs: number; reducedMotion?: boolean; currentStateEntry?: boolean; controlsInset?: number;
}) {
  const {cue, speech, roster} = beat;
  const thought = useSceneThinking();
  const actorId = cue.kind === "safety_bounce_pointer" ? cue.actorId : cue.starterId;
  const actor = roster.find(player => player.id === actorId);
  const after = cue.after.safetyBounce!;
  const before = cue.kind === "safety_bounce_pointer" ? cue.before.safetyBounce! : after;
  const revealAt = speech ? soloPresentationDurationMs(speech.text) : 1200;
  const reveal = !thought && (currentStateEntry || elapsedMs >= revealAt);
  const progress = !reveal ? 0 : reducedMotion || currentStateEntry ? 1 : Math.min(1, (elapsedMs - revealAt) / 1000);
  const board = progress === 1 ? after : before;
  const frame = useRef<HTMLElement>(null);
  const [size,setSize] = useState({width:0,height:0});
  const [mediaRevision,setMediaRevision] = useState(0);
  const [face,setFace] = useState<SceneFrame>({left:0,top:0,width:0,height:0});
  const [portrait,setPortrait] = useState(false);
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setSize(previous => previous.width === element.clientWidth && previous.height === element.clientHeight ? previous : {width:element.clientWidth,height:element.clientHeight});
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  },[]);
  const position = safetyChainPosition(board,actorId,size.width > 0 && size.width < 640);
  const head = actor?.headRectangle ?? DEFAULT_HEAD;
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const character = Array.from(element.querySelectorAll<HTMLElement>("[data-chain-player]")).find(node => node.dataset.chainPlayer === actorId);
    const image = character?.querySelector<HTMLImageElement>("img");
    const area = character?.querySelector<HTMLElement>("[data-chain-character]");
    if (!character || !image || !area) return;
    // offset/client dimensions are untransformed: never measure the zoomed camera back into its own target.
    const left = size.width * position.x / 100 - character.offsetWidth / 2;
    const top = size.height * position.y / 100 - character.offsetHeight / 2;
    const body = image.hasAttribute("data-chain-body");
    setFace(chainCharacterHead({left,top,width:area.clientWidth,height:area.clientHeight},
      body ? {width:image.naturalWidth,height:image.naturalHeight} : {width:image.offsetWidth,height:image.offsetHeight},body,head));
    setPortrait(!body);
  },[actorId,cue.key,size.width,size.height,mediaRevision,position.x,position.y,head]);
  const focus = thinkingFocus(size.width,size.height,face,thought?.focus ?? 0,portrait,reducedMotion);
  const beside = size.width >= 640;
  const speechBox = chainSpeechBox(size.width,size.height,face);
  const speechFit = useBubbleTypography(frame,speech?.text ?? "",speechBox,"speech",size.height < 300);
  const bubble = {...speechBox,width:speechFit.typography?.width ?? speechBox.width,height:speechFit.typography?.height ?? speechBox.height,
    ...(beside ? {left:Math.max(16,Math.min(size.width * .49 - (speechFit.typography?.width ?? speechBox.width),face.left + face.width / 2 - (speechFit.typography?.width ?? speechBox.width) / 2))}
      : {top:face.top - 16 - (speechFit.typography?.height ?? speechBox.height)})};
  const motion = soloPresentationMotion(speech?.text ?? "", elapsedMs, false, reducedMotion);
  const activeIds = new Set([...after.safePlayerIds, ...after.vulnerablePlayerIds, ...after.benchPlayerIds]);
  const name = (id: string) => roster.find(player => player.id === id)?.name ?? id;
  const title = cue.kind === "safety_bounce_started" ? `${name(cue.starterId)} starts the chain`
    : reveal ? `${name(cue.actorId)} picks ${name(cue.targetId)} · ${cue.classification === "safe" ? "Safe" : "Vulnerable"}`
      : `${name(cue.actorId)} chooses someone ${before.safePlayerIds.includes(cue.actorId) ? "Vulnerable" : "Safe"}`;
  return <section ref={frame} aria-label="Safety Bounce" data-safety-chain data-chain-count={after.pointers.length} data-accepted-target={cue.kind === "safety_bounce_pointer" ? cue.targetId : undefined} data-format-cue={cue.kind} className="relative min-h-0 flex-1 overflow-hidden text-white" style={{marginBottom: controlsInset}}>
    <RoomBackdrop source={INFLUENCE_ROOMS.council} />
    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-black/40" />
    <header className="absolute inset-x-2 top-3 z-20 text-center"><p className="text-xs uppercase tracking-[.2em] text-amber-100"><span>Safety Bounce</span> · Round {cue.round}</p><h2 className="mt-1 text-lg font-semibold sm:text-2xl" aria-live="polite">{title}</h2></header>
    <div className="absolute bottom-0 left-[2%] h-[22%] w-[46%] rounded-t-2xl border border-emerald-300/40 bg-emerald-950/65"><p className="pt-1 text-center text-xs font-semibold uppercase tracking-widest text-emerald-200">Safe · {board.safePlayerIds.length}</p></div>
    <div className="absolute bottom-0 right-[2%] h-[22%] w-[46%] rounded-t-2xl border border-amber-300/40 bg-amber-950/65"><p className="pt-1 text-center text-xs font-semibold uppercase tracking-widest text-amber-200">Vulnerable · {board.vulnerablePlayerIds.length}</p></div>
    <div data-thinking-camera className="absolute inset-0" style={focus.mediaStyle}>
    {roster.filter(player => activeIds.has(player.id)).map(player => {
      const from = safetyChainPosition(before, player.id,size.width > 0 && size.width < 640), to = safetyChainPosition(after, player.id,size.width > 0 && size.width < 640);
      const mix = (a: number, b: number) => a + (b - a) * progress;
      const blend = from.pool === to.pool ? Number(to.pool) : from.pool ? 1 - progress : progress;
      return <div key={player.id} onLoadCapture={() => setMediaRevision(value=>value+1)} onErrorCapture={() => setMediaRevision(value=>value+1)} data-chain-player={player.id} data-chain-classification={after.safePlayerIds.includes(player.id) ? "safe" : after.vulnerablePlayerIds.includes(player.id) ? "vulnerable" : "unclassified"} data-chooser={player.id === board.currentActorId && board.benchPlayerIds.length > 0 || undefined} data-chain-pool={blend === 1 ? after.safePlayerIds.includes(player.id) ? "safe" : "vulnerable" : undefined}
        className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-end"
        style={{left: `${mix(from.x, to.x)}%`, top: `${mix(from.y, to.y)}%`, width: `${mix(from.width, to.width)}%`, height: `${mix(from.height, to.height)}%`, zIndex: player.id === before.currentActorId ? 12 : 10}}>
        <ChainCharacter player={player} blend={blend} />
        <span className="max-w-full truncate rounded bg-black/75 px-1.5 py-0.5 text-xs font-semibold sm:text-sm">{player.name}</span>
      </div>;
    })}
    </div>
    {!thought && speech && !reveal && motion.speechOpacity > 0 && <SpeechBubble speaker={speech.speaker} caption="Safety Bounce" text={speech.text}
      box={bubble} opacity={motion.speechOpacity} typography={speechFit.typography} padding={speechFit.padding} elapsedMs={motion.speechElapsedMs}
      tail={{side:beside ? "top" : "bottom",style:{left:Math.max(16,Math.min(bubble.width - 24,face.left + face.width / 2 - bubble.left))}}}/>}
    <ThinkingFocusOverlay frame={frame} layout={focus}/>
    {board.benchPlayerIds.length === 0 && <p className="absolute inset-x-2 top-[68%] text-center text-sm text-white/85">The pools are set.</p>}
  </section>;
}

function ChainCharacter({player, blend}: {player: SafetyChainBeat["roster"][number]; blend: number}) {
  const [failed, setFailed] = useState<string | null>(null);
  const body = player.fullBodyReferenceUrl;
  return <div data-chain-character className="relative min-h-0 w-full flex-1">
    {body && failed !== body && blend < 1 && /* eslint-disable-next-line @next/next/no-img-element -- frozen full-body art */
      <img data-chain-body src={body} alt={player.name} onError={() => setFailed(body)} className="absolute inset-0 h-full w-full object-contain object-bottom" style={{opacity: 1 - blend}} />}
    {(!body || failed === body || blend > 0) && <div className="absolute inset-0 flex items-center justify-center" style={{opacity: !body || failed === body ? 1 : blend}}><AgentAvatar {...player} size={blend > 0 ? "8" : "16"} /></div>}
  </div>;
}
