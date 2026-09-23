import type { PhaseContext } from "./game-runner.types";
import { displayNameForFormat } from "./format-presentation-metadata";
import { ruleSheetForFormat } from "./format-pressure";

/** The same public rules and timing for diary questions, follow-ups, and answers. */
export function buildDiaryFormatContext(ctx: PhaseContext) {
  if (ctx.endgameStage) return null;
  const formatId = ctx.resolvedRoundFormatId ?? ctx.formatPressure?.selectedFormat;
  if (!formatId) return null;
  const resolved = ctx.resolvedRoundFormatId !== undefined;
  return {
    name: displayNameForFormat(formatId),
    status: resolved ? "resolved" : "active",
    rules: ruleSheetForFormat(formatId),
    interpretation: resolved
      ? "The round has resolved. These rules explain the completed round; reflect on what happened, not on casting another ballot."
      : "This format is active. Discuss decisions and plans under these rules; its outcome is not yet resolved.",
  };
}
