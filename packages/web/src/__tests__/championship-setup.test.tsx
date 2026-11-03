import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { ChampionshipDraftSetup, championshipDraftSetup } from "../app/admin/championship-admin-panel";
import { SEASON_ZERO_CHAMPIONSHIP_POLICIES } from "@influence/engine/championship";

test("event setup offers only the date and explains the agreed rules", () => {
  const html = renderToString(<ChampionshipDraftSetup event={{ id: "event", startDate: null }} disabled={false} run={async () => {}} />);
  expect((html.match(/<input/g) ?? []).length).toBe(1);
  expect(html).toContain('type="date"');
  expect(html).not.toContain("<select");
  expect(html).not.toContain('type="number"');
  expect(html).not.toMatch(/Undecided|Draft policies|explicit product decision|Owner when allocation/);
  for (const text of ["2 wolves, 1 seer, 1 doctor and 4 villagers", "a loss 0 and a true draw ½", "higher frozen Season 0 agent score", "share the championship", "normal tie handling", "at least one Season 0 game", "season close", "championship ledger locks"]) expect(html).toContain(text);
});

test("saving setup always applies confirmed policy and preserves the chosen calendar date", () => {
  const request = championshipDraftSetup("2026-12-01");
  expect(request).toEqual({ policies: SEASON_ZERO_CHAMPIONSHIP_POLICIES, startDate: "2026-12-01" });
  expect(request.policies).not.toBe(SEASON_ZERO_CHAMPIONSHIP_POLICIES);
  expect(championshipDraftSetup("").startDate).toBeNull();
});

test("normal championship management has no badge approval or recipient correction panel", () => {
  const source = readFileSync(new URL("../app/admin/championship-admin-panel.tsx", import.meta.url), "utf8");
  expect(source).not.toContain("ChampionshipAwardControls");
  expect(source).not.toContain("review awards");
  expect(source).toContain("Badges are awarded automatically");
});
