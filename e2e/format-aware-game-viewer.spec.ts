import { Phase } from "../packages/engine/src/types";
import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import {
  createFormatKernelViewerScenario,
  type FormatKernelViewerScenarioId,
} from "../packages/engine/src/fixtures/format-kernel-viewer";
import {
  displayNameForFormat,
} from "../packages/engine/src/format-presentation-metadata";
import {
  installDeterministicClassicGame,
  installDeterministicCompletedClassicGame,
  installDeterministicFormatGame,
} from "./format-aware-game-viewer.fixtures";
import {
  startLocalHarness,
  stopLocalHarness,
  type LocalHarnessProcess,
} from "./local-harness";

const RUN_FORMAT_VIEWER = process.env.PLAYWRIGHT_FORMAT_VIEWER === "1";
const FORMAT_VIEWER_SLUG =
  process.env.PLAYWRIGHT_FORMAT_VIEWER_SLUG ?? "young-ruby-isle";
const CLASSIC_VIEWER_SLUG =
  process.env.PLAYWRIGHT_CLASSIC_VIEWER_SLUG ?? "edge-smoke-dusk";
const COMPLETED_SHARED_SCENARIO_IDS = [
  "save_or_eliminate_clear",
  "vote_bomb_clear",
  "majority_elimination_clear",
  "majority_elimination_tie",
  "safety_bounce_tie",
] as const satisfies readonly FormatKernelViewerScenarioId[];

function formatNameForScenario(
  scenarioId: FormatKernelViewerScenarioId,
): string {
  const selectedFormatId = createFormatKernelViewerScenario(
    scenarioId,
  ).expected.selectedFormatId;
  if (!selectedFormatId) throw new Error(`Missing selected format for ${scenarioId}`);
  return displayNameForFormat(selectedFormatId);
}

function formatBrowserEntry(
  scenarioId: FormatKernelViewerScenarioId,
  slug: string,
): {
  scenarioId: FormatKernelViewerScenarioId;
  slug: string;
  formatName: string;
} {
  return {
    scenarioId,
    slug,
    formatName: formatNameForScenario(scenarioId),
  };
}

const SHARED_FORMAT_NAMES = COMPLETED_SHARED_SCENARIO_IDS.map(
  formatNameForScenario,
);
const COMPLETED_FORMAT_FIXTURES = [
  {
    slug: "dark-coral-horn",
    formats: SHARED_FORMAT_NAMES,
  },
  {
    slug: "mild-cream-rune",
    formats: SHARED_FORMAT_NAMES,
  },
  {
    slug: "young-ruby-isle",
    formats: [
      formatNameForScenario("save_or_eliminate_clear"),
      formatNameForScenario("safety_bounce_tie"),
    ],
  },
] as const;
const FORMAT_BROWSER_MATRIX = [
  formatBrowserEntry(
    "save_or_eliminate_clear",
    "deterministic-save-or-eliminate",
  ),
  formatBrowserEntry("vote_bomb_clear", "deterministic-vote-bomb"),
  formatBrowserEntry(
    "majority_elimination_clear",
    "deterministic-majority-elimination-clear",
  ),
  formatBrowserEntry(
    "majority_elimination_tie",
    "deterministic-majority-elimination-tie",
  ),
  formatBrowserEntry("safety_bounce_tie", "deterministic-safety-bounce"),
] as const;

interface LocalFormatViewerHarness {
  webUrl: string;
}

let harnessProcess: LocalHarnessProcess;
let harness: LocalFormatViewerHarness;

test.describe("format-aware game viewer", () => {
  test.skip(
    !RUN_FORMAT_VIEWER,
    "Set PLAYWRIGHT_FORMAT_VIEWER=1 to run the isolated local format viewer story.",
  );
  // Each story owns its page/fixtures. Keep one worker, but run the remaining
  // stories after a failure so CI reports the whole viewer's regressions.
  test.describe.configure({ mode: "default", retries: 0 });

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    if (process.env.PLAYWRIGHT_VIEWER_FIXTURE_WEB_URL) {
      harness = { webUrl: process.env.PLAYWRIGHT_VIEWER_FIXTURE_WEB_URL };
      return;
    }
    const started = await startLocalFormatViewerHarness();
    harnessProcess = started.process;
    harness = started.harness;
  });

  test.afterAll(async () => {
    if (harnessProcess) await stopLocalFormatViewerHarness(harnessProcess);
  });

  test("fullscreen portrait player preserves speech through fallback, rotation and exit", async ({ page }) => {
    const slug = "fullscreen-portrait-fixture";
    await page.addInitScript(() => Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false }));
    await page.setViewportSize({ width: 390, height: 844 });
    const scenario = createFormatKernelViewerScenario("two_names_declined");
    const fixture = await installDeterministicFormatGame(page, { slug, scenarioId: "two_names_declined", status: "in_progress", initialDecisionCount: 0 });
    await page.goto(viewerUrl(`/games/${slug}`));
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await expect.poll(() => fixture.sockets.length).toBe(1);
    const speech = "We can make this plan work together. ".repeat(70);
    fixture.sockets[0]!.send(JSON.stringify({ type: "message", entry: {
      entrySequence: 1, round: 0, phase: "INTRODUCTION", from: scenario.roster[0]!.id,
      scope: "public", text: speech, timestamp: Date.now(),
    } }));
    await expect(page.getByRole("button", { name: "Enter fullscreen" })).toBeVisible();
    await expect(page.locator('[data-solo-image] blockquote').locator('..')).toHaveCSS("opacity", "1");
    await page.getByRole("button", { name: "Pause replay", exact: true }).click();
    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    const player = page.locator('[data-player-fullscreen="true"]');
    await expect(player).toBeVisible();
    await expect(player.getByLabel(/Page 1 of/)).toBeVisible();
    const before = await player.locator('[data-solo-image]').getAttribute('aria-label');
    await player.getByRole('img').click();
    // Fullscreen resize may still repaginate text. Tapping must preserve the
    // active speech and reading position, not the previous frame's page size.
    await expect(player.locator('[data-solo-image]')).toHaveAttribute('aria-label', before!);
    await expect(player.getByLabel(/Page 1 of/)).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(player.getByLabel(/Page 1 of/)).toBeVisible();
    // ResizeObserver updates frame geometry and pagination in separate passes.
    // Assert both together so an old page size cannot satisfy an earlier check.
    await expect.poll(() => player.locator('blockquote').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.top >= 0 && bounds.bottom <= window.innerHeight
        && element.scrollHeight <= element.clientHeight + 1;
    })).toBe(true);
    await player.getByRole("button", { name: /Play/ }).filter({ visible: true }).click();
    await player.getByRole("img").click();
    const controls = player.locator('[data-replay-controls]');
    await expect(controls).toHaveClass(/opacity-0/);
    const picture = await player.getByRole("img").boundingBox();
    if (!picture) throw new Error("Missing fullscreen portrait bounds");
    await page.mouse.move(picture.x + 5, picture.y + 5);
    await expect(controls).toHaveClass(/opacity-100/);
    await expect(controls).toHaveClass(/opacity-0/, { timeout: 5000 });
    await page.keyboard.press("Space");
    await expect(controls).toHaveClass(/opacity-100/);
    await page.getByRole("button", { name: "Exit fullscreen" }).press("Escape");
    await expect(player).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Enter fullscreen" })).toBeFocused();
    await expect(page.getByRole("button", { name: /Play/ }).filter({ visible: true })).toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
  });

  test("native fullscreen enters and exits without changing paused speech", async ({ page }) => {
    await page.clock.install();
    const slug = "native-fullscreen-fixture";
    await page.setViewportSize({ width: 1280, height: 800 });
    const scenario = createFormatKernelViewerScenario("two_names_declined");
    const fixture = await installDeterministicFormatGame(page, { slug, scenarioId: "two_names_declined", status: "in_progress", initialDecisionCount: 0 });
    await page.goto(viewerUrl(`/games/${slug}`));
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await expect.poll(() => fixture.sockets.length).toBe(1);
    fixture.sockets[0]!.send(JSON.stringify({ type: "message", entry: {
      entrySequence: 1, round: 0, phase: "INTRODUCTION", from: scenario.roster[0]!.id,
      scope: "public", text: "The same speech stays on screen. ".repeat(20), timestamp: Date.now(),
    } }));
    const speech = page.locator('[data-solo-image] blockquote');
    await expect(page.getByRole("region", { name: "Introduction: Atlas", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pause/ }).filter({ visible: true })).toBeVisible();
    // Start within the reading interval, after the solo entrance/settling hold.
    // Hydration can briefly render a readable paused seek at elapsed time zero.
    await page.clock.runFor(1_500);
    await expect(speech.locator('..')).toHaveCSS("opacity", "1");
    await page.getByRole("button", { name: /Pause/ }).filter({ visible: true }).click();
    await expect(speech).toContainText("The same speech stays on screen.");
    await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
    await expect(speech).toContainText("The same speech stays on screen.");
    await expect(page.getByRole("button", { name: /Play/ }).filter({ visible: true })).toBeVisible();
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(speech).toContainText("The same speech stays on screen.");
    await expect(page.getByRole("button", { name: "Enter fullscreen", exact: true })).toBeFocused();
  });

  test("solo clicks reveal speech before exiting and seeks reveal votes immediately", async ({ page }) => {
    await page.clock.install();
    const slug = "solo-click-fixture";
    const scenario = createFormatKernelViewerScenario("two_names_declined");
    const actor = scenario.roster[0]!;
    const target = scenario.roster[1]!;
    const fixture = await installDeterministicFormatGame(page, { slug, scenarioId: "two_names_declined", status: "in_progress", initialDecisionCount: 0 });
    await page.route(`**/api/games/${slug}/visual`, route => route.fulfill({ json: { enabled: false, status: null, portraits: {}, scenes: [], fullBodies: { [actor.id]: "/solo-click.svg" } } }));
    await page.route("**/solo-click.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#393532"/></svg>' }));
    await page.goto(viewerUrl(`/games/${slug}`));
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await expect.poll(() => fixture.sockets.length).toBe(1);
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    const send = (entry: Record<string, unknown>) => fixture.sockets[0]!.send(JSON.stringify({ type: "message", entry }));
    send({ entrySequence: 1, round: 0, phase: "INTRODUCTION", from: actor.id, scope: "public", text: "I intend to win your trust.", timestamp: Date.now() });
    const solo = page.locator('[data-solo-image="full-body"]');
    await expect(solo).toBeVisible();
    await page.clock.runFor(100);
    await expect(solo.locator("blockquote")).toHaveCount(0);
    await solo.click();
    await expect(solo.locator("blockquote")).toContainText("I intend to win your trust.");
    await expect(solo.locator("blockquote").locator("..")).toHaveCSS("opacity", "1");
    send({ entrySequence: 2, round: 0, phase: "INTRODUCTION", from: actor.id, scope: "public", text: "Private thinking must not be spoken.", acceptedBallot: { voterId: actor.id, targetId: target.id, purpose: "empower" }, timestamp: Date.now() + 1 });
    await solo.click();
    await page.clock.runFor(125);
    const opacity = Number(await solo.locator("blockquote").locator("..").evaluate(element => getComputedStyle(element).opacity));
    expect(opacity).toBeGreaterThan(0);
    expect(opacity).toBeLessThan(1);
    await solo.click();
    await expect(solo).toHaveAttribute("aria-label", `Introduction: ${actor.name}`);
    await page.clock.runFor(725);
    await expect(solo).toHaveAttribute("aria-label", `Ballot: ${actor.name}`);
    await expect(solo.locator("blockquote")).toHaveCount(0);
    await solo.click();
    await expect(solo.locator("blockquote")).toContainText(target.name);
    await expect(solo.locator("blockquote")).not.toContainText("Private thinking");
    await page.getByRole("button", { name: "Go to replay start", exact: true }).click();
    await expect(solo.locator("blockquote")).toContainText("I intend to win your trust.");
    await expect(solo.locator("blockquote").locator("..")).toHaveCSS("opacity", "1");
  });

  for (const confirmedHead of [false, true]) {
    test(`full-body solo speech and House summary fit the fullscreen midline layout (${confirmedHead ? "confirmed head" : "legacy fallback"})`, async ({ page }) => {
      // Chromium cannot resize its native fullscreen window. Exercise rotation
      // in the viewport fallback; native entry/exit is covered separately.
      await page.addInitScript(() => Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: false }));
      const slug = "full-body-solo-fixture";
      const scenario = createFormatKernelViewerScenario("two_names_declined");
      const actor = scenario.roster[0]!;
      const fixture = await installDeterministicFormatGame(page, { slug, scenarioId: "two_names_declined", status: "in_progress", initialDecisionCount: 0 });
      await page.route(`**/api/games/${slug}/visual`, route => route.fulfill({ json: { enabled: false, status: null, portraits: {}, scenes: [], fullBodies: { [actor.id]: "/solo-fixture.svg" }, fullBodyHeads: confirmedHead ? { [actor.id]: { x: 0.4, y: 0.09, width: 0.2, height: 0.14 } } : {} } }));
      await page.route("**/solo-fixture.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#393532"/><circle cx="200" cy="90" r="40" fill="#bd9d70"/><path d="M160 140H240L260 360H230V560H205V360H195V560H170V360H140Z" fill="#ded4c0"/></svg>' }));
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(viewerUrl(`/games/${slug}`));
      await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
      await expect.poll(() => fixture.sockets.length).toBe(1);
      fixture.sockets[0]!.send(JSON.stringify({ type: "message", entry: { entrySequence: 1, round: 0, phase: "INTRODUCTION", from: actor.id, scope: "public", text: "I intend to win your trust.", timestamp: Date.now() } }));
      const solo = page.locator('[data-solo-image="full-body"]');
      await expect(solo).toBeVisible();
      await expect(solo.getByRole("img")).toHaveAttribute("src", /\/solo-fixture\.svg$/);
      const enter = page.getByRole("button", { name: "Enter fullscreen", exact: true });
      const icon = await enter.locator("svg").boundingBox();
      expect(icon!.width).toBeGreaterThanOrEqual(32);
      await enter.click();
      await expect(solo.locator('blockquote').locator('..')).toHaveCSS("opacity", "1");
      await page.getByRole("button", { name: /Pause/ }).filter({ visible: true }).click();
      for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
        await page.setViewportSize(size);
        await expect(solo.getByRole("img")).toHaveCSS("object-fit", "contain");
        await expect.poll(async () => {
          const image = await solo.getByRole("img").boundingBox();
          return Math.round(image!.height);
        }).toBe(size.height);
        const image = (await solo.getByRole("img").boundingBox())!;
        expect(image.y).toBe(0);
        expect(image.width).toBeCloseTo(size.height * 2 / 3, 0);
        expect(image.x).toBeCloseTo((size.width - image.width) / 2, 0);
        const bubble = solo.locator("blockquote");
        await expect(bubble).toContainText("I intend to win your trust.");
        const bounds = await bubble.evaluate(el => ({ top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom, viewport: innerHeight, scroll: el.firstElementChild!.scrollHeight, client: el.firstElementChild!.clientHeight }));
        expect(bounds.top).toBeGreaterThanOrEqual(0);
        expect(bounds.top).toBeGreaterThan(image.y + image.height * (confirmedHead ? 0.23 : 0.22));
        expect(bounds.bottom).toBeLessThan(bounds.viewport - 140);
        expect(bounds.scroll).toBeLessThanOrEqual(bounds.client + 1);
      }
      fixture.sockets[0]!.send(JSON.stringify({ type: "message", entry: { entrySequence: 2, round: 0, phase: "INTRODUCTION", from: null, scope: "system", dialogueKind: "house_summary", text: "The House has heard their promises. Now the game begins.", timestamp: Date.now() } }));
      await expect(page.getByRole("button", { name: "Next ▶▶", exact: true })).toBeEnabled();
      await page.keyboard.press("ArrowRight");
      const house = page.getByRole("region", { name: "House summary" });
      await expect(house).toBeVisible();
      const halves = await house.evaluate(el => {
        const stage = el.getBoundingClientRect();
        return { mid: stage.top + stage.height / 2, logoBottom: el.querySelector("img")!.getBoundingClientRect().bottom, textTop: el.querySelector("[data-house-copy]")!.getBoundingClientRect().top };
      });
      expect(halves.logoBottom).toBeLessThanOrEqual(halves.mid);
      expect(halves.textTop).toBeCloseTo(halves.mid, 0);
    });
  }

  test("jury transcript receipts produce only one canonical round of votes before the winner", async ({ page }) => {
    const slug = "jury-single-reveal";
    const scenario = createFormatKernelViewerScenario("majority_elimination_tie");
    const voters = scenario.roster.slice(0, 3);
    const votes = Object.fromEntries(voters.map(voter => [voter.id, "rex"]));
    const decisions: ReturnType<typeof createFormatKernelViewerScenario>["decisions"] = [{
      type: "jury.winner_determined", sequence: 10, round: 2, phase: Phase.JURY_VOTE,
      timestamp: "2026-09-23T00:00:00.000Z", payload: { votes, winnerId: "rex" },
    }];
    await installDeterministicFormatGame(page, { slug, scenarioId: "majority_elimination_tie", status: "completed", decisions });
    await page.route(`**/api/games/${slug}/transcript*`, route => route.fulfill({ json: voters.map((voter, i) => ({
      id: i + 1, gameId: slug, entrySequence: i + 1, firstDurableEventSequence: 7 + i,
      phase: "JURY_VOTE", round: 2, scope: "system", dialogueKind: "system_announcement",
      fromPlayerId: null, fromPlayerName: "The House", toPlayerIds: null, text: "Recorded vote receipt", timestamp: i,
      acceptedBallot: { purpose: "winner", voterId: voter.id, targetId: "rex" },
    })) }));
    await page.goto(viewerUrl(`/games/${slug}/replay`));
    await expect(page.getByRole("region", { name: "Ballot: Atlas" }).locator("blockquote").locator("..")).toHaveCSS("opacity", "1");
    await pauseAutoplay(page, "⏸ Pause");
    const next = () => page.getByRole("button", { name: "Next ▶▶", exact: true }).click();
    for (const voter of voters) {
      await assertSoloBallot(page, voter.name, "Rex");
      await next();
    }
    await expect(page.getByText("Rex wins The House.", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: /^Ballot: / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Next ▶▶", exact: true })).toBeDisabled();
  });

  test("Empower tie separates original votes, nominees, revotes and final totals", async ({ page }, testInfo) => {
    const slug = "empower-revote-beats";
    const meta = { round: 1, phase: Phase.VOTE, timestamp: "2026-09-23T00:00:00.000Z" };
    const decisions: ReturnType<typeof createFormatKernelViewerScenario>["decisions"] = [
      ...[["atlas", "lyra"], ["lyra", "atlas"], ["echo", "atlas"], ["rex", "lyra"]].map(([voterId, empowerTarget], i) => ({
        ...meta, sequence: i + 1, type: "vote.cast" as const, payload: { voterId: voterId!, empowerTarget: empowerTarget! },
      })),
      { ...meta, sequence: 5, type: "vote.empower_tally_resolved", payload: { counts: { atlas: 2, lyra: 2, echo: 0, rex: 0 }, empowered: "atlas", tied: ["atlas", "lyra"], method: "tie_pending", cumulativeEmpowerVotes: { atlas: 2, lyra: 2, echo: 0, rex: 0 } } },
      { ...meta, sequence: 6, type: "vote.empower_vote_cleared", payload: { voterId: "echo" } },
      { ...meta, sequence: 7, type: "vote.empower_vote_cleared", payload: { voterId: "rex" } },
      { ...meta, sequence: 8, type: "vote.empower_revote_cast", payload: { voterId: "echo", target: "lyra" } },
      { ...meta, sequence: 9, type: "vote.empower_revote_cast", payload: { voterId: "rex", target: "lyra" } },
      { ...meta, sequence: 10, type: "vote.empowered_set", payload: { empowered: "lyra", method: "revote" } },
    ];
    await installDeterministicFormatGame(page, { slug, scenarioId: "majority_elimination_tie", status: "completed", decisions });
    await page.goto(viewerUrl(`/games/${slug}/replay`));
    await expect(page.getByRole("region", { name: "Ballot: Atlas" }).locator("blockquote").locator("..")).toHaveCSS("opacity", "1");
    await pauseAutoplay(page, "⏸ Pause");
    const start = page.getByRole("button", { name: "Go to replay start", exact: true });
    if (await start.isEnabled()) await start.click();
    const next = () => page.getByRole("button", { name: "Next ▶▶", exact: true }).click();
    for (const [voter, target] of [["Atlas", "Lyra"], ["Lyra", "Atlas"], ["Echo", "Atlas"], ["Rex", "Lyra"]]) {
      await assertSoloBallot(page, voter!, target!);
      await next();
    }
    const tie = page.locator('[data-format-cue="empowered_tie"]');
    await expect(tie).toContainText("A tie for Empower");
    await expect(tie).toContainText("Atlas · Lyra are tied");
    await expect(tie).not.toContainText("is Empowered");
    await expect(tie.locator('[data-empower-total="atlas"] dd')).toHaveText("2votes");
    await page.screenshot({ path: testInfo.outputPath("empower-tie.png") });
    const desktop = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(tie).toBeVisible();
    await assertLocatorInsideViewport(tie, 390);
    const totals = tie.getByLabel("Empowered vote totals");
    await expect.poll(() => totals.evaluate(el => {
      const stage = el.closest('[data-presentation-animation-boundary]')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return box.top >= stage.top && box.bottom <= stage.bottom;
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("empower-tie-mobile.png") });
    await page.setViewportSize(desktop);
    await next();
    await assertSoloBallot(page, "Echo", "Lyra");
    await expect(page.getByRole("region", { name: "Ballot: Echo" })).toContainText("Revote to empower");
    await next();
    await assertSoloBallot(page, "Rex", "Lyra");
    await next();
    const result = page.locator('[data-format-cue="empowered_tally"]');
    await expect(result).toContainText("Empower revote");
    await expect(result).toContainText("Lyra is Empowered");
    await expect(result.locator('[data-empower-total="atlas"] dd')).toHaveText("0votes");
    await expect(result.locator('[data-empower-total="lyra"] dd')).toHaveText("2votes");
    await expect(result.locator('[data-empower-receipt]')).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("empower-revote-result.png") });
  });

  test("Empowered deciding vote gets a full-body speech beat before elimination", async ({ page }, testInfo) => {
    const slug = "deciding-vote-beat";
    await installDeterministicFormatGame(page, { slug, scenarioId: "majority_elimination_tie", status: "completed" });
    await page.route(`**/api/games/${slug}/visual`, route => route.fulfill({ json: { enabled: false, status: null, portraits: {}, scenes: [], fullBodies: { atlas: "/deciding-body.svg" } } }));
    await page.route("**/deciding-body.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#393532"/><circle cx="200" cy="90" r="40" fill="#bd9d70"/></svg>' }));
    await page.goto(viewerUrl(`/games/${slug}/replay`));
    await pauseAutoplay(page, "⏸ Pause");
    const next = () => page.getByRole("button", { name: "Next ▶▶", exact: true }).click();
    const tie = page.locator('[data-format-cue="format_tiebreak"]');
    for (let i = 0; i < 30 && !await tie.count(); i++) await next();
    await expect(tie).toContainText("Atlas must break the tie");
    await expect(tie).toContainText("Tied: Lyra · Echo");
    await next();
    await assertSoloBallot(page, "Atlas", "Echo");
    const solo = page.locator('[data-solo-image="full-body"]');
    await expect(solo).toBeVisible();
    await expect(solo.locator("blockquote").locator("..")).toHaveCSS("opacity", "1");
    await expect(page.getByRole("region", { name: "Ballot: Atlas" })).toContainText("Deciding vote · Vote to eliminate");
    await page.screenshot({ path: testInfo.outputPath("deciding-vote.png") });
    await next();
    await expect(page.locator('[data-format-cue="format_elimination"]')).toContainText("Echo is eliminated");
  });

  test("nonvisual live portraits keep phase navigation on the presented dialogue", async ({ page }) => {
    const slug = "nonvisual-live-portraits";
    const scenario = createFormatKernelViewerScenario("two_names_declined");
    const fixture = await installDeterministicFormatGame(page, {
      slug, scenarioId: "two_names_declined", status: "in_progress", initialDecisionCount: 0,
    });
    let visualRequests = 0;
    page.on("request", (request) => { if (request.url().endsWith("/visual")) visualRequests++; });
    await page.goto(viewerUrl(`/games/${slug}`));
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await expect.poll(() => fixture.sockets.length).toBe(1);
    const actor = scenario.roster[0]!;
    for (const [index, phase] of ["INTRODUCTION", "LOBBY", "FORMAT_MINGLE"].entries()) {
      fixture.sockets[0]!.send(JSON.stringify({ type: "message", entry: {
        entrySequence: index + 1, round: phase === "INTRODUCTION" ? 0 : 1,
        phase, from: actor.id, scope: "public", text: `Accepted dialogue ${index + 1}.`, timestamp: Date.now() + index,
      } }));
      const purpose = phase === "INTRODUCTION" ? "Introduction" : "Conversation";
      const speech = page.getByRole("region", { name: `${purpose}: ${actor.name}`, exact: true });
      // Consecutive conversations share a speaker/region. Wait for this accepted
      // line, not the previous line that may still be finishing its exit fade.
      await expect(speech.getByText(`Accepted dialogue ${index + 1}.`, { exact: true })).toBeVisible({ timeout: 15_000 });
      const label = phase === "INTRODUCTION" ? "Introductions" : phase === "LOBBY" ? "Public Lobby" : "Format Mingle";
      await expect(page.getByRole("heading", { name: label, level: 1, exact: true })).toBeVisible();
      await expect(page.locator(".influence-phase-title")).toHaveCount(0, { timeout: 15_000 });
      // Let this accepted speech finish before the next live publication arrives.
      await expect(page.getByRole("status").filter({ hasText: "Waiting for messages…" })).toBeVisible({ timeout: 15_000 });
    }
    expect(visualRequests).toBeGreaterThan(0);
    await expect(page.getByText("Waiting for messages…", { exact: true })).toHaveCount(1);
    await expect(page.getByText("Waiting for next phase", { exact: true })).toHaveCount(0);
  });

  test("Two Names reconnect preserves an explicit pause while newer results arrive", async ({ page }) => {
    const slug = "catchup-two-names-paused";
    const scenario = createFormatKernelViewerScenario("two_names_declined");
    const fixture = await installDeterministicFormatGame(page, {
      slug, scenarioId: "two_names_declined", status: "in_progress",
      initialDecisionCount: scenario.decisions.length - 1,
      historicalCatchUp: true, frameResponseDelayMs: 300,
    });
    await page.goto(viewerUrl(`/games/${slug}`));
    await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
    await expect(page.locator("[data-format-cue]").first()).toBeVisible();
    await page.getByRole("button", { name: "⏸ Pause", exact: true }).click();
    const pausedKind = await page.locator("[data-format-cue]").first().getAttribute("data-format-cue");
    fixture.setDecisionCount(scenario.decisions.length);
    fixture.sockets.at(-1)!.close({ code: 1001, reason: "test reconnect" });
    await expect.poll(() => fixture.sockets.length).toBe(2);
    await expect(page.getByRole("button", { name: "▶ Play", exact: true })).toBeVisible();
    await expect(page.locator("[data-format-cue]").first()).toHaveAttribute("data-format-cue", pausedKind!);
    await expect(page.locator("[data-presentation-animation-boundary]").getByText("Historical introduction must not restart live playback.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "▶ Play", exact: true }).click();
    await expect(page.getByRole("region", { name: "Ballot: Rex", exact: true })).toBeVisible({ timeout: 15_000 });
    await assertSoloBallot(page, "Rex", "Lyra");
    await expect(page.getByText("Presentation incomplete", { exact: true })).toHaveCount(0);
  });

  for (const frameResponseDelayMs of [0, 500]) {
    test(`Two Names live catch-up preserves current round with frame delay ${frameResponseDelayMs}`, async ({ page }) => {
      const slug = `catchup-two-names-${frameResponseDelayMs}`;
      await installDeterministicFormatGame(page, {
        slug, scenarioId: "two_names_declined", status: "in_progress",
        historicalCatchUp: true, frameResponseDelayMs,
      });
      await page.goto(viewerUrl(`/games/${slug}`));
      await expect(page.locator('[data-format-cue="format_elimination"]')).toBeVisible();
      await expect(page.locator("[data-presentation-animation-boundary]").getByText("Historical introduction must not restart live playback.", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Presentation incomplete", { exact: true })).toHaveCount(0);
      await page.reload();
      await expect(page.locator('[data-format-cue="format_elimination"]')).toBeVisible();
      await expect(page.locator("[data-presentation-animation-boundary]").getByText("Historical introduction must not restart live playback.", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Presentation incomplete", { exact: true })).toHaveCount(0);
    });
  }

  test("live endgame dialogue refreshes canonical cast status without another format decision", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const slug = "live-endgame-cast";
    const fixture = await installDeterministicFormatGame(page, { slug, scenarioId: "two_names_declined", status: "in_progress", initialDecisionCount: 1 });
    await page.goto(viewerUrl(`/games/${slug}`));
    await expect.poll(() => fixture.sockets.length).toBe(1);
    await pauseAutoplay(page, "⏸ Pause");
    await expect(page.getByRole("button", { name: "Inspect Atlas", exact: true })).toContainText("In");
    const players = fixture.currentGame().players.map(player => ({ ...player, status: player.id === "atlas" || player.id === "lyra" ? "eliminated" : "alive" }));
    let reads = 0;
    await page.route(`**/api/games/${slug}/replay-watch-frames*`, async route => {
      reads++;
      await route.fulfill({ json: [{ schemaVersion: 3, gameId: slug, sequence: 100, round: 4, phase: "OPENING_STATEMENTS", eventType: "game.phase_entered", timestamp: Date.now(), players,
        counts: { totalPlayers: 5, alivePlayers: 3, eliminatedPlayers: 2, unknownPlayers: 0 } }] });
    });
    fixture.sockets[0]!.send(JSON.stringify({ type: "message", entry: { entrySequence: 1, firstDurableEventSequence: 100, round: 4, phase: "OPENING_STATEMENTS", from: "echo", speakerPlayerId: "echo", scope: "public", text: "This is my final case.", timestamp: Date.now() } }));
    await expect.poll(() => reads).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) {
      if (await page.getByRole("button", { name: "Inspect Atlas", exact: true }).textContent().then(text => text?.includes("Out"))) break;
      await page.getByRole("button", { name: "Next ▶▶", exact: true }).click();
    }
    await expect(page.getByRole("button", { name: "Inspect Atlas", exact: true })).toContainText("Out");
    await expect(page.getByRole("button", { name: "Inspect Lyra", exact: true })).toContainText("Out");
    await expect(page.getByRole("button", { name: "Inspect Echo", exact: true })).toContainText("In");
  });

  test("format cast badges follow reveals and backward seeks", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const slug = "cast-role-reveals";
    await installDeterministicFormatGame(page, { slug, scenarioId: "two_names_used_tie", status: "completed" });
    await page.goto(viewerUrl(`/games/${slug}/replay`));
    await pauseAutoplay(page, "⏸ Pause");
    const card = (name: string) => page.getByRole("button", { name: `Inspect ${name}`, exact: true });
    const seek = async (kind: string) => {
      for (let i = 0; i < 20; i++) {
        if (await page.locator(`[data-format-cue="${kind}"]`).count()) return;
        await page.getByRole("button", { name: "Next ▶▶", exact: true }).click();
      }
      throw new Error(`Missing format stage ${kind}`);
    };
    await seek("two_names_initial_names");
    await expect(card("Atlas")).toContainText("Empowered");
    await expect(card("Lyra")).toContainText("Nominee");
    await expect(card("Atlas")).not.toContainText("Override");
    await page.getByRole("button", { name: "Previous scene", exact: true }).click();
    await expect(card("Lyra")).not.toContainText("Nominee");
    await seek("two_names_override_draw");
    await expect(card("Atlas")).toContainText("Override");
    await seek("two_names_override_removed");
    await expect(card("Lyra")).not.toContainText("Nominee");
    await expect(card("Rex")).not.toContainText("Nominee");
    await seek("two_names_replacement");
    await expect(card("Rex")).toContainText("Nominee");
    await expect(card("Echo")).toContainText("Nominee");
  });

  test("format cast badges show Safety Bounce classifications only after reveal", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const slug = "cast-safety-reveals";
    await installDeterministicFormatGame(page, { slug, scenarioId: "safety_bounce_tie", status: "completed" });
    await page.goto(viewerUrl(`/games/${slug}/replay`));
    await pauseAutoplay(page, "⏸ Pause");
    for (let i = 0; i < 20; i++) {
      if (await page.locator('[data-format-cue="safety_bounce_started"]').count()) break;
      await page.getByRole("button", { name: "Next ▶▶", exact: true }).click();
    }
    const scenario = createFormatKernelViewerScenario("safety_bounce_tie");
    const start = scenario.decisions.find((event) => event.type === "format.safety_bounce_started");
    const pointer = scenario.decisions.find((event) => event.type === "format.safety_bounce_pointer");
    if (start?.type !== "format.safety_bounce_started" || pointer?.type !== "format.safety_bounce_pointer") throw new Error("Missing Safety Bounce fixture");
    const card = (id: string) => page.getByRole("button", { name: `Inspect ${scenario.roster.find((player) => player.id === id)!.name}`, exact: true });
    await expect(card(start.payload.starterId)).toContainText("Safe");
    await expect(card(pointer.payload.targetId)).not.toContainText("Vulnerable");
    await page.getByRole("button", { name: "Next ▶▶", exact: true }).click();
    await expect(card(pointer.payload.targetId)).toContainText("Vulnerable");
    await page.getByRole("button", { name: "Previous scene", exact: true }).click();
    await expect(card(pointer.payload.targetId)).not.toContainText("Vulnerable");
  });

  for (const scenarioId of ["two_names_declined", "two_names_used_tie"] as const) {
    for (const mobile of [false, true]) {
      test(`Two Names ${scenarioId} keeps names, long pleas and tally legible ${mobile ? "mobile reduced motion" : "desktop"}`, async ({ page }, testInfo) => {
        await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
        await page.emulateMedia({ reducedMotion: mobile ? "reduce" : "no-preference" });
        const slug = `display-${scenarioId}`;
        await installDeterministicFormatGame(page, { slug, scenarioId, status: "completed" });
        await page.goto(viewerUrl(`/games/${slug}/replay`));
        // The local Next dev badge otherwise covers the mobile playback dock.
        await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
        await pauseAutoplay(page, mobile ? "Pause replay" : "⏸ Pause");
        const next = async () => page.getByRole("button", { name: mobile ? "Next scene" : "Next ▶▶", exact: true }).click();
        const seek = async (kind: string) => {
          const stage = page.locator(`[data-format-cue="${kind}"]`);
          for (let i = 0; i < 30; i++) {
            if (await stage.count()) return stage;
            await next();
          }
          throw new Error(`Missing Two Names stage ${kind}`);
        };
        const initial = await seek("two_names_initial_names");
        await expect(initial.locator('[data-nominee-id="lyra"]')).toHaveCSS("opacity", "1");
        await expect(initial.locator('[data-nominee-id="echo"]')).toHaveCSS("opacity", "1");
        await expect(initial).toContainText("Atlas nominates:");
        // Re-enter while playing: exercise animation completion, then seek back while paused.
        await page.getByRole("button", { name: "Previous scene", exact: true }).click();
        await page.getByRole("button", { name: mobile ? "Play replay" : "▶ Play", exact: true }).click();
        await expect(initial).toBeVisible({ timeout: 8_000 });
        await expect(initial.locator('[data-nominee-id="lyra"]')).toHaveCSS("opacity", "1");
        await expect(initial.locator('[data-nominee-id="echo"]')).toHaveCSS("opacity", "1");
        await pauseAutoplay(page, mobile ? "Pause replay" : "⏸ Pause");
        await page.screenshot({ path: testInfo.outputPath("nominees.png") });
        if (scenarioId === "two_names_used_tie") {
          const removed = await seek("two_names_override_removed");
          await expect(removed.locator('[data-nominee-id="lyra"]')).toHaveCSS("opacity", "0.28");
          await expect(removed.locator('[data-nominee-id="rex"]')).toHaveCount(0);
          const replacement = await seek("two_names_replacement");
          await expect(replacement.locator('[data-nominee-id="rex"]')).toHaveCSS("opacity", "1");
        } else {
          const declined = await seek("two_names_override_declined");
          await expect(declined.locator('[data-nominee-id="lyra"]')).toHaveCSS("opacity", "1");
          await expect(declined.locator('[data-nominee-id="echo"]')).toHaveCSS("opacity", "1");
        }
        const speaker = scenarioId === "two_names_used_tie" ? "Rex" : "Lyra";
        const plea = page.getByRole("region", { name: `Plea: ${speaker}`, exact: true });
        for (let i = 0; i < 30 && !await plea.count(); i++) await next();
        const quote = plea.getByRole("blockquote");
        await expect(quote).toContainText("Keep me because the case against me");
        // Image sizing and measured pagination settle in separate observers.
        // Assert their combined result instead of sampling an intermediate page.
        await expect.poll(() => quote.evaluate((element) => {
          const stage = element.closest('section')!.getBoundingClientRect();
          const rect = element.getBoundingClientRect();
          return rect.bottom <= stage.bottom && rect.top >= stage.top
            && rect.height > 40 && element.scrollHeight <= element.clientHeight + 1;
        })).toBe(true);
        await expect(page.getByRole("button", { name: mobile ? "Next scene" : "Next ▶▶", exact: true })).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath("long-plea.png") });
        const sealing = await seek("two_names_ballots_sealing");
        await expect(sealing.locator("[data-nominee-id]")).toHaveCount(2);
        await expect(sealing).not.toContainText("Exit votes");
        await expect(sealing.getByLabel("1 of 2 ballots sealed", { exact: true })).toBeVisible();
        await next();
        await expect(sealing.getByLabel("2 of 2 ballots sealed", { exact: true })).toBeVisible();
        await expect(page.getByRole("region", { name: /^Ballot: / })).toHaveCount(0);
        const first = scenarioId === "two_names_used_tie" ? "Rex" : "Lyra";
        await next();
        await assertSoloBallot(page, scenarioId === "two_names_used_tie" ? "Lyra" : "Rex", first);
        await next();
        await assertSoloBallot(page, "Nova", scenarioId === "two_names_used_tie" ? "Echo" : "Lyra");
        await next();
        const result = await seek("format_aggregate");
        await expect(result).toContainText(scenarioId === "two_names_used_tie" ? "Tie · Empowered decides" : "Result locked");
        await expect(result.getByLabel(`${first}: ${scenarioId === "two_names_used_tie" ? "1 exit vote" : "2 exit votes"}`, { exact: true })).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath("result.png") });
      });
    }
  }

  for (const entry of FORMAT_BROWSER_MATRIX) {
    test(`${entry.formatName} (${entry.scenarioId}) hydrates live current state and retains completed replay/results`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const scenario = createFormatKernelViewerScenario(entry.scenarioId);
      const liveDecisionCount = scenario.decisions.length - 1;
      // Unrevealed ballots have no presentation beat. The player stays on the
      // selected format (or the final public Safety Bounce pointer) until the
      // canonical resolution arrives, rather than showing an operational card.
      const livePhase = entry.scenarioId === "safety_bounce_tie"
        ? "Format Resolution" : "Format Selection";
      await installDeterministicFormatGame(page, {
        slug: entry.slug,
        scenarioId: entry.scenarioId,
        status: "in_progress",
        initialDecisionCount: liveDecisionCount,
      });

      await page.goto(viewerUrl(`/games/${entry.slug}`), {
        waitUntil: "domcontentloaded",
      });
      const liveShell = page.getByTestId("match-watch-shell");
      await expect(liveShell).toBeVisible();
      await expect(liveShell).toHaveAttribute("data-watch-mode", "live");
      await expect(liveShell.getByRole("heading", { name: livePhase, level: 1, exact: true }))
        .toBeVisible();
      await expect(liveShell.getByText(entry.formatName, { exact: true }).first())
        .toBeVisible();
      if (entry.scenarioId === "safety_bounce_tie") {
        const board = liveShell.locator(
          '[data-format-cue="safety_bounce_pointer"]',
        );
        await expect(board).toBeVisible();
        await expect(
          liveShell.locator(
            '[data-presentation-current-entry="true"] [data-format-cue="safety_bounce_pointer"]',
          ),
        ).toBeVisible();
        await assertBoardPartition(board);
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      const reloadedShell = page.getByTestId("match-watch-shell");
      await expect(reloadedShell).toBeVisible();
      await expect(
        reloadedShell.getByRole("heading", { name: livePhase, level: 1, exact: true }),
      ).toBeVisible();
      await expect(
        reloadedShell.getByText(entry.formatName, { exact: true }).first(),
      ).toBeVisible();

      const replaySlug = `${entry.slug}-completed`;
      await installDeterministicFormatGame(page, {
        slug: replaySlug,
        scenarioId: entry.scenarioId,
        status: "completed",
      });
      await page.goto(viewerUrl(`/games/${replaySlug}/replay`), {
        waitUntil: "domcontentloaded",
      });
      const replayShell = page.getByTestId("match-watch-shell");
      await expect(replayShell).toBeVisible();
      await expect(replayShell).toHaveAttribute("data-watch-mode", "replay");
      await expect(
        replayShell.getByText(entry.formatName, { exact: true }).first(),
      ).toBeVisible();
      await assertCompletedFormatReplayProgression(page, replayShell, scenario);

      await page.goto(viewerUrl("/games/dark-coral-horn/results"), {
        waitUntil: "domcontentloaded",
      });
      const results = page.getByTestId("completed-results-review");
      await expect(results).toBeVisible();
      await expect(results.getByRole("heading", {
        name: entry.formatName,
        exact: true,
      }).first())
        .toBeVisible();
    });
  }

  test("reconnect hydrates only higher Safety Bounce decisions and reload abandons local roll-call position", async ({
    page,
  }) => {
    await page.clock.install();
    const routed = await installDeterministicFormatGame(page, {
      slug: "deterministic-safety-reconnect",
      scenarioId: "safety_bounce_tie",
      status: "in_progress",
      initialDecisionCount: 5,
    });
    await page.goto(viewerUrl("/games/deterministic-safety-reconnect"), {
      waitUntil: "domcontentloaded",
    });

    const initialPointer = page.locator(
      '[data-presentation-current-entry="true"] [data-format-cue="safety_bounce_pointer"]',
    );
    await expect(initialPointer).toBeVisible();
    expect(await acceptedTarget(initialPointer)).toBe("echo");
    await expect.poll(() => routed.sockets.length).toBe(1);

    routed.setDecisionCount(6);
    await routed.sockets[0]!.close({
      code: 1012,
      reason: "deterministic reconnect",
    });
    await expect(
      page.getByText("Reconnecting", { exact: true }).first(),
    ).toBeVisible();
    await page.clock.runFor(1_250);
    await expect.poll(() => routed.sockets.length).toBe(2);
    await expect
      .poll(async () => {
        const pointer = page.locator(
          '[data-format-cue="safety_bounce_pointer"]',
        );
        if (!(await pointer.isVisible().catch(() => false))) return null;
        return acceptedTarget(pointer);
      })
      .toBe("rex");

    routed.setDecisionCount(
      createFormatKernelViewerScenario("safety_bounce_tie").decisions.length,
    );
    const remainingDecisions = createFormatKernelViewerScenario(
      "safety_bounce_tie",
    ).decisions.slice(6);
    for (const decision of remainingDecisions) {
      routed.sockets.at(-1)!.send(JSON.stringify({
        type: "viewer_decision_event",
        gameId: "deterministic-safety-reconnect",
        event: decision,
      }));
    }
    const rollCall = page.getByRole("region", { name: /^Ballot: / });
    await advanceClockUntilVisible(page, rollCall, "live format roll call");

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(
      page.locator(
        '[data-presentation-current-entry="true"] [data-format-cue="format_elimination"]',
      ),
    ).toBeVisible();
    await expect(rollCall).toHaveCount(0);
  });

  test("renders every terminal prefix and stops malformed histories at the last trusted cue", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const terminalScenarioIds = [
      "terminal_menu",
      "terminal_selection",
      "terminal_classification",
      "terminal_sealed_ballot",
      "terminal_resolution",
    ] as const satisfies readonly FormatKernelViewerScenarioId[];
    for (const [index, scenarioId] of terminalScenarioIds.entries()) {
      const slug = `deterministic-${scenarioId}`;
      const status = index === terminalScenarioIds.length - 1
        ? "cancelled"
        : "suspended";
      await installDeterministicFormatGame(page, {
        slug,
        scenarioId,
        status,
      });
      await page.goto(viewerUrl(`/games/${slug}`), { waitUntil: "domcontentloaded" });
      await expect(
        page.getByText(status === "suspended" ? "Game failed" : "Game unavailable", {
          exact: true,
        }),
      ).toBeVisible();
      const snapshot = page.locator("[data-format-terminal-snapshot]");
      await expect(snapshot).toBeVisible();
      await expect(snapshot).toHaveAttribute("data-format-terminal-trust", "ready");
    }

    const malformedScenarioIds = [
      "malformed_selection",
      "malformed_duplicate_ballot",
      "malformed_safety_actor",
    ] as const satisfies readonly FormatKernelViewerScenarioId[];
    for (const scenarioId of malformedScenarioIds) {
      const slug = `deterministic-${scenarioId}`;
      await installDeterministicFormatGame(page, {
        slug,
        scenarioId,
        status: "suspended",
      });
      await page.goto(viewerUrl(`/games/${slug}`), { waitUntil: "domcontentloaded" });
      const snapshot = page.locator("[data-format-terminal-snapshot]");
      await expect(snapshot).toBeVisible();
      await expect(snapshot).toHaveAttribute(
        "data-format-terminal-trust",
        "incomplete",
      );
      await expect(snapshot.getByText(/Presentation incomplete:/)).toBeVisible();
      await expect(snapshot.locator('[data-format-cue="format_elimination"]'))
        .toHaveCount(0);
    }
  });

  test("settles canonical Safety Bounce choreography through shared replay controls", async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(viewerUrl(`/games/${FORMAT_VIEWER_SLUG}/replay`), {
      waitUntil: "domcontentloaded",
    });
    await pauseAutoplay(page, "⏸ Pause");

    const pointerStage = page.locator('[data-format-cue="safety_bounce_pointer"]');
    await advanceUntilVisible(page, pointerStage, "Safety Bounce pointer");
    await pauseAutoplay(page, "⏸ Pause");
    await assertCanonicalPointerLanding(pointerStage);
    const desktopBoard = await assertBoardPartition(pointerStage);

    const playButton = page.getByRole("button", {
      name: "▶ Play",
      exact: true,
    });
    await expect(playButton).toBeVisible();
    await playButton.click();
    await page.clock.runFor(120);
    const pauseButton = page.getByRole("button", {
      name: "⏸ Pause",
      exact: true,
    });
    await expect(pauseButton).toBeVisible();
    await pauseButton.click();
    await expect(pointerStage).toBeVisible();

    const fastestSpeed = page.getByRole("button", { name: "4x", exact: true });
    await expect(fastestSpeed).toBeVisible();
    await fastestSpeed.click();
    await expect(fastestSpeed).toBeFocused();
    const firstAcceptedTarget = await acceptedTarget(pointerStage);
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => {
        const next = page.locator('[data-format-cue="safety_bounce_pointer"]');
        if (!(await next.isVisible().catch(() => false))) return "next-beat";
        return acceptedTarget(next);
      })
      .not.toBe(firstAcceptedTarget);

    const activePointer = page.locator('[data-format-cue="safety_bounce_pointer"]');
    if (await activePointer.isVisible().catch(() => false)) {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(activePointer).toBeVisible();
      const mobileBoard = await assertBoardPartition(activePointer);
      expect(mobileBoard).toEqual(desktopBoard);
      await assertInsideViewport(activePointer, 390);
      await captureSettledScreenshot(
        page,
        testInfo,
        "safety-bounce-mobile-settled.png",
      );
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    const rollCall = page.getByRole("region", { name: /^Ballot: / });
    await advanceUntilVisible(page, rollCall, "format roll call");
    const firstVoter = await rollCall.getAttribute("aria-label");
    await expect(rollCall.getByRole("blockquote")).not.toBeEmpty();
    await page.keyboard.press("ArrowRight");
    await expect(rollCall).not.toHaveAttribute("aria-label", firstVoter!);
    await expect(rollCall.getByRole("blockquote")).not.toBeEmpty();
    await expect(rollCall).toHaveCount(1);
    await expect(page.getByRole("button", { name: /audio|sound|mute/i })).toHaveCount(0);
    await captureSettledScreenshot(
      page,
      testInfo,
      "safety-bounce-roll-call-desktop.png",
    );
  });

  test("preserves the same semantic board and canonical landing under reduced motion", async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(viewerUrl(`/games/${FORMAT_VIEWER_SLUG}/replay`), {
      waitUntil: "domcontentloaded",
    });
    await page.clock.runFor(100);
    await pauseAutoplay(page, "Pause replay");

    const pointerStage = page.locator('[data-format-cue="safety_bounce_pointer"]');
    await advanceUntilVisible(page, pointerStage, "Safety Bounce pointer");
    await expect(
      page.locator('[data-presentation-animation-boundary="true"]'),
    ).toHaveAttribute("data-reduced-motion", "reduce");
    await assertCanonicalPointerLanding(pointerStage);
    await assertBoardPartition(pointerStage);
    await assertInsideViewport(pointerStage, 390);
    await expect(
      pointerStage.locator('[data-pointer-cycle-candidate="true"]'),
    ).not.toHaveCount(0);
    await captureSettledScreenshot(
      page,
      testInfo,
      "safety-bounce-reduced-motion-mobile.png",
    );
  });

  test("keeps format results complete across persisted games and Replay navigation spoiler-safe", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const fixture of COMPLETED_FORMAT_FIXTURES) {
      await page.goto(viewerUrl(`/games/${fixture.slug}/results`), {
        waitUntil: "domcontentloaded",
      });
      const review = page.getByTestId("completed-results-review");
      await expect(review).toBeVisible();
      for (const formatName of fixture.formats) {
        await expect(review.getByRole("heading", {
          name: formatName,
          exact: true,
        }).first())
          .toBeVisible();
      }
      await expect(review.locator("[data-format-recap-status]")).not.toHaveCount(0);
      const replayLink = review.getByRole("link", {
        name: "Watch Replay",
        exact: true,
      });
      await expect(replayLink).toHaveAttribute(
        "href",
        `/games/${fixture.slug}/replay`,
      );
      await captureSettledScreenshot(
        page,
        testInfo,
        `${fixture.slug}-results-desktop.png`,
      );
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(viewerUrl("/games/dark-coral-horn/results"), {
      waitUntil: "domcontentloaded",
    });
    const mobileReview = page.getByTestId("completed-results-review");
    await expect(mobileReview).toBeVisible();
    await expect(mobileReview.locator("[data-format-recap-status]")).not.toHaveCount(0);
    await assertLocatorInsideViewport(mobileReview, 390);
    await captureSettledScreenshot(
      page,
      testInfo,
      "dark-coral-horn-results-mobile.png",
    );
  });

  test("stages completed ballot evidence as aggregate then roster-ordered roll call", async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(viewerUrl("/games/dark-coral-horn/replay"), {
      waitUntil: "domcontentloaded",
    });
    await pauseAutoplay(page, "⏸ Pause");

    const aggregate = page.locator('[data-format-cue="format_aggregate"]');
    await advanceUntilVisible(page, aggregate, "format aggregate");
    await expect(aggregate.locator("[data-ledger-voter]")).toHaveCount(0);
    await captureSettledScreenshot(
      page,
      testInfo,
      "format-aggregate-before-roll-call.png",
    );

    await page.keyboard.press("ArrowRight");
    await assertSoloBallot(page, "Atlas", "Vera");
    await page.keyboard.press("ArrowRight");
    await assertSoloBallot(page, "Vera", "Finn");
  });

  test("keeps the classic replay/results route free of format presentation", async ({
    page,
  }, testInfo) => {
    await page.clock.install();
    await installDeterministicClassicGame(page, {
      slug: "deterministic-classic-active",
      status: "in_progress",
      gameKernel: "classic",
    });
    await page.goto(viewerUrl("/games/deterministic-classic-active"), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByTestId("match-watch-shell")).toBeVisible();
    await expect(page.getByText("Live", { exact: true }).first()).toBeVisible();
    await expect(page.locator("[data-format-cue]")).toHaveCount(0);

    await installDeterministicClassicGame(page, {
      slug: "deterministic-classic-suspended",
      status: "suspended",
      gameKernel: null,
    });
    await page.goto(viewerUrl("/games/deterministic-classic-suspended"), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Game failed", { exact: true })).toBeVisible();
    await expect(page.locator("[data-format-terminal-snapshot]")).toHaveCount(0);

    await installDeterministicClassicGame(page, {
      slug: "deterministic-classic-cancelled",
      status: "cancelled",
      gameKernel: "classic",
    });
    await page.goto(viewerUrl("/games/deterministic-classic-cancelled"), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Game unavailable", { exact: true })).toBeVisible();
    await expect(page.locator("[data-format-terminal-snapshot]")).toHaveCount(0);

    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicCompletedClassicGame(
      page,
      CLASSIC_VIEWER_SLUG,
    );
    await page.goto(viewerUrl(`/games/${CLASSIC_VIEWER_SLUG}/replay`), {
      waitUntil: "domcontentloaded",
    });
    await pauseAutoplay(page, "⏸ Pause");
    await expect(page.getByTestId("match-watch-shell")).toBeVisible();
    await expect(page.locator("[data-format-cue]")).toHaveCount(0);
    await expect(page.locator("[data-active-format]")).toHaveCount(0);
    await captureSettledScreenshot(
      page,
      testInfo,
      "classic-replay-characterization.png",
    );

    await page.goto(viewerUrl(`/games/${CLASSIC_VIEWER_SLUG}/results`), {
      waitUntil: "domcontentloaded",
    });
    const classicResults = page.getByTestId("completed-results-review");
    await expect(classicResults).toBeVisible();
    await expect(classicResults.getByText("Vote History", { exact: true }))
      .toBeVisible();
    await expect(classicResults.locator("[data-format-recap-status]"))
      .toHaveCount(0);
  });
});

async function assertSoloBallot(page: Page, voter: string, target: string): Promise<void> {
  const ballot = page.getByRole("region", { name: `Ballot: ${voter}`, exact: true });
  await expect(ballot).toBeVisible();
  await expect(ballot.getByRole("blockquote")).toHaveText(target);
  await expect(page.getByRole("region", { name: /^Ballot: / })).toHaveCount(1);
}

async function advanceUntilVisible(
  page: Page,
  locator: Locator,
  stageLabel: string,
  maxAdvances = 1_500,
): Promise<void> {
  for (let index = 0; index < maxAdvances; index += 1) {
    if (await locator.isVisible().catch(() => false)) return;
    await page.keyboard.press("ArrowRight");
    // Flush director/render work before inspecting the next accepted beat.
    await page.clock.runFor(250);
  }
  throw new Error(
    `${stageLabel} did not appear for persisted fixture ${FORMAT_VIEWER_SLUG}.`,
  );
}

async function advanceClockUntilVisible(
  page: Page,
  locator: Locator,
  stageLabel: string,
  maxElapsedMs = 30_000,
): Promise<void> {
  for (let elapsed = 0; elapsed < maxElapsedMs; elapsed += 250) {
    if (await locator.isVisible().catch(() => false)) return;
    await page.clock.runFor(250);
  }
  throw new Error(`${stageLabel} did not appear before ${maxElapsedMs}ms.`);
}

async function pauseAutoplay(page: Page, accessibleName: string): Promise<void> {
  await page.mouse.move(20, 20);
  const pauseButton = page.getByRole("button", {
    name: accessibleName,
    exact: true,
  });
  const playButton = page.getByRole("button", {
    name: /^(?:▶ Play|Play replay)$/,
    exact: true,
  });
  await expect(pauseButton.or(playButton)).toBeVisible();
  if (await pauseButton.isVisible()) {
    // Next.js dev tools occupy this mobile corner in local verification.
    await pauseButton.click({ force: true });
  }
}

async function assertCompletedFormatReplayProgression(
  page: Page,
  replayShell: Locator,
  scenario: ReturnType<typeof createFormatKernelViewerScenario>,
): Promise<void> {
  await pauseAutoplay(page, "⏸ Pause");
  const replayStart = page.getByRole("button", { name: "Go to replay start" });
  if (await replayStart.isEnabled()) await replayStart.click();
  const initial = await replayPlayerCounts(replayShell);

  const aggregate = replayShell.locator('[data-format-cue="format_aggregate"]');
  await advanceUntilVisible(page, aggregate, "format aggregate");
  await expect(aggregate.locator("[data-ledger-voter]")).toHaveCount(0);

  // Every accepted ballot remains a separate roster-ordered speech beat.
  // Expected speakers/targets come from fixture events, never transcript prose.
  for (const voter of scenario.roster) {
    const ballot = scenario.decisions.find(event => event.type === "format.ballot_cast" && event.payload.voterId === voter.id);
    if (ballot?.type !== "format.ballot_cast") continue;
    const target = scenario.roster.find(player => player.id === ballot.payload.targetId)!;
    await page.keyboard.press("ArrowRight");
    await assertSoloBallot(page, voter.name, target.name);
  }

  const elimination = replayShell.locator(
    '[data-format-cue="format_elimination"]',
  );
  await advanceUntilVisible(page, elimination, "format elimination");
  await expect(elimination.getByText(/ is eliminated$/)).toBeVisible();
  const resolved = await replayPlayerCounts(replayShell);
  expect(resolved.alive).toBe(initial.alive - 1);
  expect(resolved.out).toBe(initial.out + 1);
}

async function replayPlayerCounts(
  replayShell: Locator,
): Promise<{ alive: number; out: number }> {
  const count = async (label: "In" | "Out") => {
    const value = await replayShell
      .getByLabel(new RegExp(`^\\d+ ${label}$`))
      .locator("strong:visible")
      .textContent();
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new Error(`Replay ${label} count is not canonical: ${value ?? "missing"}.`);
    }
    return parsed;
  };
  return {
    alive: await count("In"),
    out: await count("Out"),
  };
}

async function assertCanonicalPointerLanding(stage: Locator): Promise<void> {
  const accepted = await acceptedTarget(stage);
  const finalCandidate = stage.locator(
    '[data-pointer-cycle-candidate="true"][data-canonical-target="true"]',
  );
  await expect(finalCandidate).toHaveCount(1);
  await expect(finalCandidate).toHaveAttribute(
    "data-pointer-candidate-id",
    accepted,
  );
  await expect(stage.locator(`[data-board-member="${accepted}"]`)).toHaveCount(1);
}

async function acceptedTarget(stage: Locator): Promise<string> {
  const value = await stage.locator("[data-accepted-target]").getAttribute(
    "data-accepted-target",
  );
  if (!value) throw new Error("Accepted Safety Bounce target is not explicit.");
  return value;
}

async function assertBoardPartition(stage: Locator): Promise<string[]> {
  const ids = await stage.locator("[data-board-member]").evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-board-member") ?? ""),
  );
  expect(ids.length).toBeGreaterThan(2);
  expect(new Set(ids).size).toBe(ids.length);
  await expect(stage.locator('[data-lane="safe"]')).toHaveCount(1);
  await expect(stage.locator('[data-lane="vulnerable"]')).toHaveCount(1);
  await expect(stage.locator('[data-lane="bench"]')).toHaveCount(1);
  await expect(stage.locator("[data-center-actor]")).toHaveCount(1);
  return [...ids].sort();
}

async function assertInsideViewport(
  stage: Locator,
  viewportWidth: number,
): Promise<void> {
  const boxes = await stage.locator("[data-board-member]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    }),
  );
  for (const box of boxes) {
    expect(box.width).toBeGreaterThan(0);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(viewportWidth);
  }
}

async function captureSettledScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.screenshot({
    path: testInfo.outputPath(name),
    animations: "disabled",
  });
}

async function assertLocatorInsideViewport(
  locator: Locator,
  viewportWidth: number,
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.width).toBeGreaterThan(0);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth);
}

function viewerUrl(pathname: string): string {
  if (!harness) throw new Error("Format viewer harness is not ready");
  return new URL(pathname, harness.webUrl).toString();
}

async function startLocalFormatViewerHarness(): Promise<{
  process: LocalHarnessProcess;
  harness: LocalFormatViewerHarness;
}> {
  return startLocalHarness<LocalFormatViewerHarness>({
    script: "packages/api/src/e2e/format-aware-game-viewer-harness.ts",
    readyPrefix: "E2E_FORMAT_VIEWER_READY ",
    startupTimeoutMs: 160_000,
    errorLabel: "Local format viewer harness exited before it was ready.",
  });
}

async function stopLocalFormatViewerHarness(
  child: LocalHarnessProcess,
): Promise<void> {
  await stopLocalHarness(child);
}
