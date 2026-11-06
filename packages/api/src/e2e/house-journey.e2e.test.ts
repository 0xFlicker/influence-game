import { rejectOptionalAnalytics } from "./test-browser.js";
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser, HTTPRequest, Page } from "puppeteer";
import { DEFAULT_MODEL_CATALOG_ID, GameState } from "@influence/engine";
import { werewolfResultsFixture, completedWerewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { insertCanonicalEventRows, insertOwner, withJuryWinner, withRetrospective } from "../__tests__/durable-run-test-utils.js";
import { schema } from "../db/index.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { createPlayerUser } from "./test-auth.js";
import { recordCurrentLegalAcceptance } from "../services/legal-acceptance.js";
import { launchBrowser, closeBrowser, createAuthenticatedPage } from "./test-browser.js";
import { cleanupE2eResources } from "./cleanup.js";
let database: TestDB, servers: TestServerHandles, browser: Browser;
const savedRole = process.env.INFLUENCE_API_ROLE;
const savedSecret = process.env.JWT_SECRET;
let owner: Awaited<ReturnType<typeof createPlayerUser>>;
beforeAll(async () => {
  process.env.INFLUENCE_API_ROLE = "gateway";
  database = await createIsolatedTestDb();
  process.env.JWT_SECRET = "w7b-fixture-secret";
  owner = await createPlayerUser(database.db,0,{handle:"history-owner",displayName:"History Owner"});
  await recordCurrentLegalAcceptance(database.db,owner.userId,"existing_account","0123456789abcdef0123456789abcdef01234567");
  await database.db.insert(schema.agentProfiles).values({id:"history-agent",userId:owner.userId,name:"Current Name",personality:"Patient"});
  const date="2026-10-05T12:00:00.000Z";
  await database.db.insert(schema.games).values({id:"history-influence",slug:"history-influence",status:"completed",config:JSON.stringify({providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID}]}),endedAt:"2026-10-04T12:00:00.000Z"});
  await database.db.insert(schema.gamePlayers).values({id:"history-seat",gameId:"history-influence",userId:owner.userId,agentProfileId:"history-agent",persona:JSON.stringify({name:"Frozen Influence"}),agentConfig:"{}"});
  await database.db.insert(schema.gameResults).values({id:"history-result",gameId:"history-influence",winnerId:"history-seat",roundsPlayed:3,finishedAt:date,tokenUsage:"{}"});
  const influence = new GameState([{id:"history-seat",name:"Frozen Influence"},
    {id:"history-atlas",name:"Atlas"},{id:"history-mira",name:"Mira"},{id:"history-vera",name:"Vera"}], {gameId:"history-influence"});
  influence.startRound();
  const influenceEvents = withRetrospective(withJuryWinner(influence.getCanonicalEvents(), "history-seat"));
  const ownerEpoch = await insertOwner(database.db, "history-influence", {status:"closed",lastPersistedEventSequence:influenceEvents.length});
  await insertCanonicalEventRows(database.db, "history-influence", ownerEpoch, influenceEvents);
  for (const [slug,status,visibility] of [
    ["old-lantern-village","completed","public"],["old-hidden-faces","completed","public"],
    ["new-village-casting","waiting","public"],["new-village-live","in_progress","public"],
    ["secret-village-link","completed","unlisted"],["hidden-village","completed","public"],
  ] as const) {
    await database.db.insert(schema.games).values({id:slug,slug,gameKind:"werewolf",status,endedAt:status === "completed" ? date : null,minPlayers:6,maxPlayers:6,startedAt:status === "waiting" ? null : new Date().toISOString(),hiddenAt:slug === "hidden-village" ? new Date().toISOString() : null,config:JSON.stringify({visibility,preset:"one_wolf",providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID}]})});
    if (status !== "waiting") {
      const events = status === "completed" ? await completedWerewolfResultsFixture("village",slug) : await werewolfResultsFixture("village",slug);
      if (events[0]?.type === "werewolf.started") events[0].payload.players[0]!.agentProfileId="history-agent";
      await database.db.insert(schema.werewolfEvents).values((status === "completed" ? events : events.slice(0,1)).map(event=>({gameId:slug,sequence:event.sequence,event})));
    }
  }
  await database.db.insert(schema.werewolfLobbySeats).values({ id: "casting-seat", gameId: "new-village-casting", agentProfileId: "history-agent" });
  await database.db.insert(schema.gameEpisodePresentations).values({gameId:"old-lantern-village",title:"Lanterns and Lies",description:"Six contrasting voices gather around the village table.",status:"ready",locked:true});
  servers = await startTestServers({databaseUrl:database.databaseUrl,jwtSecret:"w7b-fixture-secret",logDirectory:"/tmp/w7b-browser"});
  browser = await launchBrowser();
},240000);
afterAll(async () => {
  try { await cleanupE2eResources([
    ["browser",async()=>{if(browser)await closeBrowser(browser);}],
    ["servers",async()=>{if(servers)await stopTestServers(servers);}],
    ["database",async()=>{if(database)await destroyIsolatedTestDb(database.databaseUrl);}]
  ]); } finally { if(savedSecret === undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=savedSecret; if(savedRole === undefined)delete process.env.INFLUENCE_API_ROLE;else process.env.INFLUENCE_API_ROLE=savedRole; }
},60000);
async function text(page:Page,value:string) {
  try {
    await page.waitForFunction(`document.body.innerText.toLowerCase().includes(${JSON.stringify(value.toLowerCase())})`,{polling:100,timeout:30000});
  } catch (error) {
    console.error("Missing text", value, await page.evaluate("document.body.innerText"));
    throw error;
  }
}
test("old/new House cards, title search, stable links and responsive art",async()=>{
  const page=await browser.newPage();
  await rejectOptionalAnalytics(page);
  try {
    for(const width of [1440,390]) {
      await page.setViewport({width,height:1000,isMobile:width===390,hasTouch:width===390});
      await page.goto(`${servers.webUrl}/games`,{waitUntil:"domcontentloaded"});
      await page.waitForFunction(`Array.from(document.querySelectorAll('.episode-card[data-game-kind="werewolf"]')).some(card => card.innerText.includes('new-village-casting') && card.innerText.includes('1/6 joined') && card.querySelector('.episode-cast')?.innerText.includes('Current Name'))`);
      const viewAll = 'section[aria-label="Werewolf"] a[href="/games/type/werewolf"]';
      await page.waitForSelector(viewAll);
      await page.click(viewAll);
      await text(page,"Werewolf games");
      expect(new URL(page.url()).pathname).toBe('/games/type/werewolf');
      await page.waitForSelector('section[aria-label="Werewolf"] .episode-grid');
      expect(await page.$('section[aria-label="Werewolf"] .episode-rail')).toBeNull();
      await page.goBack({waitUntil:"domcontentloaded"});
      await page.waitForSelector(viewAll);
      await page.click(viewAll);
      await text(page,"Werewolf games");
      await text(page,"Lanterns and Lies");
      await page.waitForFunction(`Array.from(document.querySelectorAll('.episode-card[data-game-kind="werewolf"] .episode-frame.is-visible img.episode-scene')).length === 4 && Array.from(document.querySelectorAll('.episode-card[data-game-kind="werewolf"] .episode-frame.is-visible img.episode-scene')).every(img=>img.complete && img.naturalWidth > 0)`);
      expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
      expect(await page.evaluate(`document.body.innerText.includes('secret-village-link') || document.body.innerText.includes('hidden-village')`)).toBe(false);
      await page.screenshot({path:`/tmp/w7b-cards-${width}.png`,fullPage:true});
    }
    await page.type('input[aria-label="Search games"]','Lanterns and Lies');
    await page.waitForFunction(`document.querySelectorAll('.episode-card[data-game-kind="werewolf"]').length === 1`);
    const opensTouchPreview = await page.evaluate('matchMedia("(hover: none), (pointer: coarse)").matches');
    await page.locator('.episode-card-link[href="/games/old-lantern-village"]').click();
    if (opensTouchPreview) {
      const openGame = '.episode-modal-actions a[href="/games/old-lantern-village"]';
      await page.waitForSelector(openGame);
      await page.click(openGame);
    }
    await text(page,"Watch Mystery");
    expect(new URL(page.url()).pathname).toBe('/games/old-lantern-village');
    expect(await page.title()).toContain('Lanterns and Lies');
    expect(await page.evaluate(`document.querySelector('meta[property="og:image"]')?.content`)).toContain('/visual/werewolf/lantern-village.webp');
    await page.screenshot({path:'/tmp/w7b-entry-mobile.png',fullPage:true});
    await page.click('a[href="/games/old-lantern-village/results"]');
    await text(page,"The cast");await text(page,"Lanterns and Lies");
  } finally {await page.close();}
},120000);
test("anonymous Unlisted entry works, while hidden games stay unavailable",async()=>{
  const page=await browser.newPage();
  await rejectOptionalAnalytics(page);
  try {
    await page.goto(`${servers.webUrl}/games/secret-village-link`,{waitUntil:"domcontentloaded"});await text(page,"Watch Mystery");
    await page.goto(`${servers.webUrl}/games/hidden-village`,{waitUntil:"domcontentloaded"});await text(page,"Game not found");
  } finally {await page.close();}
},60000);

test("mixed profile and owner history filter in place at desktop/mobile widths",async()=>{
  const page=await browser.newPage();
  await rejectOptionalAnalytics(page);
  try {
    for (const width of [1440,390]) {
      await page.setViewport({width,height:1000});
      await page.goto(`${servers.webUrl}/profile/history-owner`,{waitUntil:"domcontentloaded"});
      await text(page,"Game history");await text(page,"Frozen Influence");
      expect(await page.evaluate("document.body.innerText.includes('Influence competitive record')")).toBe(true);
      expect(await page.evaluate("document.body.innerText.includes('secret-village-link')")).toBe(false);
      await page.click('a[href="/profile/history-owner?game=werewolf"]');
      await page.waitForFunction("location.search === '?game=werewolf' && !document.body.innerText.includes('Frozen Influence')");
      await text(page,"Lanterns and Lies");
      expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
      await page.screenshot({path:`/tmp/history-profile-${width}.png`,fullPage:true});
      await page.click('a[href="/games/old-lantern-village/results"]');await text(page,"The cast");
      await page.goto(`${servers.webUrl}/profile/history-owner?game=influence`,{waitUntil:"domcontentloaded"});await text(page,"Frozen Influence");
      await page.click('a[href="/games/history-influence/results"]');await text(page,"Frozen Influence");
    }
  } finally {await page.close();}
  const dashboard=await createAuthenticatedPage(browser,owner.jwt,`${servers.webUrl}/dashboard`,{privateKey:owner.wallet.privateKey});
  try {
    for(const width of [1440,390]) {
      await dashboard.setViewport({width,height:1000});
      await text(dashboard,"Game history");await text(dashboard,"secret-village-link");
      await dashboard.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Werewolf')?.click()");
      await dashboard.waitForFunction("!document.body.innerText.includes('Frozen Influence')");
      expect(await dashboard.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
      await dashboard.screenshot({path:`/tmp/history-dashboard-${width}.png`,fullPage:true});
      await dashboard.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='All games')?.click()");
      await text(dashboard,"Frozen Influence");
    }
    const priorLink = '[data-testid="dashboard-recent-result"] a[href^="/games/"]';
    await dashboard.waitForSelector(priorLink);
    const previousHref = await dashboard.$eval(priorLink, element => element.getAttribute("href"));
    expect(previousHref).toBeTruthy();
    const failHistory = (request: HTTPRequest) => {
      if (request.method() === "GET" && new URL(request.url()).pathname === "/api/player/games-page") {
        void request.respond({ status: 503, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ error: "Fixture unavailable" }) });
      } else void request.continue();
    };
    await dashboard.setRequestInterception(true);
    dashboard.on("request", failHistory);
    try {
      await dashboard.evaluate("window.dispatchEvent(new Event('auth:session-ready'))");
      await dashboard.waitForFunction("document.querySelector('[data-testid=dashboard-recent-result]')?.textContent?.includes('Failed to load game history.')");
      expect(await dashboard.$(priorLink)).toBeNull();
    } finally {
      dashboard.off("request", failHistory);
      await dashboard.setRequestInterception(false);
    }
  } finally {await dashboard.close();}
},180000);

test("dashboard fetches history pages only when requested and applies game filters before paging", async () => {
  const date = "2026-09-01T00:00:00.000Z";
  await database.db.insert(schema.games).values(Array.from({length: 45}, (_, i) => ({
    id: `paged-history-${i}`, slug: `paged-history-${i}`, status: "completed" as const,
    config: JSON.stringify({providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID}]}), endedAt: date,
  })));
  await database.db.insert(schema.gamePlayers).values(Array.from({length: 45}, (_, i) => ({
    id: `paged-seat-${i}`, gameId: `paged-history-${i}`, userId: owner.userId,
    agentProfileId: "history-agent", persona: JSON.stringify({name:`Paged ${i}`}), agentConfig:"{}",
  })));
  const dashboard = await createAuthenticatedPage(browser, owner.jwt, `${servers.webUrl}/dashboard`, {privateKey:owner.wallet.privateKey});
  try {
    const requests: string[] = [];
    dashboard.on("request", req => { const url = new URL(req.url()); if (req.method() === "GET" && url.pathname.startsWith("/api/player/games")) requests.push(url.pathname + url.search); });
    await dashboard.reload({waitUntil:"domcontentloaded"});
    await dashboard.waitForFunction("Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Load older games')");
    await Bun.sleep(400);
    expect(requests.some(url => url === "/api/player/games")).toBe(false);
    expect(requests.filter(url => new URL(url, "http://local").searchParams.has("cursor"))).toHaveLength(0);
    const nextPage = dashboard.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/player/games-page" && new URL(response.url()).searchParams.has("cursor"));
    await dashboard.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Load older games')?.click()");
    expect((await nextPage).ok()).toBe(true);
    await dashboard.waitForFunction("Array.from(document.querySelectorAll('button')).some(b => b.textContent === 'Load older games')");
    await Bun.sleep(400);
    expect(requests.filter(url => new URL(url, "http://local").searchParams.has("cursor"))).toHaveLength(1);
    const filteredPage = dashboard.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname === "/api/player/games-page" && new URL(response.url()).searchParams.get("game") === "werewolf");
    await dashboard.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Werewolf')?.click()");
    expect((await filteredPage).ok()).toBe(true);
    await dashboard.waitForFunction("!document.body.innerText.includes('Frozen Influence')");
    expect(requests.some(url => new URL(url, "http://local").searchParams.get("game") === "werewolf")).toBe(true);
  } finally { await dashboard.close(); }
},180000);
