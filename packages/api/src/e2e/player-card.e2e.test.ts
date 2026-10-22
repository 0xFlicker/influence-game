import {afterAll,beforeAll,expect,test} from "bun:test";
import type {Browser,Frame,Page} from "puppeteer";
import {completedCurrentWerewolfFixture} from "@influence/engine/fixtures/werewolf-results";
import {schema} from "../db/index.js";
import {createIsolatedTestDb,destroyIsolatedTestDb,type TestDB} from "./test-db.js";
import {startTestServers,stopTestServers,type TestServerHandles} from "./test-server.js";
import {launchBrowser,closeBrowser,rejectOptionalAnalytics} from "./test-browser.js";
import {seedFormatAwareGameViewerFixtures} from "./format-aware-game-viewer-fixture.js";
import {cleanupE2eResources} from "./cleanup.js";
let database:TestDB, servers:TestServerHandles, browser:Browser;
beforeAll(async () => {
 database=await createIsolatedTestDb();
 await seedFormatAwareGameViewerFixtures(database.db);
 const id="player-card-village", events=await completedCurrentWerewolfFixture(id);
 await database.db.insert(schema.games).values({id,slug:id,gameKind:"werewolf",status:"completed",startedAt:new Date().toISOString(),config:JSON.stringify({visibility:"unlisted",preset:"one_wolf",rulesVersion:9,providerManifest:[{catalogId:"openai:gpt-6-luna"}]})});
 await database.db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
 servers=await startTestServers({databaseUrl:database.databaseUrl,logDirectory:"/tmp/player-card-browser-logs"});
 browser=await launchBrowser();
},240_000);
afterAll(async () => {await cleanupE2eResources([
 ["browser",async()=>{if(browser)await closeBrowser(browser);}],
 ["servers",async()=>{if(servers)await stopTestServers(servers);}],
 ["database",async()=>{if(database)await destroyIsolatedTestDb(database.databaseUrl);}],
]);},60_000);
async function clickText(frame:Frame|Page,text:string) {
 const selector = `Array.from(document.querySelectorAll("button")).find(b=>b.textContent?.trim()===${JSON.stringify(text)})`;
 await frame.waitForFunction(selector);
 await frame.evaluate(`${selector}.click()`);
}
async function captureShare(frame:Frame|Page):Promise<URL> {
 await frame.evaluate('Object.defineProperty(navigator,"share",{configurable:true,value:async data=>{window.__shared=data.url;}})');
 await clickText(frame,"Share");
 return new URL(String(await frame.evaluate('window.__shared')));
}
async function pause(frame:Frame|Page) {
 await frame.waitForSelector('button[aria-label="Pause replay"]');
 await frame.click('button[aria-label="Pause replay"]');
}
async function scrub(frame:Frame|Page,value:number) {
 await frame.evaluate(`(() => {
  const input=document.querySelector('input[aria-label="Replay position"]');
  if(!input)throw Error("Missing scrubber");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(String(value))});
  input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));
 })()`);
}
test("Twitterbot and browsers receive matching player metadata, bounded HTML and framing headers",async()=>{
 const path="/games/dark-coral-horn/replay?speed=2&thinking=0&muted=1&volume=0.6";
 const responses=await Promise.all(["Twitterbot/1.0","Mozilla/5.0","FarcasterBot/1.0"].map(agent=>fetch(`${servers.webUrl}${path}`,{headers:{"User-Agent":agent}})));
 for(const response of responses){
  expect(response.status).toBe(200);const html=await response.text();
  expect(html).toContain('name="twitter:card" content="player"');
  expect(html.match(/name="twitter:card"/g)).toHaveLength(1);
  if(response === responses[0]) expect(html.slice(0,html.indexOf("</head>"))).toContain('name="twitter:player"');
  const head=html.slice(0,html.indexOf("</head>"));
  expect(head).toContain('name="fc:miniapp"');
  expect(head).toContain("Watch replay");
  expect(html).toContain('name="twitter:player"');expect(html).toContain("/embed/games/dark-coral-horn?");
  expect(html).not.toContain('name="twitter:player:stream"');
 }
 const embed=await fetch(`${servers.webUrl}/embed/games/dark-coral-horn`);
 expect(embed.headers.get("content-security-policy")).toContain("https://*.x.com");
 expect(embed.headers.get("x-frame-options")).toBeNull();expect(embed.headers.get("x-robots-tag")).toContain("noindex");
 expect((await embed.text()).length).toBeLessThan(100_000);
},120_000);
for(const slug of ["dark-coral-horn","player-card-village"]){
 test(`${slug}: sandbox playback without storage, native sharing, exact restoration and backward scrub`,async()=>{
  const page=await browser.newPage();const errors:string[]=[],requests:string[]=[];
  page.on("pageerror",error=>errors.push(String(error)));
  page.on("request",request=>{requests.push(request.url());if(request.url().includes("/api/"))expect(request.headers().authorization).toBeUndefined();});
  await page.setViewport({width:640,height:640});
  await page.evaluateOnNewDocument('Object.defineProperty(Storage.prototype,"getItem",{value:()=>{throw Error("Storage disabled for iframe test");}});Object.defineProperty(Storage.prototype,"setItem",{value:()=>{throw Error("Storage disabled for iframe test");}});');
  await page.setRequestInterception(true);
  page.on("request",request=>{
   if(new URL(request.url()).pathname==="/__player-test")void request.respond({status:200,contentType:"text/html",body:`<iframe title="House" width="100%" height="100%" style="position:fixed;inset:0;border:0" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" allow="autoplay; fullscreen; web-share" src="/embed/games/${slug}${slug.includes('village')?'?audience=omniscient':''}"></iframe>`});else void request.continue();
  });
  try {
   await page.goto(`${servers.webUrl}/__player-test`,{waitUntil:"domcontentloaded"});
   await page.waitForSelector("iframe");const frame=await (await page.$("iframe"))!.contentFrame();if(!frame)throw Error("Missing iframe");
   await frame.waitForSelector('input[aria-label="Replay position"]:not([disabled])',{timeout:90_000});await pause(frame);
   expect(Number(await frame.$eval('input[aria-label="Replay position"]',e=>e.value))).toBeLessThan(150);
   await frame.click('button[aria-label="Player settings"]');await clickText(frame,"2×");
   const thinking=await frame.$('input[type="checkbox"]');if(thinking)await thinking.click();
   await frame.click('button[aria-label="Close settings"]');
   await frame.evaluate(`(() => {const el=document.querySelector('input[aria-label="Music volume"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,"67");el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));})()`);
   await frame.click('button[aria-label="Turn music on"]');
   // Start well beyond the opening and land within a cue, not its readable boundary.
   await scrub(frame,1801);
   await frame.waitForFunction(`Number(document.querySelector('input[aria-label="Replay position"]')?.value)>1000`);
   if(slug.includes("village")) {
    await frame.waitForSelector('[data-werewolf-stage][data-cursor]');
    await frame.waitForFunction('!Array.from(document.querySelectorAll("[role=status]")).some(n=>n.textContent==="Preparing…")');
   }
   const shared=await captureShare(frame);
   expect(shared.searchParams.get("cue")).not.toContain("opening");
   expect(shared.searchParams.get("muted")).toBe("0");expect(shared.searchParams.get("volume")).toBe("0.67");
   expect(shared.searchParams.get("speed")).toBe("2");expect(shared.searchParams.get("thinking")).toBe("1");expect(shared.searchParams.get("cue")).toBeTruthy();
   const embedPath=shared.pathname.replace(`/games/${slug}/replay`,`/embed/games/${slug}`);
   await frame.goto(`${servers.webUrl}${embedPath}${shared.search}`,{waitUntil:"domcontentloaded"});
   await frame.waitForSelector('input[aria-label="Replay position"]:not([disabled])',{timeout:60_000});await pause(frame);
   const restored=await captureShare(frame);
   expect(restored.searchParams.get("cue")).toBe(shared.searchParams.get("cue"));
   expect(Math.abs(Number(restored.searchParams.get("t"))-Number(shared.searchParams.get("t")))).toBeLessThan(1.5);
   expect(restored.searchParams.get("muted")).toBe("0");expect(restored.searchParams.get("volume")).toBe("0.67");
   expect(restored.searchParams.get("speed")).toBe("2");expect(restored.searchParams.get("thinking")).toBe("1");
   // Farcaster launches the normal app at this moment, including its site providers.
   const appPage=await browser.newPage();await rejectOptionalAnalytics(appPage);
   try {
    await appPage.goto(shared.href,{waitUntil:"domcontentloaded"});
    await appPage.waitForSelector('meta[name="fc:miniapp"]');
    expect(await appPage.$$eval('meta[name="fc:miniapp"]',nodes=>nodes.length)).toBe(1);
    const miniapp=JSON.parse(await appPage.$eval('meta[name="fc:miniapp"]',node=>node.getAttribute("content")!));
    expect(miniapp.button.title).toBe("Watch replay");
    const launch=new URL(miniapp.button.action.url);
    expect(launch.origin).toBe(shared.origin);expect(launch.pathname).toBe(shared.pathname);
    expect(launch.searchParams.get("app")).toBe("mini");
    for(const [key,value] of shared.searchParams)expect(launch.searchParams.get(key)).toBe(value);
    await appPage.goto(launch.href,{waitUntil:"domcontentloaded"});
    await appPage.waitForSelector('input[aria-label="Replay position"]:not([disabled])',{timeout:60_000});await pause(appPage);
    const launched=await captureShare(appPage);
    expect(launched.searchParams.get("cue")).toBe(shared.searchParams.get("cue"));
    expect(Math.abs(Number(launched.searchParams.get("t"))-Number(shared.searchParams.get("t")))).toBeLessThan(1.5);
    for(const key of ["speed","thinking","muted","volume"])expect(launched.searchParams.get(key)).toBe(shared.searchParams.get(key));
    expect(await appPage.$('[data-watch-mode="embed"]')).toBeNull();
   }finally{await appPage.close();}
   await scrub(frame,0);await frame.waitForFunction(`Number(document.querySelector('input[aria-label="Replay position"]')?.value)===0`);
   // Native sharing unavailable: the native dialog exposes a frozen, selectable link.
   await frame.evaluate(()=>Object.defineProperty(navigator,"share",{configurable:true,value:undefined}));await clickText(frame,"Share");
   await frame.waitForSelector("dialog[open]");expect(await frame.$eval('input[aria-label="Replay share link"]',e=>e.value)).toContain("cue=");
   await page.screenshot({path:`/tmp/${slug}-embed-share.png`});
   expect(requests.some(url=>/clerk|privy|\/api\/auth|posthog|farcaster/.test(url))).toBe(false);
   await clickText(frame,"✕");
   await frame.evaluate('Object.defineProperty(navigator,"share",{configurable:true,value:async()=>{throw new DOMException("Cancelled","AbortError");}})');
   await clickText(frame,"Share");expect(await frame.$("dialog[open]")).toBeNull();
   for(const width of [320,480]) {
    await page.setViewport({width,height:480});
    await frame.waitForFunction(`document.documentElement.clientWidth<=${width}`);
    await frame.waitForFunction(`(() => {const el=document.querySelector('[data-watch-transport]');return el.scrollWidth<=el.getBoundingClientRect().width+1;})()`);
    const bounds=await frame.evaluate(`(() => {const r=document.querySelector('[data-watch-transport]').getBoundingClientRect();return {width:r.width,scroll:document.querySelector('[data-watch-transport]').scrollWidth};})()` ) as {width:number;scroll:number};
    expect(bounds.scroll).toBeLessThanOrEqual(bounds.width+1);
   }
   expect(errors).toEqual([]);
  } catch(error){console.error("Embed diagnostics",await page.frames().at(-1)?.evaluate("document.body.innerText"));throw error;}
  finally{await page.close();}
 },120_000);
}
test("normal completed replay links without timecode start at the opening and expose Share",async()=>{
 const page=await browser.newPage();await rejectOptionalAnalytics(page);
 try{
  for(const path of ["/games/dark-coral-horn/replay","/games/player-card-village/replay?audience=mystery"]){
   await page.goto(`${servers.webUrl}${path}`,{waitUntil:"domcontentloaded"});
   await page.waitForSelector('input[aria-label="Replay position"]:not([disabled])',{timeout:60_000});await pause(page);
   expect(Number(await page.$eval('input[aria-label="Replay position"]',e=>e.value))).toBeLessThan(150);
   expect((await captureShare(page)).searchParams.get("cue")).toContain("opening");
  }
 }catch(error){console.error("Normal player diagnostics",await page.evaluate("({url:location.href,text:document.body.innerText})"));throw error;}finally{await page.close();}
},150_000);
