import type { TranscriptEntry } from "../game-runner";
import { DEFAULT_CONFIG, Phase, type GameConfig } from "../types";

export const TEST_GAME_CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  timers: {
    introduction: 0,
    lobby: 0,
    mingle: 0,
    rumor: 0,
    vote: 0,
    power: 0,
    council: 0,
  },
  maxRounds: 6,
  maxDiaryFollowUps: 0,
  diaryRoomAfterPhases: [Phase.INTRODUCTION, Phase.LOBBY, Phase.VOTE],
};

export function printTranscript(transcript: readonly TranscriptEntry[]): void {
  let lastPhase = "";
  for (const entry of transcript) {
    const header = `R${entry.round}/${entry.phase}`;
    if (header !== lastPhase) {
      console.log(`\n--- ${header} ---`);
      lastPhase = header;
    }
    if (entry.scope === "system") {
      console.log(`  [HOUSE] ${entry.text}`);
    } else if (entry.scope === "mingle" || entry.scope === "whisper") {
      console.log(
        `  [${entry.scope.toUpperCase()}] ${entry.from} -> ${entry.to?.join(", ")}: "${entry.text}"`,
      );
    } else if (entry.scope === "diary") {
      console.log(`  [DIARY] ${entry.from}: "${entry.text}"`);
    } else {
      console.log(`  ${entry.from}: "${entry.text}"`);
    }
  }
}
