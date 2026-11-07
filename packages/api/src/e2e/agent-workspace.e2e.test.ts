import { afterAll, beforeAll, expect, test } from "bun:test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { mkdir } from "node:fs/promises";
import type { Browser, Page } from "puppeteer";
import { schema } from "../db/index.js";
import { processMockCharacterReference } from "../__tests__/character-generation-fixture.js";
import { createOwnedAgentProfile } from "../services/agent-profile-management.js";
import { publishScreenedAgent } from "../services/agent-screening-publication.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import {
  createAdminUser,
  createPlayerUser,
  type PlayerUserResult,
} from "./test-auth.js";
import {
  createAuthenticatedPage,
  launchBrowser,
  closeBrowser,
} from "./test-browser.js";
import {
  createIsolatedTestDb,
  destroyIsolatedTestDb,
  type TestDB,
} from "./test-db.js";
import {
  startTestServers,
  stopTestServers,
  type TestServerHandles,
} from "./test-server.js";
import { cleanupE2eResources } from "./cleanup.js";

let database: TestDB,
  servers: TestServerHandles,
  browser: Browser,
  owner: PlayerUserResult,
  agentId: string;
const proof = new URL("../../../../.renders/agent-workspace/", import.meta.url)
  .pathname;
beforeAll(async () => {
  process.env.JWT_SECRET = "agent-workspace-test-secret";
  database = await createIsolatedTestDb();
  const admin = await createAdminUser(database.db);
  owner = await createPlayerUser(database.db, 1);
  await recordCurrentLegalAcceptance(
    database.db,
    owner.userId,
    "existing_account",
    "0123456789abcdef0123456789abcdef01234567",
  );
  const body = await Bun.file(
    new URL(
      "../../../web/public/avatars/personas/full-body-v1/diplomat.webp",
      import.meta.url,
    ),
  ).bytes();
  const size = await sharp(body).metadata();
  const headPosition = {
    sourceUrl: "/avatars/personas/full-body-v1/diplomat.webp",
    sourceHash: createHash("sha256").update(body).digest("hex"),
    sourceWidth: size.width!,
    sourceHeight: size.height!,
    rect: { x: 0.35, y: 0.03, width: 0.3, height: 0.18 },
  };
  const created = await createOwnedAgentProfile(
    database.db,
    { userId: owner.userId },
    {
      name: "Mira Voss",
      gender: "female",
      personality: "Patient, observant, and quietly theatrical.",
      backstory: "A former stage magician.",
      strategyStyle: "Build trust through commitments.",
      werewolfStrategyStyle: "Test claims before voting.",
      avatarUrl: "/avatars/personas/diplomat.png",
      fullBodyReferenceUrl: "/avatars/personas/full-body-v1/diplomat.webp",
      headPosition,
    },
  );
  agentId = created.profile.id;
  await database.db
    .update(schema.agentScreenings)
    .set({ status: "completed", recommendation: "no_concern" })
    .where(
      eq(
        schema.agentScreenings.contentRevisionId,
        created.profile.latestContentRevisionId!,
      ),
    );
  await publishScreenedAgent(
    database.db,
    created.profile.latestContentRevisionId!,
  );
  servers = await startTestServers({
    databaseUrl: database.databaseUrl,
    adminAddress: admin.wallet.address,
    jwtSecret: process.env.JWT_SECRET,
    logDirectory: proof + "logs",
  });
  browser = await launchBrowser();
  await mkdir(proof, { recursive: true });
}, 120_000);
afterAll(async () => {
  await cleanupE2eResources([
    [
      "browser",
      async () => {
        if (browser) await closeBrowser(browser);
      },
    ],
    [
      "servers",
      async () => {
        if (servers) await stopTestServers(servers);
      },
    ],
    [
      "database",
      async () => {
        if (database) await destroyIsolatedTestDb(database.databaseUrl);
      },
    ],
  ]);
}, 60_000);
async function button(page: Page, label: string) {
  const selector = `[...(document.querySelector("dialog[open]")??document.querySelector('[role="dialog"][aria-modal="true"]')??document).querySelectorAll("button")].find(button=>(button.textContent?.trim()===${JSON.stringify(label)}||button.getAttribute("aria-label")===${JSON.stringify(label)})&&!button.matches(":disabled")&&button.checkVisibility())`;
  try {
    await page.waitForFunction(selector);
  } catch (error) {
    await page.screenshot({
      path:
        proof +
        "failure-" +
        label.toLowerCase().replace(/[^a-z]/g, "") +
        ".png",
      fullPage: true,
    });
    throw new Error(
      `Button ${label} unavailable: ${await page.$eval("body", (element) => element.innerText)}`,
      { cause: error },
    );
  }
  await page.evaluate(selector + ".click()");
}

test("management → Edit → Guided/Advanced → review → Reviewing preserves the public version", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/dashboard/agents",
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    await page.waitForFunction('document.body.innerText.includes("Mira Voss")');
    await page.screenshot({ path: proof + "management.png", fullPage: true });
    await button(page, "Edit");
    await page.waitForSelector("#agent-personality");
    for (const mode of ["Advanced", "Guided"]) {
      await button(page, mode);
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1280, height: 800 },
        { width: 768, height: 1024 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewport(viewport);
        await page.screenshot({
          path: proof + `edit-${mode.toLowerCase()}-${viewport.width}.png`,
          fullPage: true,
        });
        expect(
          await page.evaluate(
            "document.documentElement.scrollWidth<=innerWidth",
          ),
        ).toBe(true);
        if (viewport.width >= 1280)
          expect(
            await page.evaluate(
              '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").getBoundingClientRect().bottom <= innerHeight',
            ),
          ).toBe(true);
      }
    }
    await page.setViewport({ width: 1440, height: 900 });
    await button(page, "Advanced");
    await page.evaluate(
      'const input=document.querySelector("#agent-personality");Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(input,"A skeptical magician who asks precise questions.");input.dispatchEvent(new Event("input",{bubbles:true}));',
    );
    await button(page, "Guided");
    await button(page, "Advanced");
    expect(
      await page.$eval(
        "#agent-personality",
        (element) => (element as unknown as { value: string }).value,
      ),
    ).toBe("A skeptical magician who asks precise questions.");
    await button(page, "Review");
    await page.waitForFunction(
      'document.body.innerText.includes("Review changes")',
    );
    expect(
      await page.$eval("body", (element) => element.textContent),
    ).toContain("Patient, observant, and quietly theatrical.");
    await page.screenshot({ path: proof + "review.png", fullPage: true });
    await button(page, "Save");
    await page.waitForFunction(
      'location.pathname==="/dashboard/agents"&&document.body.innerText.includes("Reviewing")',
    );
    const [profile] = await database.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, agentId));
    expect(profile!.personality).toBe(
      "Patient, observant, and quietly theatrical.",
    );
    expect(profile!.latestContentRevisionId).not.toBe(
      profile!.contentRevisionId,
    );
    await page.screenshot({ path: proof + "reviewing.png", fullPage: true });
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({
      path: proof + "management-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        "document.documentElement.scrollWidth<=window.innerWidth",
      ),
    ).toBe(true);
  } finally {
    await page.close();
  }
}, 120_000);

async function fill(page: Page, selector: string, value: string) {
  await page.evaluate(
    `{const field=document.querySelector(${JSON.stringify(selector)});const prototype=field.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value").set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event("input",{bubbles:true}));}`,
  );
}
test("Advanced creation persists voice and generated artwork across navigation before explicit selection", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/agents/create",
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    await button(page, "Advanced");
    await page.waitForSelector("#agent-name", { visible: true });
    await fill(page, "#agent-name", "Arden Workshop");
    await fill(page, "#agent-personality", "A precise, patient investigator.");
    await button(page, "Non-binary");
    await page.select("#agent-archetype", "strategic");
    await page.evaluate(
      'const label=[...document.querySelectorAll("label")].find(label=>label.textContent==="Voice");document.getElementById(label.htmlFor).click();',
    );
    await button(page, "Ara");
    await button(page, "Guided");
    await button(page, "Advanced");
    expect(
      await page.$eval(
        "#agent-name",
        (element) => (element as unknown as { value: string }).value,
      ),
    ).toBe("Arden Workshop");
    await button(page, "Appearance");
    await button(page, "Generate");
    let job: typeof schema.characterReferenceJobs.$inferSelect | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      const rows = await database.db
        .select()
        .from(schema.characterReferenceJobs)
        .where(eq(schema.characterReferenceJobs.userId, owner.userId));
      job = rows.find((row) => !row.agentId);
      if (job) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(job).toBeDefined();
    await button(page, "Close");
    await page.waitForFunction('location.pathname==="/dashboard/agents"');
    const art = await Bun.file(
      new URL(
        "../../../web/public/avatars/personas/full-body-v1/strategic.webp",
        import.meta.url,
      ),
    ).bytes();
    await processMockCharacterReference(database.db, art);
    await page.goto(servers.webUrl + "/agents/create");
    await button(page, "Resume");
    await button(page, "Select");
    try {
      await page.waitForSelector("dialog[open]");
    } catch (error) {
      await page.screenshot({
        path: proof + "failure-portrait.png",
        fullPage: true,
      });
      throw new Error(
        await page.$eval("body", (element) => element.innerText),
        { cause: error },
      );
    }
    await button(page, "Confirm");
    await page.waitForFunction('!document.querySelector("dialog[open]")');
    await button(page, "Review");
    await page.screenshot({
      path: proof + "creation-review.png",
      fullPage: true,
    });
    await button(page, "Create");
    await page.waitForFunction(
      'location.pathname==="/dashboard/agents"&&document.body.innerText.includes("Arden Workshop")',
    );
    const [created] = await database.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.name, "Arden Workshop"));
    expect(created!.contentRevisionId).toBeNull();
    expect(created!.latestContentRevisionId).toBeTruthy();
    expect(
      (
        await database.db
          .select()
          .from(schema.characterReferenceJobs)
          .where(eq(schema.characterReferenceJobs.id, job!.id))
      )[0]!.status,
    ).toBe("selected");
    expect(
      await database.db.select().from(schema.visualRenderAttempts),
    ).toHaveLength(2);
    await database.db
      .update(schema.agentScreenings)
      .set({ status: "completed", recommendation: "no_concern" })
      .where(
        eq(
          schema.agentScreenings.contentRevisionId,
          created!.latestContentRevisionId!,
        ),
      );
    await publishScreenedAgent(database.db, created!.latestContentRevisionId!);
    expect(
      (
        await database.db
          .select()
          .from(schema.agentVoices)
          .where(eq(schema.agentVoices.agentProfileId, created!.id))
      )[0]!.assignment.voiceId,
    ).toBe("ara");
  } finally {
    await page.close();
  }
}, 120_000);

test("creation layout at desktop and mobile sizes", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/agents/create",
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    await page.waitForSelector(
      'textarea[aria-label="Message the character assistant"]',
      { visible: true },
    );
    await page.waitForSelector('section[aria-label="Model and voice"]', {
      visible: true,
    });
    expect(await page.$('input[type="file"]')).toBeNull();
    expect(
      await page.$eval("body", (element) => element.textContent),
    ).not.toContain("Use an exact model ID");
    expect(
      await page.$eval("body", (element) => element.textContent),
    ).not.toContain("Best effort.");
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewport(viewport);
      await page.screenshot({
        path: proof + `create-guided-${viewport.width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate("document.documentElement.scrollWidth<=innerWidth"),
      ).toBe(true);
      if (viewport.width >= 1280)
        expect(
          await page.evaluate(
            '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").getBoundingClientRect().bottom <= innerHeight',
          ),
        ).toBe(true);
    }
    expect(
      await page.evaluate(
        '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").disabled',
      ),
    ).toBe(true);
    await button(page, "Advanced");
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 800 },
      { width: 768, height: 1024 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewport(viewport);
      await page.screenshot({
        path: proof + `create-advanced-${viewport.width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate("document.documentElement.scrollWidth<=innerWidth"),
      ).toBe(true);
      if (viewport.width >= 1280)
        expect(
          await page.evaluate(
            '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").getBoundingClientRect().bottom <= innerHeight',
          ),
        ).toBe(true);
    }
    await button(page, "Cancel");
  } finally {
    await page.close();
  }
}, 120000);

async function mockCharacterAssistant(
  page: Page,
  name: string,
  personality: string,
) {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.pathname === "/api/agent-profiles/creation-assistant" &&
      request.method() === "POST"
    ) {
      const body = JSON.parse(request.postData()!);
      void request.respond({
        status: 200,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": new URL(servers.webUrl!).origin,
          "Access-Control-Allow-Credentials": "true",
        },
        body: JSON.stringify({
          command:
            body.stage === "appearance"
              ? "generate_appearance"
              : "revise_character",
          reply: "",
        }),
      });
    } else if (
      url.pathname === "/api/agent-profiles/generate" &&
      request.method() === "POST"
    ) {
      const body = JSON.parse(request.postData()!);
      void request.respond({
        status: 200,
        contentType: "application/json",
        headers: {
          "Access-Control-Allow-Origin": new URL(servers.webUrl!).origin,
          "Access-Control-Allow-Credentials": "true",
        },
        body: JSON.stringify({
          introQuips: [],
          performanceInstructions: "Calm delivery",
          visualDesign: "An adult investigator in a bronze coat",
          name,
          backstory: "A former stage magician.",
          strategyStyle: "Build trust through commitments.",
          werewolfStrategyStyle: "Test claims before voting.",
          personaKey: "strategic",
          gender: "non-binary",
          ...body.existingProfile,
          personality,
        }),
      });
    } else void request.continue();
  });
}
async function latestPendingJob(name: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const jobs = await database.db
      .select()
      .from(schema.characterReferenceJobs)
      .where(eq(schema.characterReferenceJobs.userId, owner.userId));
    for (const job of jobs.filter((row) => row.status === "queued")) {
      const { readJson } = await import("../services/payload-storage.js");
      if ((await readJson(job.input)).name === name) return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Expected a durable generated artwork job");
}
test("Guided creation generates a character and artwork, confirms portrait, reviews and creates", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + "/agents/create",
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    await page.waitForSelector('section[aria-label="Model and voice"]', {
      visible: true,
    });
    await mockCharacterAssistant(
      page,
      "Rowan Guided",
      "A curious investigator who listens carefully.",
    );
    await fill(
      page,
      "#agent-creation-message",
      "Create Rowan, a patient investigator.",
    );
    await button(page, "Send");
    await page.waitForFunction(
      'document.querySelector("h1")?.textContent==="Rowan Guided"',
    );
    await button(page, "Continue");
    await fill(
      page,
      "#agent-creation-message",
      "A bronze coat, full body, transparent background.",
    );
    await button(page, "Send");
    const job = await latestPendingJob("Rowan Guided");
    const before = await database.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.name, "Rowan Guided"));
    expect(before).toHaveLength(0);
    expect(
      await page.evaluate(
        '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").disabled',
      ),
    ).toBe(true);
    await page.setViewport({ width: 1280, height: 800 });
    await page.screenshot({
      path: proof + "create-guided-generating.png",
      fullPage: true,
    });
    const art = await Bun.file(
      new URL(
        "../../../web/public/avatars/personas/full-body-v1/strategic.webp",
        import.meta.url,
      ),
    ).bytes();
    await processMockCharacterReference(database.db, art);
    await page.waitForFunction(
      'document.body.innerText.includes("Artwork ready")',
    );
    expect(
      await page.evaluate(
        '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Review").disabled',
      ),
    ).toBe(true);
    await button(page, "Select");
    try {
      await page.waitForSelector("dialog[open]");
    } catch (error) {
      await page.screenshot({
        path: proof + "failure-portrait.png",
        fullPage: true,
      });
      throw new Error(
        await page.$eval("body", (element) => element.innerText),
        { cause: error },
      );
    }
    await button(page, "Confirm");
    await page.waitForFunction('!document.querySelector("dialog[open]")');
    await button(page, "Review");
    await page.waitForSelector('[role="dialog"][aria-label="Review changes"]');
    await button(page, "Create");
    await page.waitForFunction(
      'location.pathname==="/dashboard/agents"&&document.body.innerText.includes("Rowan Guided")',
    );
    const [created] = await database.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.name, "Rowan Guided"));
    expect(created!.contentRevisionId).toBeNull();
    expect(created!.latestContentRevisionId).toBeTruthy();
    expect(
      (
        await database.db
          .select()
          .from(schema.characterReferenceJobs)
          .where(eq(schema.characterReferenceJobs.id, job.id))
      )[0]!.status,
    ).toBe("selected");
  } finally {
    await page.close();
  }
}, 120000);

test("Guided update changes text without generating artwork and keeps accepted content usable", async () => {
  const page = await createAuthenticatedPage(
    browser,
    owner.jwt,
    servers.webUrl + `/dashboard/agents/${agentId}/edit?profileRequest=1`,
    { privateKey: owner.wallet.privateKey },
  );
  await page.emulateMediaFeatures([
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  try {
    await page.waitForSelector("#agent-creation-message", { visible: true });
    await mockCharacterAssistant(
      page,
      "Mira Voss",
      "A warm investigator who invites precise answers.",
    );
    const jobsBefore = await database.db
      .select()
      .from(schema.characterReferenceJobs);
    await fill(
      page,
      "#agent-creation-message",
      "Make her warmer, keeping her current appearance.",
    );
    await button(page, "Send");
    await page.waitForFunction(
      'document.body.innerText.includes("Does that feel right")',
    );
    await button(page, "Review");
    await page.waitForSelector('[role="dialog"][aria-label="Review changes"]');
    expect(
      await page.$eval(
        '[role="dialog"][aria-label="Review changes"]',
        (element) => element.textContent,
      ),
    ).toContain("A warm investigator who invites precise answers.");
    await button(page, "Save");
    await page.waitForFunction('location.pathname==="/dashboard/agents"');
    const [profile] = await database.db
      .select()
      .from(schema.agentProfiles)
      .where(eq(schema.agentProfiles.id, agentId));
    expect(profile!.personality).toBe(
      "Patient, observant, and quietly theatrical.",
    );
    expect(
      await database.db.select().from(schema.characterReferenceJobs),
    ).toHaveLength(jobsBefore.length);
  } finally {
    await page.close();
  }
}, 120000);
