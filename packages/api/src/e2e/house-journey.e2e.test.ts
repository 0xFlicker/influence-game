import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Browser, Page } from "puppeteer";
import { DEFAULT_MODEL_CATALOG_ID } from "@influence/engine";
import { werewolfResultsFixture } from "@influence/engine/fixtures/werewolf-results";
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
  await database.db.insert(schema.games).values({id:"history-influence",slug:"history-influence",status:"completed",config:"{}",endedAt:"2026-10-04T12:00:00.000Z"});
  await database.db.insert(schema.gamePlayers).values({id:"history-seat",gameId:"history-influence",userId:owner.userId,agentProfileId:"history-agent",persona:JSON.stringify({name:"Frozen Influence"}),agentConfig:"{}"});
  await database.db.insert(schema.gameResults).values({id:"history-result",gameId:"history-influence",winnerId:"history-seat",roundsPlayed:3,finishedAt:date,tokenUsage:"{}"});
  for (const [slug,status,visibility] of [
    ["old-lantern-village","completed","public"],["old-hidden-faces","completed","public"],
    ["new-village-casting","waiting","public"],["new-village-live","in_progress","public"],
    ["secret-village-link","completed","unlisted"],["hidden-village","completed","public"],
  ] as const) {
    await database.db.insert(schema.games).values({id:slug,slug,gameKind:"werewolf",status,endedAt:status === "completed" ? date : null,minPlayers:6,maxPlayers:6,startedAt:status === "waiting" ? null : new Date().toISOString(),hiddenAt:slug === "hidden-village" ? new Date().toISOString() : null,config:JSON.stringify({visibility,preset:"one_wolf",providerManifest:[{catalogId:DEFAULT_MODEL_CATALOG_ID}]})});
    if (status !== "waiting") {
      const events = await werewolfResultsFixture("village",slug);
      if (events[0]?.type === "werewolf.started") events[0].payload.players[0]!.agentProfileId="history-agent";
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

test("mixed profile and owner history filter in place at desktop/mobile widths",async()=>{
  const page=await browser.newPage();
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
  } finally {await dashboard.close();}
},180000);
