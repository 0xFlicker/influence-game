import {werewolfOpening, type WerewolfOpeningCue} from "../../components/games/werewolf/werewolf-opening";
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
  compileReplayFrameLookup,
} from "../../app/games/[slug]/components/influence-replay-cues";
import {
  buildStoryScenes,
} from "../../app/games/[slug]/components/house-story";
import {
  buildEndgamePresentationCues,
  compileRevealedWinnerCues,
} from "../../app/games/[slug]/components/endgame-presentation";
import {
  compileFormatPresentationPrefix,
  formatPresentationDecisionsFromFrames,
  formatPresentationEligibilityFromFrames,
} from "../../app/games/[slug]/components/format-presentation-model";
import {
  visualWatchPresentation,
} from "../../app/games/[slug]/components/visual-watch-model";
import { influencePresentationPolicy } from "../../app/games/[slug]/components/influence-presentation-director";
import {
  compileVoteLedgers,
  type VoteLedgerState,
} from "../../app/games/[slug]/components/vote-ledger-model";
import type { VisualPresentationBeat } from "../../app/games/[slug]/components/visual-presentation";
import type {
  FormatPresentationRosterPlayer,
  PresentationCue,
} from "../../app/games/[slug]/components/types";
import type { AcceptedVisualScene } from "@influence/engine/visual-mode";
import type { MusicSection } from "../../components/watch/watch-music";
import { compileSafetyBounceLobbyLookup } from "../../app/games/[slug]/components/safety-bounce-scene-model";
import type { ReplaySource } from "./source";
import type { TimingInput } from "./timing";
import {composeInfluencePresentation, influenceCastArt} from "../../app/games/[slug]/components/influence-presentation";
import {influenceMusic} from "../../app/games/[slug]/components/influence-music";
import type {InfluenceOpeningCue} from "../../app/games/[slug]/components/types";

export type ExportPicture =
  | {
      kind: "thinking";
      gameKind: "influence" | "werewolf";
      actor: Extract<VisualPresentationBeat, {kind: "portrait"}>["player"];
      roleLabel?: string;
      scene: AcceptedVisualScene | null;
      sourceElapsedMs: number;
      room?: {number: number | null; players: Extract<VisualPresentationBeat, {kind:"portrait-room"}>["participants"]};
    }
  | {kind: "werewolf-opening"; cue: WerewolfOpeningCue}
  | ({kind: "influence-opening"; cue: InfluenceOpeningCue} & ReturnType<typeof influenceCastArt>)
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
      roster: (FormatPresentationRosterPlayer & {fullBodyReferenceUrl?:string;headRectangle?:import("@influence/engine/character-portrait").HeadRectangle})[];
      ledger: VoteLedgerState | null;
    };
export interface ExportCue {
  /** Stable editorial identity; multiple authored shots may belong to one moment. */
  momentId?: string;
  timing: TimingInput;
  picture: ExportPicture;
  label: string;
  source:
    | {kind: "opening"}
    | { kind: "werewolf"; cursor: number }
    | {
        kind: "influence";
        eventSequence: number | null;
        transcriptId?: number;
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

export function buildExportCues(source: ReplaySource): ExportCue[] {
  if (source.kind === "werewolf") {
    const media = Object.assign(
      {},
      ...source.windows.map((w) => w.media),
    ) as Record<string, AcceptedVisualScene>;
    const opening: ExportCue[] = source.windows[0] ? werewolfOpening(source.windows[0], source.title).map(cue => ({
      timing:{key:cue.key, baseDurationMs:cue.baseDurationMs, kind:"opening", speech:null, thinking:null},
      picture:{kind:"werewolf-opening",cue}, source:{kind:"opening"}, label:"Opening", speech:null, music:null,
    })) : [];
    return [...opening, ...werewolfCues(source.windows).map((cue): ExportCue => {
      const line = replayMoment({
        ...cue.moment.snapshot,
        entries: [cue.moment.entry],
      });
      const spoken = line.spoken && (!cue.ballot || cue.moment.entry.kind === "ballot") && !cue.nightAction;
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
          thinking: null,
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
    })];
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
    fullBodyReferenceUrl:visual.fullBodies?.[player.id],
    headRectangle:visual.fullBodyHeads?.[player.id],
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
  const cues = composeInfluencePresentation(game.id,
      [
        ...(game.gameKernel === "format"
          ? mergeFormatAndSocialCues(compilation.cues, classic, scenes)
          : classic),
        ...buildEndgamePresentationCues(frames),
      ].sort(comparePresentationCues),
      game.players,
    scenes,
  );
  const frameForSequence = compileReplayFrameLookup(frames);
  const lobbyMessages = compileSafetyBounceLobbyLookup(classic, scenes);
  const winners = compileRevealedWinnerCues(cues);
  const ledgers = compileVoteLedgers(cues);
  const result: ExportCue[] = [];
  for (const [index, cue] of cues.entries()) {
    if (cue.source === "opening") {
      result.push({timing: {key:cue.key, baseDurationMs:cue.baseDurationMs, kind:"opening", speech:null, thinking:null},
        picture: {kind:"influence-opening", cue, ...influenceCastArt(game.players.find(player => player.id === cue.opening.player?.id), visual)},
        source:{kind:"opening"}, label:"Opening", speech:null, music:null});
      continue;
    }
    const message =
      cue.source === "classic"
        ? (scenes[cue.sceneIndex]?.messages[cue.messageIndex] ?? null)
        : null;
    const prior =
      cue.source === "format"
        ? lobbyMessages(cue.round, cue.canonicalSequence)
        : [];
    const state = frameForSequence(cue.canonicalSequence);
    const playersById = new Map(state?.players.map(player => [player.id, player]));
    const activePlayers = game.players.map((player) => ({
      ...player,
      status: playersById.get(player.id)?.status ?? "alive",
      shielded: playersById.get(player.id)?.shielded ?? false,
    }));
    const picture = visualWatchPresentation(
      visual,
      winners[index] ?? cue,
      message,
      activePlayers,
      prior,
      frames,
    );
    const spoken =
      picture.beat && "speech" in picture.beat ? picture.beat.speech : null;
    const ledger = ledgers[index] ?? null;
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
            : (winners[index] ?? cue).kind === "endgame_winner"
              ? "result"
              : "scene",
        speech: influencePresentationPolicy.speech(cue),
        thinking: null,
      },
      picture: { kind: "influence", cue, ...picture,
        rooms:picture.beat?.kind === "scene" ? picture.rooms.filter(room => picture.beat?.kind === "scene" && room.id === picture.beat.sceneId) : [],
        roster, ledger },
      source: {
        kind: "influence",
        eventSequence: cue.canonicalSequence,
        ...(message && {transcriptId: message.id}),
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
      music: influenceMusic(game.id, winners[index] ?? cue, message),
    });
  }
  return result;
}
