import { expect, test, type Locator, type Page } from "@playwright/test";

const RUN_FORMAT_VIEWER = process.env.PLAYWRIGHT_FORMAT_VIEWER === "1";
const FORMAT_VIEWER_SLUG =
  process.env.PLAYWRIGHT_FORMAT_VIEWER_SLUG ?? "young-ruby-isle";

test.describe("format-aware game viewer", () => {
  test.skip(
    !RUN_FORMAT_VIEWER,
    "Set PLAYWRIGHT_FORMAT_VIEWER=1 against the local persisted fixture database.",
  );
  test.describe.configure({ mode: "serial", retries: 0 });

  test("settles canonical Safety Bounce choreography through shared replay controls", async ({
    page,
  }) => {
    await page.clock.install();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/games/${FORMAT_VIEWER_SLUG}/replay`, {
      waitUntil: "domcontentloaded",
    });
    await pauseAutoplay(page);

    const pointerStage = page.locator('[data-format-cue="safety_bounce_pointer"]');
    await advanceUntilVisible(page, pointerStage, "Safety Bounce pointer");
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

    const fastestSpeed = page.getByRole("button", { name: "4×", exact: true });
    await expect(fastestSpeed).toBeVisible();
    await fastestSpeed.click();
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
  });

  test("preserves the same semantic board and canonical landing under reduced motion", async ({
    page,
  }) => {
    await page.clock.install();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/games/${FORMAT_VIEWER_SLUG}/replay`, {
      waitUntil: "domcontentloaded",
    });
    await pauseAutoplay(page);

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
    await page.clock.runFor(250);
  }
  throw new Error(
    `${stageLabel} did not appear for persisted fixture ${FORMAT_VIEWER_SLUG}.`,
  );
}

async function pauseAutoplay(page: Page): Promise<void> {
  const pauseButton = page.getByRole("button", {
    name: "⏸ Pause",
    exact: true,
  });
  await expect(pauseButton).toBeVisible();
  await pauseButton.click();
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
