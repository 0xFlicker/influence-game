"use client";

import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { AgentAvatar } from "@/components/agent-avatar";
import {
  getPublicWatchIntelligence,
  type GameDetail,
  type PublicWatchIntelligenceResult,
  type TranscriptEntry,
} from "@/lib/api";
import { formatTime, PHASE_LABELS, setEndgameAttr, setPhaseAttr } from "./constants";
import { DramaticReplayViewer } from "./dramatic-replay-viewer";
import { diaryPlayerName, groupMessages } from "./diary-room";
import {
  buildMatchWatchIntelligenceModel,
  type MatchWatchIntelligenceModel,
  type MatchWatchIntelligenceSectionModel,
} from "./match-watch-intelligence-model";
import {
  buildMatchWatchModel,
  type MatchWatchModel,
  type MatchWatchPhaseSegment,
  type MatchWatchPlayerCard,
  type MatchWatchPlayerStatusTag,
  type MatchWatchPlaybackState,
} from "./match-watch-model";
import type { WatchConnStatus } from "./types";

export function MatchWatchShell({
  game,
  messages,
  live = false,
  connStatus,
}: {
  game: GameDetail;
  messages: TranscriptEntry[];
  live?: boolean;
  connStatus?: WatchConnStatus;
}) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<MatchWatchPlaybackState | null>(null);
  const [intelligence, setIntelligence] = useState<PublicWatchIntelligenceResult | null>(null);
  const [intelligenceLoadState, setIntelligenceLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const handlePlaybackStateChange = useCallback((state: MatchWatchPlaybackState) => {
    setPlaybackState((current) => {
      if (isSamePlaybackState(current, state)) return current;
      return state;
    });
  }, []);
  const model = useMemo(
    () =>
      buildMatchWatchModel({
        game,
        messages,
        live,
        connStatus,
        selectedPlayerId,
        playbackState: live ? null : playbackState,
      }),
    [game, messages, live, connStatus, selectedPlayerId, playbackState],
  );
  const visibleMessages = live ? messages : playbackState?.visibleMessages ?? messages;
  const inspectorMessages = useMemo(
    () => (live ? messages : buildReplayTranscriptSlice(messages, playbackState?.visibleMessages)),
    [live, messages, playbackState?.visibleMessages],
  );
  const intelligenceModel = useMemo(
    () =>
      buildMatchWatchIntelligenceModel({
        model,
        intelligence,
        visibleMessages,
        loadState: intelligenceLoadState,
        error: intelligenceError,
      }),
    [model, intelligence, visibleMessages, intelligenceLoadState, intelligenceError],
  );

  useEffect(() => {
    setPhaseAttr(model.phase);
    setEndgameAttr(model.phase);
    return () => {
      document.documentElement.removeAttribute("data-phase");
      document.documentElement.removeAttribute("data-endgame");
    };
  }, [model.phase]);

  useEffect(() => {
    if (!model.selectedPlayerId) {
      startTransition(() => {
        setIntelligence(null);
        setIntelligenceLoadState("idle");
        setIntelligenceError(null);
      });
      return;
    }

    let cancelled = false;
    startTransition(() => {
      setIntelligenceLoadState("loading");
      setIntelligenceError(null);
    });
    void getPublicWatchIntelligence(game.slug ?? game.id, {
      actorPlayerId: model.selectedPlayerId,
      round: model.round,
      phase: model.phase,
      limit: 4,
    })
      .then((result) => {
        if (cancelled) return;
        setIntelligence(result);
        setIntelligenceLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setIntelligence(null);
        setIntelligenceLoadState("error");
        setIntelligenceError("Intelligence is not available for this moment.");
      });

    return () => {
      cancelled = true;
    };
  }, [game.id, game.slug, model.selectedPlayerId, model.round, model.phase]);

  return (
    <main
      className="fixed inset-0 z-30 flex min-h-0 flex-col overflow-hidden influence-shell"
      data-testid="match-watch-shell"
      data-watch-mode={model.mode}
    >
      <div className="pointer-events-none absolute inset-0 influence-phase-atmosphere" />
      <div className="pointer-events-none absolute inset-0 influence-phase-vignette" />
      <ShellHeader model={model} />
      <PhaseRail model={model} />

      <div className="relative grid min-h-0 flex-1 grid-cols-1 gap-3 px-3 pb-3 xl:grid-cols-[18rem_minmax(0,1fr)_22rem]">
        <CastRail model={model} onSelectPlayer={setSelectedPlayerId} />
        <MobileContextPanel model={model} onSelectPlayer={setSelectedPlayerId} />
        <TheaterPanel
          game={game}
          messages={messages}
          live={live}
          connStatus={connStatus}
          model={model}
          onPlaybackStateChange={handlePlaybackStateChange}
        />
        <InspectorPanel model={model} intelligence={intelligenceModel} messages={inspectorMessages} />
      </div>

      <ReplayDock model={model} />
    </main>
  );
}

function MobileContextPanel({
  model,
  onSelectPlayer,
}: {
  model: MatchWatchModel;
  onSelectPlayer: (playerId: string) => void;
}) {
  const selected = model.selectedPlayer;
  return (
    <section className="flex min-h-0 flex-col gap-2 rounded-lg border border-white/10 bg-black/45 p-3 shadow-panel backdrop-blur-glass xl:hidden">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/70">
          Cast
        </h2>
        <span className="shrink-0 text-[9px] uppercase tracking-[0.14em] text-white/35">
          {model.counts.alivePlayers} alive / {model.counts.eliminatedPlayers} out
        </span>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Cast selection">
        {model.players.map((card) => (
          <button
            key={card.player.id}
            type="button"
            onClick={() => onSelectPlayer(card.player.id)}
            className={`flex h-10 min-w-28 items-center gap-2 rounded-md border px-2 text-left ${
              card.isSelected
                ? "border-phase/40 bg-phase/[0.12]"
                : "border-white/10 bg-white/[0.03]"
            }`}
          >
            <AgentAvatar
              avatarUrl={card.player.avatarUrl}
              personaKey={card.player.personaKey}
              persona={card.player.persona}
              name={card.player.name}
              size="6"
            />
            <span className="min-w-0">
              <span className="block truncate text-[11px] font-medium text-white/85">
                {card.player.name}
              </span>
              <CastStatusTags card={card} compact />
            </span>
          </button>
        ))}
      </div>

      {selected ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md border border-white/10 bg-white/[0.025] px-3 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white/90">
              {selected.player.name}
            </div>
            <CastStatusTags card={selected} />
          </div>
          <span className={`rounded px-2 py-1 text-[9px] uppercase tracking-[0.12em] ${statusClasses(selected)}`}>
            {selected.statusLabel}
          </span>
        </div>
      ) : null}
    </section>
  );
}

function ShellHeader({ model }: { model: MatchWatchModel }) {
  return (
    <header className="relative mx-3 mt-3 grid min-h-14 shrink-0 grid-cols-1 items-center gap-3 rounded-lg border border-white/10 bg-black/45 px-4 py-3 shadow-panel backdrop-blur-glass lg:grid-cols-[18rem_minmax(0,1fr)_22rem] lg:py-0">
      <div className="flex min-w-0 items-center gap-4">
        <div className="text-sm font-medium tracking-[0.45em] text-white/90">INFLUENCE</div>
        <div className="hidden h-5 w-px bg-white/10 sm:block" />
        <div className="text-[10px] uppercase tracking-[0.28em] text-white/35">Watch Room</div>
      </div>

      <div className="min-w-0 text-left lg:text-center">
        <div className="truncate text-sm font-semibold uppercase tracking-[0.18em] text-white/90">
          {model.matchTitle}
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-white/35">
          {model.roundLabel} {model.connectionLabel}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
        <Link
          href="/games"
          aria-label="Exit watch room"
          title="Exit"
          className="inline-flex h-8 items-center rounded-md border border-white/10 bg-white/[0.03] px-3 text-[10px] uppercase tracking-[0.14em] text-white/55 transition-colors hover:border-white/25 hover:bg-white/[0.06] hover:text-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-phase/60"
        >
          Exit
        </Link>
        <StatusPill value={model.counts.alivePlayers} label="Alive" />
        <StatusPill value={model.counts.eliminatedPlayers} label="Out" />
        <span className="inline-flex h-8 items-center gap-2 rounded-md border border-phase/30 bg-phase/10 px-3 text-[10px] uppercase tracking-[0.14em] text-white/80">
          <span className="h-1.5 w-1.5 rounded-full bg-phase shadow-phase-sm" />
          {model.connectionLabel}
        </span>
      </div>
    </header>
  );
}

function StatusPill({ value, label }: { value: number; label: string }) {
  return (
    <span className="inline-flex h-8 items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-3 text-[10px] uppercase tracking-[0.14em] text-white/55">
      <strong className="text-xs text-white/95">{value}</strong>
      {label}
    </span>
  );
}

function PhaseRail({ model }: { model: MatchWatchModel }) {
  return (
    <nav className="relative mx-3 mt-2 grid shrink-0 grid-cols-1 gap-3 rounded-lg border border-white/10 bg-black/40 px-3 py-3 backdrop-blur-glass lg:grid-cols-[8.5rem_minmax(0,1fr)_12rem] lg:items-center">
      <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.22em] text-white/55">
        <span>Round</span>
        <span className="grid h-7 min-w-7 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-white/90">
          {model.roundLabel.replace("Round ", "")}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 lg:grid-cols-8">
        {model.phaseSegments.map((segment) => (
          <PhaseSegment key={segment.key} segment={segment} />
        ))}
      </div>

      <div className="justify-self-start rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-white/45 lg:justify-self-end">
        Strategy Lens
      </div>
    </nav>
  );
}

function PhaseSegment({ segment }: { segment: MatchWatchPhaseSegment }) {
  const className =
    segment.state === "current"
      ? "border-phase/60 bg-phase/[0.15] text-white shadow-phase-sm"
      : segment.state === "past"
        ? "border-white/[0.12] bg-white/[0.04] text-white/55"
        : "border-white/5 bg-white/[0.015] text-white/25";

  return (
    <div className={`relative flex h-8 min-w-0 items-center justify-center overflow-hidden rounded-md border px-2 text-[9px] uppercase tracking-[0.14em] ${className}`}>
      <span className="truncate">{segment.label}</span>
      {segment.state === "current" && (
        <span className="absolute inset-x-0 bottom-0 h-0.5 bg-phase" />
      )}
    </div>
  );
}

function CastRail({
  model,
  onSelectPlayer,
}: {
  model: MatchWatchModel;
  onSelectPlayer: (playerId: string) => void;
}) {
  return (
    <aside className="hidden min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/45 shadow-panel backdrop-blur-glass xl:flex">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/85">
          Cast & Status
        </h2>
        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-white/35">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {model.counts.totalPlayers} total
        </span>
      </div>

      <div className="grid grid-cols-1 gap-px border-b border-white/10 bg-white/10">
        <CastMetric label="Phase" value={model.phaseLabel} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {model.players.map((card) => (
          <button
            key={card.player.id}
            type="button"
            onClick={() => onSelectPlayer(card.player.id)}
            className={`grid w-full grid-cols-[2.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors ${
              card.isSelected
                ? "border-phase/40 bg-phase/[0.12] shadow-phase-sm"
                : "border-transparent hover:border-white/10 hover:bg-white/[0.03]"
            }`}
          >
            <AgentAvatar
              avatarUrl={card.player.avatarUrl}
              personaKey={card.player.personaKey}
              persona={card.player.persona}
              name={card.player.name}
              size="8"
            />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-white/90">
                {card.player.name}
              </span>
              <CastStatusTags card={card} />
            </span>
            <span className={`justify-self-end rounded px-1.5 py-1 text-[9px] uppercase tracking-[0.12em] ${statusClasses(card)}`}>
              {card.statusLabel}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function CastMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 bg-white/[0.025] px-3 py-3">
      <div className="text-[8px] uppercase tracking-[0.16em] text-white/30">{label}</div>
      <div className="mt-1 truncate text-[11px] font-medium text-white/75">{value}</div>
    </div>
  );
}

function CastStatusTags({
  card,
  compact,
}: {
  card: MatchWatchPlayerCard;
  compact?: boolean;
}) {
  const tags = compact ? card.statusTags.slice(0, 1) : card.statusTags;
  if (tags.length === 0) return null;

  return (
    <span className={`mt-1 flex min-w-0 flex-wrap gap-1 ${compact ? "max-w-20" : ""}`}>
      {tags.map((tag) => (
        <span
          key={`${card.player.id}-${tag.kind}`}
          title={tag.title}
          className={`inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] uppercase leading-none tracking-[0.1em] ${statusTagClasses(tag)}`}
        >
          <span aria-hidden="true" className="text-[9px] leading-none">{tag.icon}</span>
          <span className="truncate">{tag.label}</span>
        </span>
      ))}
    </span>
  );
}

function statusTagClasses(tag: MatchWatchPlayerStatusTag): string {
  switch (tag.kind) {
    case "empowered":
      return "border-amber-300/25 bg-amber-400/10 text-amber-200";
    case "empowered_selected":
      return "border-rose-300/25 bg-rose-400/10 text-rose-200";
    case "locked_at_risk":
    case "selectable_exposed":
      return "border-fuchsia-300/25 bg-fuchsia-400/10 text-fuchsia-200";
    case "replacement_risk":
      return "border-orange-300/25 bg-orange-400/10 text-orange-200";
    case "fallback_risk":
      return "border-white/15 bg-white/[0.04] text-white/55";
    case "shielded":
      return "border-sky-300/25 bg-sky-400/10 text-sky-200";
  }
}

function TheaterPanel({
  game,
  messages,
  live,
  connStatus,
  model,
  onPlaybackStateChange,
}: {
  game: GameDetail;
  messages: TranscriptEntry[];
  live: boolean;
  connStatus?: WatchConnStatus;
  model: MatchWatchModel;
  onPlaybackStateChange: (state: MatchWatchPlaybackState) => void;
}) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/45 shadow-panel backdrop-blur-glass">
      <div className="grid min-h-14 shrink-0 gap-2 border-b border-white/10 px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="min-w-0">
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/40">
            {model.roundLabel} / {model.phaseFeedLabel}
          </div>
          <h1 className="mt-1 truncate text-base font-semibold text-white/95">
            {model.phaseLabel}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <TheaterChip>{model.counts.totalPlayers} agents</TheaterChip>
          <TheaterChip>{model.connectionLabel}</TheaterChip>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <DramaticReplayViewer
          game={game}
          messages={messages}
          players={game.players}
          live={live}
          connStatus={connStatus}
          embedded
          onPlaybackStateChange={live ? undefined : onPlaybackStateChange}
        />
      </div>
    </section>
  );
}

function TheaterChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-7 items-center rounded-md border border-white/10 bg-white/[0.03] px-2.5 text-[9px] uppercase tracking-[0.14em] text-white/45">
      {children}
    </span>
  );
}

type InspectorTab = "overview" | "thinking" | "strategy" | "diary";

function InspectorPanel({
  model,
  intelligence,
  messages,
}: {
  model: MatchWatchModel;
  intelligence: MatchWatchIntelligenceModel;
  messages: TranscriptEntry[];
}) {
  const selected = model.selectedPlayer;
  const [activeTab, setActiveTab] = useState<InspectorTab>("overview");
  const diaryEntries = useMemo(() => buildDiaryArchiveEntries(messages), [messages]);

  return (
    <aside className="hidden min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-black/45 shadow-panel backdrop-blur-glass xl:flex">
      {selected ? <InspectorHero card={selected} /> : null}

      <div className="grid h-11 shrink-0 grid-cols-4 gap-1 border-b border-white/10 px-2 py-1.5" role="tablist" aria-label="Inspector sections">
        <InspectorLabel active={activeTab === "overview"} onClick={() => setActiveTab("overview")}>Overview</InspectorLabel>
        <InspectorLabel active={activeTab === "thinking"} onClick={() => setActiveTab("thinking")}>Thinking</InspectorLabel>
        <InspectorLabel active={activeTab === "strategy"} onClick={() => setActiveTab("strategy")}>Strategy</InspectorLabel>
        <InspectorLabel active={activeTab === "diary"} onClick={() => setActiveTab("diary")}>Diary</InspectorLabel>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {activeTab === "overview" ? (
          <InspectorSection title="Audience Lens" section={intelligence.overview} />
        ) : null}
        {activeTab === "thinking" ? (
          <InspectorSection title="Thinking" meta={sectionMeta(intelligence)} section={intelligence.thinking} />
        ) : null}
        {activeTab === "strategy" ? (
          <InspectorSection title="Strategy" meta={sectionMeta(intelligence)} section={intelligence.strategy} />
        ) : null}
        {activeTab === "diary" ? (
          <InspectorDiary entries={diaryEntries} />
        ) : null}
      </div>
    </aside>
  );
}

function InspectorHero({ card }: { card: MatchWatchPlayerCard }) {
  return (
    <div className="relative shrink-0 overflow-hidden border-b border-white/10 px-4 py-4">
      <div className="absolute right-0 top-0 h-28 w-28 rounded-full bg-phase/10 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <AgentAvatar
          avatarUrl={card.player.avatarUrl}
          personaKey={card.player.personaKey}
          persona={card.player.persona}
          name={card.player.name}
          size="16"
        />
        <div className="min-w-0 pt-1">
          <h2 className="truncate text-xl font-semibold text-white/95">{card.player.name}</h2>
          <CastStatusTags card={card} />
          <div className="mt-3 flex flex-wrap gap-2">
            <span className={`rounded px-2 py-1 text-[9px] uppercase tracking-[0.12em] ${statusClasses(card)}`}>
              {card.statusLabel}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function InspectorLabel({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active ? "true" : "false"}
      onClick={onClick}
      className={`grid place-items-center rounded-md text-[8px] uppercase tracking-[0.12em] ${
        active
          ? "border border-phase/20 bg-phase/[0.12] text-white/75"
          : "text-white/30 hover:bg-white/[0.03] hover:text-white/55"
      }`}
    >
      {children}
    </button>
  );
}

function InspectorSection({
  title,
  meta,
  section,
}: {
  title: string;
  meta?: string;
  section: MatchWatchIntelligenceSectionModel;
}) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/55">
          {title}
        </h3>
        {meta ? (
          <span className="truncate text-[7px] uppercase tracking-[0.12em] text-white/25">
            {meta}
          </span>
        ) : null}
      </div>
      {section.cards.length > 0 ? (
        <div className="space-y-3">
          {section.cards.map((card) => (
            <IntelligenceCard key={card.id} card={card} />
          ))}
        </div>
      ) : (
        <EmptyInspectorState reason={section.reason ?? "No intelligence available."} />
      )}
    </section>
  );
}

function IntelligenceCard({
  card,
}: {
  card: MatchWatchIntelligenceSectionModel["cards"][number];
}) {
  return (
    <div className="border-t border-white/5 pt-3 first:border-t-0 first:pt-0">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h4 className="truncate text-[10px] font-semibold text-white/80">{card.title}</h4>
        <span className="shrink-0 text-[7px] uppercase tracking-[0.12em] text-white/30">
          {card.meta}
        </span>
      </div>
      <p className="line-clamp-5 text-[10px] leading-5 text-white/65">{card.body}</p>
    </div>
  );
}

function EmptyInspectorState({ reason }: { reason: string }) {
  return (
    <p className="rounded-md border border-dashed border-white/10 px-3 py-4 text-[10px] leading-5 text-white/38">
      {reason}
    </p>
  );
}

interface DiaryArchiveEntry {
  id: string;
  playerName: string;
  round: number;
  phase: TranscriptEntry["phase"];
  timestamp: number;
  questionText?: string;
  answerText: string | null;
}

function InspectorDiary({ entries }: { entries: DiaryArchiveEntry[] }) {
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-[8px] font-semibold uppercase tracking-[0.16em] text-white/55">
          Diary
        </h3>
        <span className="truncate text-[7px] uppercase tracking-[0.12em] text-white/25">
          Newest first
        </span>
      </div>
      {entries.length > 0 ? (
        <div className="space-y-3">
          {entries.map((entry) => (
            <DiaryArchiveCard key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        <EmptyInspectorState reason="No diary entries yet." />
      )}
    </section>
  );
}

function DiaryArchiveCard({ entry }: { entry: DiaryArchiveEntry }) {
  return (
    <article className="border-t border-white/5 pt-3 first:border-t-0 first:pt-0">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="truncate text-[10px] font-semibold text-white/82">{entry.playerName}</h4>
          <p className="mt-0.5 truncate text-[7px] uppercase tracking-[0.12em] text-white/30">
            Round {entry.round} / {PHASE_LABELS[entry.phase]}
          </p>
        </div>
        <span className="shrink-0 text-[7px] uppercase tracking-[0.12em] text-white/28">
          {formatTime(entry.timestamp)}
        </span>
      </div>
      {entry.questionText ? (
        <p className="mb-2 rounded border border-purple-300/10 bg-purple-300/[0.04] px-2.5 py-2 text-[9px] italic leading-4 text-purple-100/50">
          {entry.questionText}
        </p>
      ) : null}
      {entry.answerText ? (
        <p className="line-clamp-6 text-[10px] leading-5 text-white/65">{entry.answerText}</p>
      ) : (
        <p className="text-[10px] italic leading-5 text-white/35">Awaiting response...</p>
      )}
    </article>
  );
}

export function buildDiaryArchiveEntries(messages: readonly TranscriptEntry[]): DiaryArchiveEntry[] {
  return groupMessages([...messages])
    .flatMap((item): DiaryArchiveEntry[] => {
      if (item.kind === "diary_pair") {
        const targetName = item.question.fromPlayerId
          ? diaryPlayerName(item.question.fromPlayerId)
          : item.answer?.fromPlayerName ?? "Unknown";
        return [{
          id: `diary-pair-${item.question.id}-${item.answer?.id ?? "pending"}`,
          playerName: targetName,
          round: item.answer?.round ?? item.question.round,
          phase: item.answer?.phase ?? item.question.phase,
          timestamp: item.answer?.timestamp ?? item.question.timestamp,
          questionText: item.question.text,
          answerText: item.answer?.text ?? null,
        }];
      }

      if (item.kind === "diary_orphan_answer") {
        const playerName =
          item.answer.fromPlayerName ??
          (item.answer.fromPlayerId ? diaryPlayerName(item.answer.fromPlayerId) : "Unknown");
        return [{
          id: `diary-entry-${item.answer.id}`,
          playerName,
          round: item.answer.round,
          phase: item.answer.phase,
          timestamp: item.answer.timestamp,
          answerText: item.answer.text,
        }];
      }

      return [];
    })
    .sort((left, right) => right.timestamp - left.timestamp || right.id.localeCompare(left.id));
}

export function buildReplayTranscriptSlice(
  messages: readonly TranscriptEntry[],
  visibleReplayMessages: readonly TranscriptEntry[] | null | undefined,
): TranscriptEntry[] {
  const cursor = visibleReplayMessages?.at(-1);
  if (!cursor) return [];

  const cursorIndex = messages.findIndex((message) => message.id === cursor.id);
  if (cursorIndex >= 0) {
    return messages.slice(0, cursorIndex + 1);
  }

  return messages.filter((message) => message.timestamp <= cursor.timestamp);
}

function sectionMeta(intelligence: MatchWatchIntelligenceModel): string | undefined {
  switch (intelligence.loadState) {
    case "loading":
      return "Loading";
    case "error":
      return "Unavailable";
    case "ready":
      return undefined;
    case "idle":
      return undefined;
  }
}

function ReplayDock({ model }: { model: MatchWatchModel }) {
  return (
    <footer className="relative mx-3 mb-3 hidden h-14 shrink-0 grid-cols-[18rem_minmax(0,1fr)_18rem] items-center gap-3 rounded-lg border border-white/10 bg-black/50 px-4 shadow-panel backdrop-blur-glass lg:grid">
      <div className="min-w-0">
        <div className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-white/70">
          {model.roundLabel} / {model.phaseLabel}
        </div>
      </div>

      <div className="grid h-2 min-w-0 grid-cols-8 gap-1">
        {model.phaseSegments.map((segment) => (
          <span
            key={segment.key}
            className={`rounded-full ${
              segment.state === "current"
                ? "bg-phase shadow-phase-sm"
                : segment.state === "past"
                  ? "bg-phase/[0.35]"
                  : "bg-white/10"
            }`}
          />
        ))}
      </div>

      <div className="justify-self-end rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-white/45">
        {model.mode}
      </div>
    </footer>
  );
}

function statusClasses(card: MatchWatchPlayerCard): string {
  if (card.player.status === "alive") {
    return "border border-emerald-400/20 bg-emerald-400/10 text-emerald-200";
  }
  if (card.player.status === "eliminated") {
    return "border border-rose-400/20 bg-rose-400/10 text-rose-200";
  }
  return "border border-white/10 bg-white/[0.03] text-white/40";
}

function isSamePlaybackState(
  current: MatchWatchPlaybackState | null,
  next: MatchWatchPlaybackState,
): boolean {
  if (!current) return false;
  const currentLastMessage = current.visibleMessages.at(-1);
  const nextLastMessage = next.visibleMessages.at(-1);
  return (
    current.round === next.round &&
    current.phase === next.phase &&
    current.visibleMessages.length === next.visibleMessages.length &&
    current.players.length === next.players.length &&
    currentLastMessage?.id === nextLastMessage?.id &&
    currentLastMessage?.text === nextLastMessage?.text &&
    current.players.every((player, index) => {
      const nextPlayer = next.players[index];
      return (
        nextPlayer &&
        player.id === nextPlayer.id &&
        player.status === nextPlayer.status &&
        player.shielded === nextPlayer.shielded &&
        player.pressureStatus === nextPlayer.pressureStatus &&
        player.exposeScore === nextPlayer.exposeScore
      );
    })
  );
}
