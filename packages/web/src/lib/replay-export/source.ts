import type {
  GameDetail,
  TranscriptEntry,
  GameWatchReplayFrame,
} from "../api";
import type { WerewolfWatchWindow } from "@influence/engine/werewolf/watch-contract";
import type { WerewolfThinking } from "@influence/engine/werewolf/thinking";
import type { VisualWatchData } from "../../app/games/[slug]/components/visual-watch-model";

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
      title?: string;
      windows: WerewolfWatchWindow[];
      thoughts: WerewolfThinking["entries"];
    };
export type ReadReplayJson = <T>(path: string) => Promise<T>;

/** Defense in depth on the serialized boundary; terminal public cast roles remain allowed. */
export function assertMysteryWindow(window: WerewolfWatchWindow) {
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
