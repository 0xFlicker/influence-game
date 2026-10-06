import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser, Page } from "puppeteer";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
import { schema } from "../db/index.js";
import { createIsolatedTestDb, destroyIsolatedTestDb, type TestDB } from "./test-db.js";
import { startTestServers, stopTestServers, type TestServerHandles } from "./test-server.js";
import { launchBrowser, closeBrowser } from "./test-browser.js";
import { cleanupE2eResources } from "./cleanup.js";
let database: TestDB, servers: TestServerHandles, browser: Browser;
const savedRole = process.env.INFLUENCE_API_ROLE;
beforeAll(async () => {
  process.env.INFLUENCE_API_ROLE = "gateway";
  database = await createIsolatedTestDb();
  for (const [slug,status,visibility] of [
    ["old-lantern-village","completed","public"],["old-hidden-faces","completed","public"],
    ["new-village-casting","waiting","public"],["new-village-live","in_progress","public"],
    ["secret-village-link","completed","unlisted"],["hidden-village","completed","public"],
  ] as const) {
    await database.db.insert(schema.games).values({id:slug,slug,gameKind:"werewolf",status,minPlayers:6,maxPlayers:6,startedAt:status === "waiting" ? null : new Date().toISOString(),hiddenAt:slug === "hidden-village" ? new Date().toISOString() : null,config:JSON.stringify({visibility,preset:"one_wolf",providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID}]})});
    if (status !== "waiting") {
      const events = await werewolfResultsFixture("village",slug);
      await database.db.insert(schema.werewolfEvents).values((status === "completed" ? events : events.slice(0,1)).map(event=>({gameId:slug,sequence:event.sequence,event})));
    }
  }
  await database.db.insert(schema.gameEpisodePresentations).values({gameId:"old-lantern-village",title:"Lanterns and Lies",description:"Six contrasting voices gather around the village table.",status:"ready",locked:true});
  servers = await startTestServers({databaseUrl:database.databaseUrl,jwtSecret:"w7b-fixture-secret",logDirectory:"/tmp/w7b-browser"});
  browser = await launchBrowser();
},240000);
afterAll(async () => {
  try { await cleanupE2eResources([
    ["browser",async()=>{if(browser)await closeBrowser(browser);}],
    ["servers",async()=>{if(servers)await stopTestServers(servers);}],
    ["database",async()=>{if(database)await destroyIsolatedTestDb(database.databaseUrl);}]
  ]); } finally { if(savedRole === undefined)delete process.env.INFLUENCE_API_ROLE;else process.env.INFLUENCE_API_ROLE=savedRole; }
},60000);
async function text(page:Page,value:string) {
  await page.waitForFunction(`document.body.innerText.includes(${JSON.stringify(value)})`,{polling:100,timeout:30000});
}
test("old/new House cards, title search, stable links and responsive art",async()=>{
  const page=await browser.newPage();
  try {
    for(const width of [1440,390]) {
      await page.setViewport({width,height:1000});
      await page.goto(`${servers.webUrl}/games`,{waitUntil:"domcontentloaded"});
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
      await page.waitForFunction(`Array.from(document.querySelectorAll('.werewolf-artwork img.episode-scene')).length === 4 && Array.from(document.querySelectorAll('.werewolf-artwork img.episode-scene')).every(img=>img.complete && img.naturalWidth > 0)`);
      expect(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true);
      expect(await page.evaluate(`document.body.innerText.includes('secret-village-link') || document.body.innerText.includes('hidden-village')`)).toBe(false);
      await page.screenshot({path:`/tmp/w7b-cards-${width}.png`,fullPage:true});
    }
    await page.type('input[aria-label="Search games"]','Lanterns and Lies');
    await page.waitForFunction(`document.querySelectorAll('.werewolf-library-card').length === 1`);
    await page.click('a[aria-label="Open Lanterns and Lies"]');
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
  try {
    await page.goto(`${servers.webUrl}/games/secret-village-link`,{waitUntil:"domcontentloaded"});await text(page,"Watch Mystery");
    await page.goto(`${servers.webUrl}/games/hidden-village`,{waitUntil:"domcontentloaded"});await text(page,"Game not found");
  } finally {await page.close();}
},60000);
