import type {
  GameDetail,
  TranscriptEntry,
  GameWatchReplayFrame,
  PublicWatchIntelligenceResult,
} from "../api";
import type { WerewolfWatchWindow } from "@influence/engine/werewolf/watch-contract";
import type { WerewolfThinking } from "@influence/engine/werewolf/thinking";
import type { WerewolfAudience } from "@influence/engine/werewolf";
import type { VisualWatchData } from "../../app/games/[slug]/components/visual-watch-model";
import type { ThinkingOrder } from "../../components/watch/thinking-timing";

export type InfluenceExportGame = Pick<
  GameDetail,
  "id" | "slug" | "status" | "players" | "gameKernel" | "formatManifest"
>;
export type ReplaySource =
  | {
      kind: "influence";
      game: InfluenceExportGame;
      messages: TranscriptEntry[];
      frames: GameWatchReplayFrame[];
      visual: VisualWatchData;
      thoughts: Record<string, string>;
    }
  | {
      kind: "werewolf";
      windows: WerewolfWatchWindow[];
      thoughts: WerewolfThinking["entries"];
    };
export interface SourceOptions {
  game: string;
  audience?: WerewolfAudience;
  thinking: boolean;
  thinkingOrder: ThinkingOrder;
}
export type ReadReplayJson = <T>(path: string) => Promise<T>;

/** Keep network/auth in the CLI; adapters consume only authorized viewer responses. */
export async function loadReplaySource(
  read: ReadReplayJson,
  options: SourceOptions,
): Promise<ReplaySource> {
  const entry = await read<{ id: string; slug: string; gameKind: string }>(
    `/api/game-entries/${encodeURIComponent(options.game)}`,
  );
  if (!entry || typeof entry.id !== "string" || typeof entry.slug !== "string")
    throw new Error("Invalid game entry");
  const id = encodeURIComponent(entry.id);
  if (entry.gameKind === "werewolf") {
    const audience = options.audience ?? "mystery";
    if (audience === "mystery" && options.thinking)
      throw new Error("Mystery exports cannot include thinking");
    const windows: WerewolfWatchWindow[] = [];
    let next = 1,
      latest = -1,
      cutoff = "";
    while (true) {
      const query = new URLSearchParams({
        audience,
        fromCursor: String(next),
        limit: "64",
      });
      if (cutoff) query.set("publishedBefore", cutoff);
      const window = await read<WerewolfWatchWindow>(
        `/api/werewolf/${id}/watch?${query}`,
      );
      if (
        !window ||
        window.gameId !== entry.id ||
        window.audience !== audience ||
        window.status !== "completed"
      )
        throw new Error(
          "Export requires a completed game with matching audience",
        );
      if (
        !Number.isSafeInteger(window.latestCursor) ||
        window.latestCursor < 1 ||
        window.fromCursor !== next ||
        !Number.isSafeInteger(window.throughCursor) ||
        window.throughCursor < next ||
        window.throughCursor > window.latestCursor ||
        !Array.isArray(window.moments)
      )
        throw new Error("Invalid Werewolf export window");
      if (
        latest !== -1 &&
        (window.latestCursor !== latest || window.publicationCutoff !== cutoff)
      )
        throw new Error("Replay snapshot changed while loading");
      latest = window.latestCursor;
      cutoff = window.publicationCutoff;
      if (!Number.isFinite(Date.parse(cutoff)))
        throw new Error("Missing publication cutoff");
      if (
        window.moments.length !== window.throughCursor - next + 1 ||
        window.moments.some(
          (m, index) =>
            m.cursor !== next + index ||
            m.snapshot.gameId !== entry.id ||
            m.snapshot.audience !== audience,
        )
      )
        throw new Error("Werewolf export history has a gap");
      if (audience === "mystery") assertMysteryWindow(window);
      windows.push(window);
      next = window.throughCursor + 1;
      if (next > latest) break;
    }
    if (!windows.at(-1)?.moments.some((m) => m.entry.kind === "result"))
      throw new Error("Completed Werewolf replay has no terminal result");
    const thoughts = options.thinking
      ? await read<WerewolfThinking>(
          `/api/werewolf/${id}/thinking?audience=omniscient&cursor=${latest}`,
        )
      : null;
    if (
      thoughts &&
      (thoughts.cursor !== latest ||
        !Array.isArray(thoughts.entries) ||
        thoughts.entries.some(
          (t) =>
            !Number.isSafeInteger(t.cursor) ||
            t.cursor > latest ||
            typeof t.thinking !== "string",
        ))
    )
      throw new Error("Invalid thinking snapshot");
    return { kind: "werewolf", windows, thoughts: thoughts?.entries ?? [] };
  }
  if (entry.gameKind !== "influence")
    throw new Error(`Unsupported game kind: ${entry.gameKind}`);
  if (options.audience)
    throw new Error(
      "Influence uses its existing spectator view; --audience applies only to Werewolf",
    );
  const detail = await read<GameDetail>(`/api/games/${id}`);
  if (
    detail.id !== entry.id ||
    detail.status !== "completed" ||
    !Array.isArray(detail.players)
  )
    throw new Error("Export requires a completed Influence game");
  const messages: TranscriptEntry[] = [],
    frames: GameWatchReplayFrame[] = [];
  const ids = new Set<number>();
  for (let offset = 0; ; offset += 256) {
    const page = await read<TranscriptEntry[]>(
      `/api/games/${id}/transcript?offset=${offset}&limit=256`,
    );
    if (!Array.isArray(page) || page.length > 256)
      throw new Error("Invalid transcript page");
    for (const message of page) {
      if (
        !Number.isSafeInteger(message.id) ||
        ids.has(message.id) ||
        typeof message.text !== "string"
      )
        throw new Error("Invalid or repeated transcript entry");
      ids.add(message.id);
      if (message.scope === "thinking") continue;
      // A disabled thought must not travel in the local bundle merely because the API includes it.
      messages.push({
        ...message,
        thinking: options.thinking ? message.thinking : undefined,
      });
    }
    if (page.length < 256) break;
  }
  let after = 0;
  while (true) {
    const page = await read<GameWatchReplayFrame[]>(
      `/api/games/${id}/replay-watch-frames?afterSequence=${after}&limit=256`,
    );
    if (!Array.isArray(page) || page.length > 256)
      throw new Error("Invalid replay frame page");
    for (const frame of page) {
      if (
        frame.gameId !== entry.id ||
        !Number.isSafeInteger(frame.sequence) ||
        frame.sequence !== after + 1 ||
        !Array.isArray(frame.players)
      )
        throw new Error("Invalid or unordered replay frame");
      after = frame.sequence;
      frames.push(frame);
    }
    if (page.length < 256) break;
  }
  const endDetail = await read<GameDetail>(`/api/games/${id}`);
  if (
    endDetail.status !== "completed" ||
    endDetail.id !== detail.id ||
    endDetail.completedAt !== detail.completedAt ||
    endDetail.watchState?.eventCursor.sequence !==
      detail.watchState?.eventCursor.sequence
  )
    throw new Error("Influence source changed while loading");
  if (
    detail.watchState?.eventCursor.sequence !== undefined &&
    detail.watchState.eventCursor.sequence !== after
  )
    throw new Error("Influence canonical history is incomplete");
  if (detail.watchState?.projection.eventLogStatus === "invalid")
    throw new Error("Influence event history is invalid");
  if (!messages.length && !frames.length)
    throw new Error("Game has no replay content");
  const visual = await read<VisualWatchData>(`/api/games/${id}/visual`);
  if (!visual || !Array.isArray(visual.scenes) || !visual.publicationSnapshot)
    throw new Error("Invalid visual publication snapshot");
  // One immutable source bundle, not repeated media selection while rendering.
  const game: InfluenceExportGame = {
    id: detail.id,
    slug: detail.slug,
    status: detail.status,
    players: detail.players,
    gameKernel: detail.gameKernel,
    formatManifest: detail.formatManifest,
  };
  return { kind: "influence", game, messages, frames, visual, thoughts: {} };
}

/** Defense in depth on the serialized boundary; terminal public cast roles remain allowed. */
function assertMysteryWindow(window: WerewolfWatchWindow) {
  assertNoPrivateFields(window);
  for (const moment of window.moments) {
    if (
      moment.night ||
      (moment.wolfForms && Object.keys(moment.wolfForms).length) ||
      moment.transformWolfIds?.length ||
      moment.entry.kind === "pack_vote" ||
      (moment.entry.kind === "speech" && moment.entry.audience === "pack") ||
      (moment.entry.kind === "night" &&
        (moment.entry.attackTargetId !== undefined ||
          moment.entry.protectedId !== undefined ||
          moment.entry.investigation !== undefined)) ||
      (!moment.snapshot.outcome &&
        moment.snapshot.players.some((p) => p.role !== undefined))
    )
      throw new Error("Mystery export contains private night or role evidence");
  }
}

export async function loadInfluenceThought(
  read: ReadReplayJson,
  slug: string,
  input: {
    actorId: string;
    round: number;
    phase: string;
    sequence: number;
    transcriptSequence?: number;
    messageId?: string;
  },
) {
  const query = new URLSearchParams({
    actorPlayerId: input.actorId,
    round: String(input.round),
    phase: input.phase,
    throughEventSequence: String(input.sequence),
    throughTranscriptSequence: String(input.transcriptSequence ?? 0),
    limit: "4",
  });
  const result = await read<PublicWatchIntelligenceResult>(
    `/api/games/${encodeURIComponent(slug)}/watch-intelligence?${query}`,
  );
  if (!result.ok) throw new Error("Thinking evidence could not be loaded");
  return result.intelligence.thinking.cards
    .filter(
      (card) =>
        card.actorPlayerId === input.actorId &&
        (input.messageId
          ? card.id === `transcript:${input.messageId}`
          : card.eventSequence === input.sequence),
    )
    .map((card) => card.text)
    .join("\n\n");
}

export function assertNoPrivateFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (
      [
        "staging",
        "thinking",
        "reasoningContext",
        "strategy",
        "strategies",
      ].includes(key) &&
      child !== undefined
    )
      throw new Error("Mystery export contains private internal evidence");
    assertNoPrivateFields(child);
  }
}
