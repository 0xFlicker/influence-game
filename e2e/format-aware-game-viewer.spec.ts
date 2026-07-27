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
  formatResultPattern,
  installDeterministicClassicGame,
  installDeterministicCompletedClassicGame,
  installDeterministicFormatGame,
} from "./format-aware-game-viewer.fixtures";

const RUN_FORMAT_VIEWER = process.env.PLAYWRIGHT_FORMAT_VIEWER === "1";
const FORMAT_VIEWER_SLUG =
  process.env.PLAYWRIGHT_FORMAT_VIEWER_SLUG ?? "young-ruby-isle";
const CLASSIC_VIEWER_SLUG =
  process.env.PLAYWRIGHT_CLASSIC_VIEWER_SLUG ?? "edge-smoke-dusk";
const COMPLETED_SHARED_SCENARIO_IDS = [
  "save_or_eliminate_clear",
  "vote_bomb_clear",
  "safety_bounce_tie",
] as const satisfies readonly FormatKernelViewerScenarioId[];
const SHARED_FORMAT_NAMES = COMPLETED_SHARED_SCENARIO_IDS.map((scenarioId) => {
  const selectedFormatId = createFormatKernelViewerScenario(
    scenarioId,
  ).expected.selectedFormatId;
  if (!selectedFormatId) throw new Error(`Missing selected format for ${scenarioId}`);
  return displayNameForFormat(selectedFormatId);
});
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
    formats: ["Save-or-Eliminate", "Safety Bounce"],
  },
] as const;
const FORMAT_BROWSER_MATRIX = [
  {
    scenarioId: "save_or_eliminate_clear",
    slug: "deterministic-save-or-eliminate",
    formatName: "Save-or-Eliminate",
  },
  {
    scenarioId: "vote_bomb_clear",
    slug: "deterministic-vote-bomb",
    formatName: "Vote Bomb",
  },
  {
    scenarioId: "safety_bounce_tie",
    slug: "deterministic-safety-bounce",
    formatName: "Safety Bounce",
  },
] as const satisfies readonly {
  scenarioId: FormatKernelViewerScenarioId;
  slug: string;
  formatName: string;
}[];

test.describe("format-aware game viewer", () => {
  test.skip(
    !RUN_FORMAT_VIEWER,
    "Set PLAYWRIGHT_FORMAT_VIEWER=1 against the local persisted fixture database.",
  );
  test.describe.configure({ mode: "serial", retries: 0 });

  for (const entry of FORMAT_BROWSER_MATRIX) {
    test(`${entry.formatName} hydrates live current state and retains completed replay/results`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      const scenario = createFormatKernelViewerScenario(entry.scenarioId);
      const liveDecisionCount = scenario.decisions.length - 1;
      await installDeterministicFormatGame(page, {
        slug: entry.slug,
        scenarioId: entry.scenarioId,
        status: "in_progress",
        initialDecisionCount: liveDecisionCount,
      });

      await page.goto(`/games/${entry.slug}`, {
        waitUntil: "domcontentloaded",
      });
      const liveShell = page.getByTestId("match-watch-shell");
      await expect(liveShell).toBeVisible();
      await expect(liveShell).toHaveAttribute("data-watch-mode", "live");
      await expect(liveShell.getByText("Format Resolution", { exact: true }).first())
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
        reloadedShell.getByText("Format Resolution", { exact: true }).first(),
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
      await page.goto(`/games/${replaySlug}/replay`, {
        waitUntil: "domcontentloaded",
      });
      const replayShell = page.getByTestId("match-watch-shell");
      await expect(replayShell).toBeVisible();
      await expect(replayShell).toHaveAttribute("data-watch-mode", "replay");
      await expect(
        replayShell.getByText(entry.formatName, { exact: true }).first(),
      ).toBeVisible();
      await assertCompletedFormatReplayProgression(page, replayShell);

      await page.goto("/games/dark-coral-horn/results", {
        waitUntil: "domcontentloaded",
      });
      const results = page.getByTestId("completed-results-review");
      await expect(results).toBeVisible();
      await expect(results.getByText(formatResultPattern(entry.formatName)).first())
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
    await page.goto("/games/deterministic-safety-reconnect", {
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
    const rollCall = page.locator('[data-format-cue="format_roll_call"]');
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
      await page.goto(`/games/${slug}`, { waitUntil: "domcontentloaded" });
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
      await page.goto(`/games/${slug}`, { waitUntil: "domcontentloaded" });
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
    await page.goto(`/games/${FORMAT_VIEWER_SLUG}/replay`, {
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
    const rollCall = page.locator('[data-format-cue="format_roll_call"]');
    await advanceUntilVisible(page, rollCall, "format roll call");
    await expect(rollCall.locator("[data-ledger-voter]")).toHaveCount(1);
    await page.keyboard.press("ArrowRight");
    await expect(rollCall.locator("[data-ledger-voter]")).toHaveCount(2);
    await expect(
      rollCall.locator('[data-ledger-current="false"]'),
    ).toHaveCount(1);
    await expect(
      rollCall.locator('[data-ledger-current="true"]'),
    ).toHaveCount(1);
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
    await page.goto(`/games/${FORMAT_VIEWER_SLUG}/replay`, {
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
      await page.goto(`/games/${fixture.slug}/results`, {
        waitUntil: "domcontentloaded",
      });
      const review = page.getByTestId("completed-results-review");
      await expect(review).toBeVisible();
      for (const formatName of fixture.formats) {
        await expect(review.getByText(formatResultPattern(formatName)).first())
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
    await page.goto("/games/dark-coral-horn/results", {
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
    await page.goto("/games/dark-coral-horn/replay", {
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
    const rollCall = page.locator('[data-format-cue="format_roll_call"]');
    await expect(rollCall).toBeVisible();
    await expect(rollCall.locator("[data-ledger-voter]")).toHaveCount(1);
    const voterIds = await rollCall.locator("[data-ledger-voter]").evaluateAll(
      (nodes) => nodes.map((node) => node.getAttribute("data-ledger-voter")),
    );
    expect(voterIds.every(Boolean)).toBe(true);
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
    await page.goto("/games/deterministic-classic-active", {
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
    await page.goto("/games/deterministic-classic-suspended", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Game failed", { exact: true })).toBeVisible();
    await expect(page.locator("[data-format-terminal-snapshot]")).toHaveCount(0);

    await installDeterministicClassicGame(page, {
      slug: "deterministic-classic-cancelled",
      status: "cancelled",
      gameKernel: "classic",
    });
    await page.goto("/games/deterministic-classic-cancelled", {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByText("Game unavailable", { exact: true })).toBeVisible();
    await expect(page.locator("[data-format-terminal-snapshot]")).toHaveCount(0);

    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicCompletedClassicGame(
      page,
      CLASSIC_VIEWER_SLUG,
    );
    await page.goto(`/games/${CLASSIC_VIEWER_SLUG}/replay`, {
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

    await page.goto(`/games/${CLASSIC_VIEWER_SLUG}/results`, {
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

async function advanceUntilVisible(
  page: Page,
  locator: Locator,
  stageLabel: string,
  maxAdvances = 1_500,
): Promise<void> {
  for (let index = 0; index < maxAdvances; index += 1) {
    if (await locator.isVisible().catch(() => false)) return;
    await page.keyboard.press("ArrowRight");
    // Room-transition overlays intentionally block keyboard navigation. Let
    // their deterministic timer settle before the next manual step.
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
): Promise<void> {
  await pauseAutoplay(page, "⏸ Pause");
  const replayStart = page.getByRole("button", { name: "Go to replay start" });
  if (await replayStart.isEnabled()) await replayStart.click();
  const initial = await replayPlayerCounts(replayShell);

  const aggregate = replayShell.locator('[data-format-cue="format_aggregate"]');
  await advanceUntilVisible(page, aggregate, "format aggregate");
  await expect(aggregate.locator("[data-ledger-voter]")).toHaveCount(0);

  await page.keyboard.press("ArrowRight");
  const rollCall = replayShell.locator('[data-format-cue="format_roll_call"]');
  await expect(rollCall).toBeVisible();
  await expect(rollCall.locator("[data-ledger-voter]")).toHaveCount(1);

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
  const count = async (label: "Alive" | "Out") => {
    const value = await replayShell
      .getByTestId(`match-watch-count-${label.toLowerCase()}`)
      .locator("strong")
      .textContent();
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
      throw new Error(`Replay ${label} count is not canonical: ${value ?? "missing"}.`);
    }
    return parsed;
  };
  return {
    alive: await count("Alive"),
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
