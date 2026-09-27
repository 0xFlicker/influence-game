"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { AgentAvatar, resolveAgentAvatarUrl } from "@/components/agent-avatar";
import type { FormatPresentationRosterPlayer } from "./types";
import type { VisualPresentationBeat } from "./visual-presentation";
import { SoloPresentation } from "./solo-presentation";
import { soloPresentationDurationMs } from "./solo-presentation-timing";
import { voteLedgerRows, type RevealedVote, type VoteLedgerState } from "./vote-ledger-model";
import { votePresentationTiming } from "./vote-presentation-timing";
import type { SceneFrame } from "./visual-scene-layout";
import backdropStyles from "./stage-backdrop.module.css";

export function VotePresentation({ beat, ledger, roster, elapsedMs, controlsInset = 0, ...props }: {
  beat: Extract<VisualPresentationBeat, { kind: "portrait" }>;
  ledger: VoteLedgerState;
  roster: readonly FormatPresentationRosterPlayer[];
  elapsedMs: number;
  controlsInset?: number;
  readingElapsedMs?: number;
  paused?: boolean;
  reducedMotion?: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const ledgerBox = useRef<HTMLDivElement>(null);
  const [ledgerHeight, setLedgerHeight] = useState(100);
  const [imageSource, setImageSource] = useState<string | null>(null);
  const [flight, setFlight] = useState<{ key: string; source: string; from: SceneFrame; to: SceneFrame } | null>(null);
  const { revealed, progress } = votePresentationTiming(elapsedMs, soloPresentationDurationMs(beat.speech.text), props.reducedMotion);
  const canFly = flight?.key === beat.speech.id && imageSource !== null && flight.source === imageSource && !props.reducedMotion;
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
    let aligned = false;
    const observer = new ResizeObserver(() => {
      const scrollBox = ledgerBox.current;
      if (scrollBox && !aligned) {
        const portrait = destination.getBoundingClientRect();
        const box = scrollBox.getBoundingClientRect();
        if (portrait.bottom > box.bottom - 12) scrollBox.scrollTop += portrait.bottom - box.bottom + 12;
        else if (portrait.top < box.top + 12) scrollBox.scrollTop += portrait.top - box.top - 12;
        aligned = true;
      }
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
  }, [revealed, beat.speech.id, imageSource]);
  const votes = revealed ? ledger.votes : ledger.votes.slice(0, -1);
  const portrait = resolveAgentAvatarUrl(beat.player.avatarUrl, beat.player.persona, beat.player.name, beat.player.personaKey);
  const blend = Math.max(0, Math.min(1, (progress - .65) / .25));
  const frame = flight && canFly ? {
    left: flight.from.left + (flight.to.left - flight.from.left) * progress,
    top: flight.from.top + (flight.to.top - flight.from.top) * progress - Math.sin(progress * Math.PI) * 48,
    width: flight.from.width + (flight.to.width - flight.from.width) * progress,
    height: flight.from.height + (flight.to.height - flight.from.height) * progress,
  } : null;
  return <div ref={stage} className="relative flex min-h-0 flex-1 flex-col" data-vote-presentation>
    <SoloPresentation {...props} beat={beat} elapsedMs={elapsedMs} controlsInset={controlsInset + ledgerHeight + 24}
      onImageReady={setImageSource}
      imageOpacity={canFly && progress > 0 ? 0 : undefined} />
    <div ref={ledgerBox} className="absolute inset-x-3 z-20 mx-auto max-h-[28%] max-w-6xl overflow-y-auto rounded-2xl border border-white/15 bg-black/80 p-3 shadow-2xl backdrop-blur-md sm:inset-x-6" style={{ bottom: controlsInset + 12 }}>
      <VoteLedger title={ledger.title} votes={votes} total={ledger.total} roster={roster}
        polarity={ledger.polarity}
        currentId={revealed ? ledger.current.voterId : undefined} portraitOpacity={canFly ? Math.max(0, (progress - .85) / .15) : 1} />
    </div>
    {canFly && frame && progress > 0 && progress < 1 && <div aria-hidden="true" data-ballot-collection
      className="pointer-events-none absolute z-30 overflow-hidden" style={{ ...frame, borderRadius: `${progress * 50}%`, boxShadow: `0 12px 48px rgba(0,0,0,${.3 * progress})` }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- collect the displayed saved art into its ledger headshot */}
      <img src={flight.source} alt="" className={`absolute h-full w-full object-cover ${flight.source === beat.player.fullBodyReferenceUrl ? backdropStyles.featheredBody : ""}`} style={{ opacity: 1 - blend }} />
      {/* eslint-disable-next-line @next/next/no-img-element -- same frozen portrait used by the destination receipt */}
      <img src={portrait} alt="" className="absolute h-full w-full object-cover" style={{ opacity: blend }} />
    </div>}
  </div>;
}

export function VoteLedger({ title, votes, total, roster, currentId, portraitOpacity = 1, polarity = false }: {
  title: string;
  votes: readonly RevealedVote[];
  total: number;
  roster: readonly FormatPresentationRosterPlayer[];
  currentId?: string;
  portraitOpacity?: number;
  polarity?: boolean;
}) {
  const player = (id: string | null) => roster.find(entry => entry.id === id) ?? { id: id ?? "forfeit", name: id ?? "Forfeited", persona: "" };
  return <section aria-label="Revealed vote ledger" data-vote-ledger>
    <header className="mb-2 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-[.16em] text-white/55">
      <h2>{title}</h2><p data-votes-revealed>{votes.length} / {total} revealed</p>
    </header>
    {votes.length === 0 ? <p className="text-xs text-white/45">Waiting for the first reveal</p> : <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      {voteLedgerRows(votes).map(row => {
        const target = player(row.targetId);
        return <li key={target.id} data-vote-target={target.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[.035] px-3 py-2">
          {row.targetId && <AgentAvatar {...target} persona={target.persona ?? ""} size="8" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3 text-xs"><span className="truncate font-semibold text-white/90" title={target.name}>{target.name}</span>
              <strong data-running-total={target.id} className="shrink-0 text-amber-100">{polarity ? `${row.saves} save · ${row.exits} exit · ${row.saves - row.exits} net` : row.votes.length}</strong>
            </div>
            <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
              {row.votes.map(vote => {
                const voter = player(vote.voterId), current = vote.voterId === currentId;
                return <li key={vote.voterId} data-ledger-voter={vote.voterId} data-ledger-current={current ? "true" : "false"}
                  className={`flex items-center gap-1 text-[10px] ${current ? "text-amber-100" : "text-white/60"}`} aria-label={`${voter.name} → ${target.name}${polarity ? ` · ${vote.choice}` : ""}`}>
                  <span data-voter-portrait style={{ opacity: current ? portraitOpacity : 1 }}><AgentAvatar {...voter} persona={voter.persona ?? ""} size="6" /></span>
                  <span>{voter.name}{polarity ? ` (${vote.choice})` : ""}</span>
                </li>;
              })}
            </ul>
          </div>
        </li>;
      })}
    </ul>}
  </section>;
}
