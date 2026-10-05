"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { AgentAvatar, resolveAgentAvatarUrl } from "@/components/agent-avatar";
import type { FormatPresentationRosterPlayer } from "./types";
import type { VisualPresentationBeat } from "./visual-presentation";
import { SoloPresentation } from "./solo-presentation";
import { FitPresentation } from "./fit-presentation";
import { soloPresentationDurationMs } from "./solo-presentation-timing";
import { voteLedgerRows, type RevealedVote, type VoteLedgerState } from "./vote-ledger-model";
import { SILENT_BALLOT_DURATION_MS, votePresentationTiming } from "./vote-presentation-timing";
import type { SceneFrame } from "./visual-scene-layout";
import backdropStyles from "./stage-backdrop.module.css";

export function VotePresentation({ beat, ledger, roster, elapsedMs, controlsInset = 0, silent = false, onImageReady, ...props }: {
  beat: Extract<VisualPresentationBeat, { kind: "portrait" }>;
  ledger: VoteLedgerState;
  roster: readonly FormatPresentationRosterPlayer[];
  elapsedMs: number;
  controlsInset?: number;
  silent?: boolean;
  onImageReady?: (source: string | null) => void;
  readingElapsedMs?: number;
  paused?: boolean;
  reducedMotion?: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const ledgerBox = useRef<HTMLDivElement>(null);
  const [ledgerHeight, setLedgerHeight] = useState(100);
  const [ledgerLayout, setLedgerLayout] = useState({ scale: 1, top: 0 });
  const [imageSource, setImageSource] = useState<string | null>(null);
  const [flight, setFlight] = useState<{ key: string; source: string; from: SceneFrame; to: SceneFrame } | null>(null);
  const timing = votePresentationTiming(elapsedMs, silent ? SILENT_BALLOT_DURATION_MS : soloPresentationDurationMs(beat.speech.text), props.reducedMotion);
  const revealed = ledger.complete || timing.revealed, progress = ledger.complete ? 1 : timing.progress;
  const canFly = !ledger.complete && flight?.key === beat.speech.id && imageSource !== null && flight.source === imageSource && !props.reducedMotion;
  useLayoutEffect(() => {
    const element = ledgerBox.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setLedgerHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // The row exists before collection so its exact responsive destination is measurable.
  useLayoutEffect(() => {
    const root = stage.current;
    const image = root?.querySelector<HTMLImageElement>("[data-solo-portrait]");
    const destination = root?.querySelector<HTMLElement>('[data-ledger-current="true"] [data-voter-portrait]');
    if (!root || !image || !destination) return;
    const observer = new ResizeObserver(() => {
      const origin = root.getBoundingClientRect();
      const rect = (element: Element): SceneFrame => {
        const box = element.getBoundingClientRect();
        return { left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height };
      };
      const from = rect(image), to = rect(destination);
      if (from.width <= 0 || to.width <= 0) return;
      const next = { key: beat.speech.id, source: image.getAttribute("src") ?? image.src, from, to };
      setFlight(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    });
    observer.observe(root);
    observer.observe(image);
    observer.observe(destination);
    return () => observer.disconnect();
  }, [revealed, beat.speech.id, imageSource, ledgerLayout.scale, ledgerLayout.top]);
  const votes = revealed ? ledger.votes : ledger.votes.slice(0, -1);
  const portrait = resolveAgentAvatarUrl(beat.player.avatarUrl, beat.player.persona, beat.player.name, beat.player.personaKey);
  const blend = Math.max(0, Math.min(1, (progress - .65) / .25));
  const frame = flight && canFly ? {
    left: flight.from.left + (flight.to.left - flight.from.left) * progress,
    top: flight.from.top + (flight.to.top - flight.from.top) * progress - Math.sin(progress * Math.PI) * 48,
    width: flight.from.width + (flight.to.width - flight.from.width) * progress,
    height: flight.from.height + (flight.to.height - flight.from.height) * progress,
  } : null;
  return <div ref={stage} className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" data-vote-presentation>
    <SoloPresentation {...props} beat={beat} elapsedMs={elapsedMs} controlsInset={controlsInset + ledgerHeight + 24}
      hideSpeech={silent || ledger.complete} staticSpeech onImageReady={source => {setImageSource(source); onImageReady?.(source);}}
      imageOpacity={ledger.complete || canFly && progress > 0 ? 0 : undefined} />
    {ledger.complete && <div className="absolute inset-x-6 top-1/3 text-center" data-vote-complete>
      <p className="text-sm uppercase tracking-widest text-white/60">{ledger.title}</p>
      <h2 className="mt-2 text-3xl font-semibold text-white">All votes are in</h2>
      {ledger.eligibility && <p className="mt-3 text-sm text-amber-100">{ledger.eligibility.label}{ledger.eligibility.ids.length === 0 ? " · No one qualifies" : ""}</p>}
    </div>}
    <div ref={ledgerBox} className="absolute inset-x-3 z-20 mx-auto h-[clamp(88px,28%,200px)] max-w-6xl overflow-hidden rounded-2xl border border-white/15 bg-black/80 p-2 shadow-2xl backdrop-blur-md sm:inset-x-6" style={{ bottom: controlsInset + 12 }}>
      <FitPresentation enabled onLayoutChange={setLedgerLayout}>
        <VoteLedger title={ledger.title} votes={votes} total={ledger.total} roster={roster}
          polarity={ledger.polarity} eligibility={ledger.complete ? ledger.eligibility : undefined}
          currentId={revealed ? ledger.current.voterId : undefined} portraitOpacity={canFly ? Math.max(0, (progress - .85) / .15) : 1} />
      </FitPresentation>
    </div>
    {canFly && frame && progress > 0 && progress < 1 && <div aria-hidden="true" data-ballot-collection
      className="pointer-events-none absolute z-30 overflow-hidden" style={{ ...frame, borderRadius: `${flight.source === beat.player.fullBodyReferenceUrl ? progress * 50 : 50}%`, boxShadow: `0 12px 48px rgba(0,0,0,${.3 * progress})` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- collect the displayed saved art into its ledger headshot */}
      <img src={flight.source} alt="" className={`absolute h-full w-full object-cover ${flight.source === beat.player.fullBodyReferenceUrl ? backdropStyles.featheredBody : ""}`} style={{ opacity: 1 - blend }} />
      {/* eslint-disable-next-line @next/next/no-img-element -- same frozen portrait used by the destination receipt */}
      <img src={portrait} alt="" className="absolute h-full w-full object-cover" style={{ opacity: blend }} />
    </div>}
  </div>;
}

export function VoteLedger({ title, votes, total, roster, currentId, portraitOpacity = 1, polarity = false, eligibility }: {
  title: string;
  votes: readonly RevealedVote[];
  total: number;
  roster: readonly FormatPresentationRosterPlayer[];
  currentId?: string;
  portraitOpacity?: number;
  polarity?: boolean;
  eligibility?: VoteLedgerState["eligibility"];
}) {
  const player = (id: string | null) => roster.find(entry => entry.id === id) ?? { id: id ?? "forfeit", name: id ?? "Forfeited", persona: "" };
  const rows = voteLedgerRows(votes);
  for (const id of eligibility?.ids ?? []) if (!rows.some(row => row.targetId === id)) rows.push({key:id,targetId:id,votes:[],saves:0,exits:0});
  return <section aria-label="Vote record" data-vote-ledger>
    <header className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[.16em] text-white/55">
      <h2 className="min-w-0 truncate">{title}</h2><p className="shrink-0" data-votes-revealed>{votes.length} / {total} votes shown</p>
    </header>
    {votes.length === 0 ? <p className="text-xs text-white/45">Waiting for the first vote</p> : <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {rows.map(row => {
        const target = row.targetId ? player(row.targetId) : {id: row.key, name: row.key === "abstain" ? "Hear more" : row.key === "unavailable" ? "Unavailable" : "Forfeited", persona: ""};
        const eligible = Boolean(row.targetId && eligibility?.ids.includes(row.targetId));
        return <li key={target.id} data-vote-target={target.id} data-vote-eligible={eligible} className={`flex min-w-0 items-center gap-3 rounded-xl border px-3 py-2 ${eligible ? "border-amber-300/70 bg-amber-300/15" : "border-white/10 bg-white/[.035]"}`}>
          {row.targetId && <AgentAvatar {...target} persona={target.persona ?? ""} size="8" />}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs"><span className="max-w-full truncate font-semibold text-white/90" title={target.name}>{target.name}{eligible && <span className="ml-2 text-[10px] font-normal text-amber-200">Eligible</span>}</span>
              <strong data-running-total={target.id} className="max-w-full shrink-0 break-words text-amber-100">{polarity ? `${row.saves} save · ${row.exits} exit · ${row.saves - row.exits} net` : row.votes.length}</strong>
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
              {row.votes.map(vote => {
                const voter = player(vote.voterId), current = vote.voterId === currentId;
                return <li key={vote.voterId} data-ledger-voter={vote.voterId} data-ledger-current={current ? "true" : "false"}
                  className={`flex min-w-0 max-w-full items-center gap-1 text-[10px] ${current ? "text-amber-100" : "text-white/60"}`} aria-label={`${voter.name} → ${target.name}${polarity ? ` · ${vote.choice}` : ""}`}>
                  <span className="shrink-0" data-voter-portrait style={{ opacity: current ? portraitOpacity : 1 }}><AgentAvatar {...voter} persona={voter.persona ?? ""} size="6" /></span>
                  <span className="min-w-0 truncate" title={voter.name}>{voter.name}{polarity ? ` (${vote.choice})` : ""}</span>
                </li>;
              })}
            </ul>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
