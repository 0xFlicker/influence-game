import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cutFixtureReports, cutInfluenceFixture } from "../packages/engine/src/house-cuts/fixtures";
import { buildCompletedGameResults } from "../packages/engine/src/completed-game-results";
import { buildPostgameAnalysisProjection } from "../packages/engine/src/postgame-analysis";
import { buildHouseHighlightsProjection } from "../packages/engine/src/postgame-highlights/build";
import { renderCutReview } from "../packages/engine/src/house-cuts/review-html";

// Explicit fixture-only entry point: no credentials, DB reads, provider calls or publication.
if (process.argv.length > 3) throw new Error("Usage: bun scripts/preview-house-cuts.ts [output-directory]");
const directory = resolve(process.argv[2] ?? ".renders/house-cuts-prototype");
const reports = await cutFixtureReports();
const rankings = reports.map(report => report.candidates.filter(c => report.source.game.kind === "influence"
  || c.context[0]?.group.includes(":thread:") || report.source.audience === "omniscient" && c.context[0]?.group.endsWith(":pack")).slice(0, report.source.audience === "omniscient" ? 2 : 1).map(c => c.key));
const { events } = cutInfluenceFixture();
const previous = buildHouseHighlightsProjection({ analysis: buildPostgameAnalysisProjection({ events, completedResults: buildCompletedGameResults({ events }), includeEvidence: true }) });
const baseline = { state: previous.state, reason: previous.noCutReason, selectedCount: previous.scenes.length };
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, "index.html"), renderCutReview(reports, rankings, baseline));
await writeFile(resolve(directory, "review.json"), JSON.stringify({ fixtureOnly: true, reports, rankings, baseline }, null, 2));
console.log(`Fixture review: ${resolve(directory, "index.html")}\nNo provider calls or publication.`);
