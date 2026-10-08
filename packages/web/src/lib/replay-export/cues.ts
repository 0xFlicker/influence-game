import {
  werewolfCues,
  werewolfWatchPolicy,
  type WerewolfWatchCue,
} from "../../components/games/werewolf/werewolf-watch-model";
import { replayMoment } from "../../components/games/werewolf/replay-moment";
import { werewolfMusic } from "../../components/games/werewolf/werewolf-music";
import {
  buildClassicPresentationCues,
  mergeFormatAndSocialCues,
  comparePresentationCues,
} from "../../app/games/[slug]/components/influence-replay-cues";
import {
  buildStoryScenes,
  withHouseBridges,
} from "../../app/games/[slug]/components/house-story";
import {
  buildEndgamePresentationCues,
  revealedWinnerCue,
} from "../../app/games/[slug]/components/endgame-presentation";
import {
  compileFormatPresentationPrefix,
  formatPresentationDecisionsFromFrames,
  formatPresentationEligibilityFromFrames,
} from "../../app/games/[slug]/components/format-presentation-model";
import {
  paceVisualBallots,
  visualWatchPresentation,
} from "../../app/games/[slug]/components/visual-watch-model";
import { influencePresentationPolicy } from "../../app/games/[slug]/components/influence-presentation-director";
import {
  voteLedgerForCue,
  type VoteLedgerState,
} from "../../app/games/[slug]/components/vote-ledger-model";
import type { VisualPresentationBeat } from "../../app/games/[slug]/components/visual-presentation";
import type {
  FormatPresentationRosterPlayer,
  PresentationCue,
} from "../../app/games/[slug]/components/types";
import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import type { MusicSection } from "../../components/watch/watch-music";
import type { ReplaySource, ReadReplayJson } from "./source";
import { loadInfluenceThought } from "./source";
import type { TimingInput } from "./timing";
import type { ThinkingOrder } from "../../components/watch/thinking-timing";

export type ExportPicture =
  | {
      kind: "werewolf";
      cue: WerewolfWatchCue;
      scene: AcceptedVisualScene | null;
    }
  | {
      kind: "influence";
      cue: PresentationCue;
      beat: VisualPresentationBeat | null;
      rooms: AcceptedVisualScene[];
      roster: FormatPresentationRosterPlayer[];
      ledger: VoteLedgerState | null;
    };
export interface ExportCue {
  timing: TimingInput;
  picture: ExportPicture;
  label: string;
  source:
    | { kind: "werewolf"; cursor: number }
    | {
        kind: "influence";
        eventSequence: number | null;
        transcriptSequence?: number;
      };
  speech: {
    messageId: string;
    speakerId: string | null;
    speaker: string;
    text: string;
  } | null;
  music: MusicSection | null;
  alignment?: import("./speech").SpeechAlignment[];
}

export async function buildExportCues(
  source: ReplaySource,
  order: ThinkingOrder,
  thinking: boolean,
  read?: ReadReplayJson,
): Promise<ExportCue[]> {
  if (source.kind === "werewolf") {
    const media = Object.assign(
      {},
      ...source.windows.map((w) => w.media),
    ) as Record<string, AcceptedVisualScene>;
    return werewolfCues(source.windows).map((cue) => {
      const line = replayMoment({
        ...cue.moment.snapshot,
        entries: [cue.moment.entry],
      });
      const spoken = line.spoken && !cue.ballot && !cue.nightAction;
      const thought =
        thinking && spoken && line.actor
          ? source.thoughts
              .filter(
                (t) =>
                  t.cursor === cue.moment.cursor &&
                  t.actorId === line.actor!.id,
              )
              .map((t) => t.thinking)
              .join("\n\n") || null
          : null;
      return {
        timing: {
          key: cue.key,
          baseDurationMs: cue.baseDurationMs,
          kind: cue.ballot
            ? cue.ballot.complete
              ? "tally"
              : "ballot"
            : spoken
              ? "speech"
              : cue.moment.entry.kind === "result"
                ? "result"
                : "scene",
          speech: werewolfWatchPolicy.speech(cue),
          thinking: thought,
          order,
        },
        picture: {
          kind: "werewolf",
          cue,
          scene: cue.moment.mediaKey
            ? (media[cue.moment.mediaKey] ?? null)
            : null,
        },
        source: { kind: "werewolf", cursor: cue.moment.cursor },
        label: line.title,
        speech: spoken
          ? {
              messageId: `${cue.moment.snapshot.gameId}:${cue.moment.snapshot.audience}:${cue.moment.cursor}`,
              speakerId: line.actor?.id ?? null,
              speaker: line.speaker,
              text: line.text,
            }
          : null,
        music: werewolfMusic(cue.moment),
      };
    });
  }
  const { game, messages, frames, visual } = source;
  const scenes = buildStoryScenes(messages);
  const classic = buildClassicPresentationCues(scenes, frames, game.players);
  const roster = game.players.map((player) => ({
    id: player.id,
    name: player.name,
    persona: player.persona,
    personaKey: player.personaKey,
    avatarUrl: visual.portraits[player.id] ?? player.avatarUrl,
  }));
  const compilation = compileFormatPresentationPrefix({
    gameId: game.id,
    gameKernel: game.gameKernel ?? "classic",
    formatManifest: game.formatManifest,
    roster,
    decisions: formatPresentationDecisionsFromFrames(frames),
    eligiblePlayerIdsByRound: formatPresentationEligibilityFromFrames(frames),
  });
  if (game.gameKernel === "format" && compilation.diagnostic)
    throw new Error(
      `Incomplete format presentation: ${JSON.stringify(compilation.diagnostic)}`,
    );
  const cues = withHouseBridges(
    paceVisualBallots(
      [
        ...(game.gameKernel === "format"
          ? mergeFormatAndSocialCues(compilation.cues, classic, scenes)
          : classic),
        ...buildEndgamePresentationCues(frames),
      ].sort(comparePresentationCues),
      game.players,
    ),
    scenes,
  );
  const result: ExportCue[] = [];
  for (const [index, cue] of cues.entries()) {
    const message =
      cue.source === "classic"
        ? (scenes[cue.sceneIndex]?.messages[cue.messageIndex] ?? null)
        : null;
    const prior =
      cue.source === "format"
        ? classic
            .filter(
              (c) =>
                c.round === cue.round &&
                c.phase === "LOBBY" &&
                c.canonicalSequence !== null &&
                c.canonicalSequence <= cue.canonicalSequence,
            )
            .map((c) => scenes[c.sceneIndex]!.messages[c.messageIndex]!)
        : [];
    const state = frames.findLast(
      (frame) =>
        cue.canonicalSequence !== null &&
        frame.sequence <= cue.canonicalSequence,
    );
    const activePlayers = game.players.map((player) => ({
      ...player,
      status: state?.players.find((p) => p.id === player.id)?.status ?? "alive",
      shielded:
        state?.players.find((p) => p.id === player.id)?.shielded ?? false,
    }));
    const picture = visualWatchPresentation(
      visual,
      revealedWinnerCue(cues, index) ?? cue,
      message,
      activePlayers,
      prior,
    );
    const spoken =
      picture.beat && "speech" in picture.beat ? picture.beat.speech : null;
    const ledger = voteLedgerForCue(cues, index);
    const actorId = spoken?.playerId;
    let thought = thinking
      ? (source.thoughts[cue.key] ?? message?.thinking ?? null)
      : null;
    if (
      thinking &&
      !thought &&
      actorId &&
      cue.canonicalSequence !== null &&
      read
    ) {
      thought = await loadInfluenceThought(read, game.slug, {
        actorId,
        round: cue.round,
        phase: cue.phase,
        sequence: cue.canonicalSequence,
        transcriptSequence: message?.entrySequence,
        messageId: message ? String(message.id) : undefined,
      });
      if (thought) source.thoughts[cue.key] = thought;
    }
    result.push({
      timing: {
        key: cue.key,
        baseDurationMs: cue.baseDurationMs,
        kind: ledger
          ? ledger.complete
            ? "tally"
            : "ballot"
          : spoken
            ? "speech"
            : cue.kind === "endgame_winner"
              ? "result"
              : "scene",
        speech: influencePresentationPolicy.speech(cue),
        thinking: actorId ? thought : null,
        order,
      },
      picture: { kind: "influence", cue, ...picture, roster, ledger },
      source: {
        kind: "influence",
        eventSequence: cue.canonicalSequence,
        ...(message?.entrySequence !== undefined && {
          transcriptSequence: message.entrySequence,
        }),
      },
      label: `Round ${cue.round} · ${cue.phase}`,
      speech:
        spoken && !ledger
          ? {
              messageId: message ? String(message.id) : cue.key,
              speakerId: spoken.playerId,
              speaker: spoken.speaker,
              text: spoken.text,
            }
          : null,
      music: null,
    });
  }
  if (!result.length) throw new Error("Game has no playable cues");
  return result;
}
