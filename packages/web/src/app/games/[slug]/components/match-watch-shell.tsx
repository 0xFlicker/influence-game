"use client";

import { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { WatchInspector, InspectorSection, EmptyInspectorState } from "@/components/watch/watch-inspector";
import { CastRail, MobileContextPanel } from "@/components/watch/watch-cast";
import { WatchShell, ShellHeader } from "@/components/watch/watch-shell";
import { GamePlayerAvatarPreview } from "@/components/game-player-avatar-preview";
import { completedGameModeHref } from "@/lib/game-links";
import { playerProfileHref } from "@/lib/player-profile-links";
import {
  getGameAlliances,
  getPublicWatchIntelligence,
  type GameDetail,
  type GameWatchReplayFrame,
  type PublicGameAlliancesResponse,
  type PublicWatchIntelligenceResult,
  type TranscriptEntry,
} from "@/lib/api";
import { formatTime, PHASE_LABELS, setEndgameAttr, setPhaseAttr } from "./constants";
import { DramaticReplayViewer } from "./dramatic-replay-viewer";
import { diaryPlayerName, groupMessages } from "./diary-room";
import {
  buildMatchWatchIntelligenceModel,
  type MatchWatchIntelligenceModel,
} from "./match-watch-intelligence-model";
import {
  buildMatchWatchAlliancePanelModel,
  type AllianceFactsLoadState,
} from "./match-watch-alliance-model";
import { MatchWatchAlliancePanel } from "./match-watch-alliance-panel";
import {
  applyStructuredPostVotePressureSummaries,
  buildMatchWatchModel,
  type MatchWatchModel,
  type MatchWatchPlayerCard,
  type MatchWatchPlayerStatusTag,
  type MatchWatchPlaybackState,
  type PresentationHydrationState,
} from "./match-watch-model";
import type { WatchConnStatus } from "./types";

export function MatchWatchShell({
  game,
  messages,
  replayFrames = [],
  live = false,
  connStatus,
  presentationHydrationStatus,
  startSequence,
}: {
  game: GameDetail;
  messages: TranscriptEntry[];
  replayFrames?: GameWatchReplayFrame[];
  live?: boolean;
  connStatus?: WatchConnStatus;
  presentationHydrationStatus?: PresentationHydrationState["status"];
  startSequence?: number;
}) {
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<MatchWatchPlaybackState | null>(null);
  const [intelligence, setIntelligence] = useState<PublicWatchIntelligenceResult | null>(null);
  const [intelligenceLoadState, setIntelligenceLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [allianceFacts, setAllianceFacts] = useState<PublicGameAlliancesResponse | null>(null);
  const [allianceLoadState, setAllianceLoadState] = useState<AllianceFactsLoadState>("idle");
  const [allianceError, setAllianceError] = useState<string | null>(null);
  const displayMessages = useMemo(
    () =>
      applyStructuredPostVotePressureSummaries({
        messages,
        replayFrames,
        watchState: game.watchState,
      }),
    [game.watchState, messages, replayFrames],
  );
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
        messages: displayMessages,
        live,
        connStatus,
        selectedPlayerId,
        playbackState,
        replayFrames,
      }),
    [game, displayMessages, live, connStatus, selectedPlayerId, playbackState, replayFrames],
  );
  const visibleMessages = useMemo(() => playbackState?.visibleMessages ?? [], [playbackState?.visibleMessages]);
  const throughEventSequence = Math.min(playbackState?.canonicalSequence ?? 0, playbackState?.formatSnapshot?.canonicalSequence ?? Infinity);
  const throughTranscriptSequence = Math.max(0, ...visibleMessages.map(message => message.entrySequence ?? 0));
  const evidenceKey = `${game.id}:${model.selectedPlayerId}:${throughEventSequence}:${throughTranscriptSequence}`;
  const [intelligenceKey, setIntelligenceKey] = useState("");
  const [allianceKey, setAllianceKey] = useState("");
  const inspectorMessages = useMemo(
    () => buildReplayTranscriptSlice(displayMessages, playbackState?.visibleMessages),
    [displayMessages, playbackState?.visibleMessages],
  );
  const intelligenceModel = useMemo(
    () =>
      buildMatchWatchIntelligenceModel({
        model,
        intelligence: intelligenceKey === evidenceKey ? intelligence : null,
        visibleMessages,
        loadState: intelligenceLoadState,
        error: intelligenceError,
      }),
    [model, intelligence, intelligenceKey, evidenceKey, visibleMessages, intelligenceLoadState, intelligenceError],
  );
  const allianceModel = useMemo(
    () =>
      buildMatchWatchAlliancePanelModel({
        model,
        allianceState: {
          loadState: allianceLoadState,
          facts: allianceKey === evidenceKey ? allianceFacts : null,
          error: allianceError,
        },
      }),
    [model, allianceFacts, allianceKey, evidenceKey, allianceLoadState, allianceError],
  );
  const replayAtFinalResults = !live && Boolean(playbackState) && isReplayAtFinalResults(messages, playbackState?.visibleMessages);
  const gamePath = game.slug;

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
    void getPublicWatchIntelligence(game.slug, {
      actorPlayerId: model.selectedPlayerId,
      round: model.round,
      phase: model.phase,
      limit: 4,
      throughEventSequence,
      throughTranscriptSequence,
    })
      .then((result) => {
        if (cancelled) return;
        setIntelligenceKey(evidenceKey);
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
  }, [game.id, game.slug, model.selectedPlayerId, model.round, model.phase, throughEventSequence, throughTranscriptSequence, evidenceKey]);

  useEffect(() => {
    let cancelled = false;
    startTransition(() => {
      setAllianceLoadState("loading");
      setAllianceError(null);
    });
    void getGameAlliances(game.slug, {throughEventSequence, throughTranscriptSequence})
      .then((result) => {
        if (cancelled) return;
        setAllianceKey(evidenceKey);
        setAllianceFacts(result);
        setAllianceLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setAllianceFacts(null);
        setAllianceLoadState("error");
        setAllianceError("Alliance facts are not available for this game.");
      });

    return () => {
      cancelled = true;
    };
  }, [game.id, game.slug, throughEventSequence, throughTranscriptSequence, evidenceKey]);

  const castModel = { ...model, players: model.players.map(card => ({
    id: card.player.id, name: card.player.name, isSelected: card.isSelected, statusLabel: card.statusLabel, statusClass: statusClasses(card),
    portrait: <GamePlayerAvatarPreview player={card.player} size="8" />, smallPortrait: <GamePlayerAvatarPreview player={card.player} size="6" />,
    tags: <CastStatusTags card={card} />, owner: <AgentOwnerLink card={card} />,
  })) };
  return <WatchShell mode={model.mode}
    header={<ShellHeader model={model} gamePath={gamePath} showResultsCta={replayAtFinalResults} />}
    cast={<CastRail model={castModel} onSelectPlayer={setSelectedPlayerId} />}
    mobileCast={<MobileContextPanel model={castModel} onSelectPlayer={setSelectedPlayerId} />}
    theater={<TheaterPanel game={game} messages={displayMessages} replayFrames={replayFrames} live={live} connStatus={connStatus} presentationHydrationStatus={presentationHydrationStatus} startSequence={live ? undefined : startSequence} model={model} onPlaybackStateChange={handlePlaybackStateChange} />}
    inspector={<InspectorPanel model={model} intelligence={intelligenceModel} allianceModel={allianceModel} messages={inspectorMessages} />}
    footer={<ReplayDock model={model} gamePath={gamePath} showResultsCta={replayAtFinalResults} />}
  />;
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
    case "nominee":
    case "vulnerable":
      return "border-rose-300/25 bg-rose-400/10 text-rose-200";
    case "override":
      return "border-violet-300/25 bg-violet-400/10 text-violet-200";
    case "safe":
      return "border-emerald-300/25 bg-emerald-400/10 text-emerald-200";
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
  replayFrames,
  live,
  connStatus,
  presentationHydrationStatus,
  startSequence,
  model,
  onPlaybackStateChange,
}: {
  game: GameDetail;
  messages: TranscriptEntry[];
  replayFrames: GameWatchReplayFrame[];
  live: boolean;
  connStatus?: WatchConnStatus;
  presentationHydrationStatus?: PresentationHydrationState["status"];
  startSequence?: number;
  model: MatchWatchModel;
  onPlaybackStateChange: (state: MatchWatchPlaybackState) => void;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-white/10 bg-black/45 shadow-panel backdrop-blur-glass lg:rounded-lg">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-white/10 px-2.5 lg:grid lg:h-auto lg:min-h-14 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-2 lg:px-4 lg:py-3">
        <div className="min-w-0">
          <div className="hidden text-[9px] uppercase tracking-[0.18em] text-white/40 lg:block">
            {model.roundLabel} / {model.phaseFeedLabel}
          </div>
          <h1 className="truncate text-sm font-semibold text-white/95 lg:mt-1 lg:text-base">
            {model.phaseLabel}
          </h1>
        </div>
        <div className="hidden flex-wrap gap-2 lg:flex">
          <TheaterChip>{model.counts.totalPlayers} agents</TheaterChip>
          <TheaterChip>{model.connectionLabel}</TheaterChip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <DramaticReplayViewer
          game={game}
          messages={messages}
          players={game.players}
          replayFrames={replayFrames}
          live={live}
          connStatus={connStatus}
          presentationHydrationStatus={presentationHydrationStatus}
          startSequence={startSequence}
          embedded
          onPlaybackStateChange={onPlaybackStateChange}
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


function InspectorPanel({
  model,
  intelligence,
  allianceModel,
  messages,
}: {
  model: MatchWatchModel;
  intelligence: MatchWatchIntelligenceModel;
  allianceModel: ReturnType<typeof buildMatchWatchAlliancePanelModel>;
  messages: TranscriptEntry[];
}) {
  const selected = model.selectedPlayer;
  const diaryEntries = useMemo(() => buildDiaryArchiveEntries(messages), [messages]);
  return <div className="hidden min-h-0 xl:block"><WatchInspector hero={selected ? <InspectorHero card={selected} /> : null} sections={[
    {id:"overview",label:"Overview",content:<InspectorSection title="Audience Lens" section={intelligence.overview} />},
    {id:"thinking",label:"Thinking",content:<InspectorSection title="Thinking" meta={sectionMeta(intelligence)} section={intelligence.thinking} expandableCards />},
    {id:"strategy",label:"Strategy",content:<InspectorSection title="Strategy" meta={sectionMeta(intelligence)} section={intelligence.strategy} />},
    {id:"alliance",label:"Alliance",content:<MatchWatchAlliancePanel allianceModel={allianceModel} players={model.players.map(card => card.player)} />},
    {id:"diary",label:"Diary",content:<InspectorDiary entries={diaryEntries} />},
  ]} /></div>;
}

function InspectorHero({ card }: { card: MatchWatchPlayerCard }) {
  return (
    <div className="relative shrink-0 overflow-hidden border-b border-white/10 px-4 py-4">
      <div className="absolute right-0 top-0 h-28 w-28 rounded-full bg-phase/10 blur-3xl" />
      <div className="relative flex items-start gap-3">
        <GamePlayerAvatarPreview player={card.player} size="16" />
        <div className="min-w-0 pt-1">
          <h2 className="truncate text-xl font-semibold text-white/95">{card.player.name}</h2>
          <CastStatusTags card={card} />
          <AgentOwnerLink card={card} />
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

export function AgentOwnerLink({
  card,
  compact = false,
}: {
  card: MatchWatchPlayerCard;
  compact?: boolean;
}) {
  const owner = card.player.currentAgent?.owner;
  if (!owner) return null;

  return (
    <Link
      href={playerProfileHref(owner)}
      aria-label={`View ${owner.displayName}'s public profile`}
      className={`mt-1 inline-flex max-w-full truncate rounded px-1 text-[8px] uppercase tracking-[0.1em] text-cyan-100/48 underline decoration-cyan-200/20 underline-offset-2 transition-colors hover:text-cyan-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-cyan-200/70 ${compact ? "max-w-20" : ""}`}
    >
      Owner: {owner.displayName}
    </Link>
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

  const sequence = cursor.entrySequence;
  if (sequence === undefined || sequence === null) return [];
  return messages.filter((message) => message.entrySequence != null && message.entrySequence <= sequence);
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

function ReplayDock({
  model,
  gamePath,
  showResultsCta,
}: {
  model: MatchWatchModel;
  gamePath: string;
  showResultsCta: boolean;
}) {
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

      {showResultsCta ? (
        <Link
          href={completedGameModeHref(gamePath, "results")}
          className="justify-self-end rounded-md border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-cyan-100/75 transition-colors hover:bg-cyan-400/15 hover:text-cyan-50"
        >
          Full Results
        </Link>
      ) : (
        <div className="justify-self-end rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-[9px] uppercase tracking-[0.14em] text-white/45">
          {model.mode}
        </div>
      )}
    </footer>
  );
}

export function isReplayAtFinalResults(
  messages: readonly TranscriptEntry[],
  visibleMessages: readonly TranscriptEntry[] | null | undefined,
): boolean {
  if (messages.length === 0 || !visibleMessages || visibleMessages.length === 0) return false;
  const lastVisible = visibleMessages.at(-1);
  return lastVisible?.phase === "END" || visibleMessages.length >= messages.length;
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
    current.canonicalSequence === next.canonicalSequence &&
    current.formatSnapshot === next.formatSnapshot &&
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
