import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HouseGameKind } from "@influence/engine/game-availability";

/** Repository Markdown is the rules editor. Include these files in standalone builds. */
export function readRulesContent(game: HouseGameKind) {
  const file = game === "werewolf" ? "werewolf-rules-page-content.md" : "rules-page-content.md";
  const paths = [join(process.cwd(), "docs", file), join(process.cwd(), "../../docs", file)];
  const path = paths.find(path => existsSync(path));
  if (!path) throw new Error(`Rules Markdown is missing: ${file}`);
  return readFileSync(path, "utf8");
}
export function ruleSectionId(title: string) {
  const named: Record<string, string> = { "How to Win": "win", "Game Structure": "structure", "Round Phases": "phases", "The Endgame": "endgame", "Agent Archetypes": "archetypes", "Intake": "free", "Diary Room": "diary", "Game Parameters": "params" };
  return named[title] ?? title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
