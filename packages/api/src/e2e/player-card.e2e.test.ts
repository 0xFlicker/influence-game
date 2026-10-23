import {afterAll,beforeAll,expect,test} from "bun:test";
import {chromium,type Browser,type Frame,type Page} from "@playwright/test";
import {existsSync} from "node:fs";
import {completedCurrentWerewolfFixture} from "@influence/engine/fixtures/werewolf-results";
import {schema} from "../db/index.js";
import {createIsolatedTestDb,destroyIsolatedTestDb,type TestDB} from "./test-db.js";
import {startTestServers,stopTestServers,type TestServerHandles} from "./test-server.js";
import {seedFormatAwareGameViewerFixtures} from "./format-aware-game-viewer-fixture.js";
import {cleanupE2eResources} from "./cleanup.js";
import {storeFields} from "../services/payload-storage.js";
let database:TestDB, servers:TestServerHandles, browser:Browser;
beforeAll(async () => {
 database=await createIsolatedTestDb();
 await seedFormatAwareGameViewerFixtures(database.db);
 await database.db.insert(schema.users).values({id:"share-player",walletAddress:"0x1111111111111111111111111111111111111111",handle:"share-player",displayName:"Share Player"});
 await database.db.insert(schema.houseCutJobs).values(await storeFields({gameId:"e2e-dark-coral-horn",audience:"public" as const,status:"ready" as const,
  publication:{version:"share-fixture",audience:"public" as const,cuts:[{id:"share-cut-1",title:"A shared House Cut",context:"The pact holds.",angle:"A strategic moment.",payoff:null,quotes:[],participants:[],sourceRefs:[],replayHref:"/games/dark-coral-horn/replay/1"}]},
 },{publication:"json-gzip"}));
 const id="player-card-village", events=await completedCurrentWerewolfFixture(id);
 await database.db.insert(schema.games).values({id,slug:id,gameKind:"werewolf",status:"completed",startedAt:new Date().toISOString(),config:JSON.stringify({visibility:"unlisted",preset:"one_wolf",rulesVersion:9,providerManifest:[{catalogId:"openai:gpt-6-luna"}]})});
 await database.db.insert(schema.werewolfEvents).values(events.map(event=>({gameId:id,sequence:event.sequence,event})));
 servers=await startTestServers({databaseUrl:database.databaseUrl,logDirectory:"/tmp/player-card-browser-logs"});
 const macChrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
 browser=await chromium.launch({
  ...(existsSync(macChrome)?{executablePath:macChrome}:{}),
 });
},240_000);
afterAll(async () => {await cleanupE2eResources([
 ["browser",async()=>{if(browser)await browser.close();}],
 ["servers",async()=>{if(servers)await stopTestServers(servers);}],
 ["database",async()=>{if(database)await destroyIsolatedTestDb(database.databaseUrl);}],
]);},60_000);
async function rejectOptionalAnalytics(page:Page) {
 await page.addInitScript(() => {
  localStorage.setItem("house:analytics-consent",JSON.stringify({version:1,analytics:false}));
 });
}
async function freezeClock(page:Page) {
 // Clock installation happens before the first navigation. Freeze it before
 // restoring a link so native click latency cannot advance the replay.
 await page.clock.pauseAt(await page.evaluate(() => Date.now()+1000));
}
async function pauseRestored(frame:Frame|Page) {
 const page="page" in frame ? frame.page() : frame;
 const deadline=Date.now()+60_000;
 // Advance startup timers in small deterministic steps until the transport
 // is ready. One final frame publishes its restored position before clicking.
 while(!await frame.locator('input[aria-label="Replay position"]:not([disabled])').count()) {
  if(Date.now()>deadline)throw Error("Replay transport did not become ready under the controlled clock");
  await page.clock.runFor(1);
  await Bun.sleep(10);
 }
 await page.clock.runFor(16);
 await pause(frame);
 await page.clock.resume();
}
async function clickText(frame:Frame|Page,text:string) {
 const selector = `Array.from(document.querySelectorAll("button")).find(b=>b.textContent?.trim()===${JSON.stringify(text)})`;
 await frame.waitForFunction(selector);
 await frame.evaluate(`${selector}.click()`);
}
const shortShares = new Map<string,string>();
async function captureShare(frame:Frame|Page):Promise<URL> {
 await frame.evaluate('window.__shared=undefined;Object.defineProperty(navigator,"share",{configurable:true,value:async data=>{window.__shared=data.url;}})');
 await frame.click('button[aria-label="Share this moment"]');
 await frame.waitForSelector('input[aria-label="House share link"]');
 await frame.click('button[aria-label="Share link"]');
 await frame.waitForFunction('typeof window.__shared === "string"');
 const short=new URL(String(await frame.evaluate('window.__shared')));
 expect(short.pathname).toMatch(/^\/s\/[1-9A-HJ-NP-Za-km-z]{10}$/);expect(short.search).toBe("");
 const resolved=await (await fetch(`${servers.webUrl}/api/share-links/${short.pathname.split("/").at(-1)}`)).json() as {path:string};
 const expanded=new URL(resolved.path,short.origin);shortShares.set(expanded.href,short.href);
 await frame.click('button[aria-label="Close share"]');
 return expanded;
}
async function pause(frame:Frame|Page, timeout = 60_000) {
 // Keep native pointer input and prove the click actually paused playback.
 const page="page" in frame ? frame.page() : frame;
 await page.bringToFront();
 await frame.waitForSelector('input[aria-label="Replay position"]:not([disabled])',{timeout});
 await frame.waitForSelector('button[aria-label="Pause replay"]');
 await frame.click('button[aria-label="Pause replay"]');
 await frame.waitForSelector('button[aria-label="Play replay"]');
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
 const created=await fetch(`${servers.webUrl}/api/share-links`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({path})});
 expect(created.status).toBe(200);const short=await created.json() as {path:string};
 const responses=await Promise.all(["Twitterbot/1.0","Mozilla/5.0","FarcasterBot/1.0"].map(agent=>fetch(`${servers.webUrl}${short.path}`,{headers:{"User-Agent":agent}})));
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
  await page.setViewportSize({width:640,height:640});
  await page.addInitScript({content:'Object.defineProperty(Storage.prototype,"getItem",{value:()=>{throw Error("Storage disabled for iframe test");}});Object.defineProperty(Storage.prototype,"setItem",{value:()=>{throw Error("Storage disabled for iframe test");}});'});
  await page.clock.install();
  await page.route("**/__player-test",route=>{
   return route.fulfill({status:200,contentType:"text/html",body:`<iframe title="House" width="100%" height="100%" style="position:fixed;inset:0;border:0" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" allow="autoplay; fullscreen; web-share" src="/embed/games/${slug}${slug.includes('village')?'?audience=omniscient':''}"></iframe>`});
  });
  try {
   await page.goto(`${servers.webUrl}/__player-test`,{waitUntil:"domcontentloaded"});
   await page.waitForSelector("iframe");const frame=await (await page.$("iframe"))!.contentFrame();if(!frame)throw Error("Missing iframe");
   await pause(frame,90_000);
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
   await freezeClock(page);
   await frame.goto(`${servers.webUrl}${embedPath}${shared.search}`,{waitUntil:"domcontentloaded"});
   await pauseRestored(frame);
   const restored=await captureShare(frame);
   expect(restored.searchParams.get("cue")).toBe(shared.searchParams.get("cue"));
   expect(Math.abs(Number(restored.searchParams.get("t"))-Number(shared.searchParams.get("t")))).toBeLessThan(1.5);
   expect(restored.searchParams.get("muted")).toBe("0");expect(restored.searchParams.get("volume")).toBe("0.67");
   expect(restored.searchParams.get("speed")).toBe("2");expect(restored.searchParams.get("thinking")).toBe("1");
   // Farcaster launches the normal app at this moment, including its site providers.
   const appPage=await browser.newPage();await rejectOptionalAnalytics(appPage);await appPage.clock.install();
   try {
    await appPage.goto(`${shortShares.get(shared.href)}?t=999&speed=4&redirect=https://example.com`,{waitUntil:"domcontentloaded"});
    await appPage.waitForFunction(`location.pathname===${JSON.stringify(shared.pathname)}`);
    expect(new URL(appPage.url()).searchParams.get("t")).toBe(shared.searchParams.get("t"));
    await appPage.waitForSelector('meta[name="fc:miniapp"]',{state:"attached"});
    expect(await appPage.$$eval('meta[name="fc:miniapp"]',nodes=>nodes.length)).toBe(1);
    const crawler=await browser.newPage({javaScriptEnabled:false});
    let miniapp: {button: {title:string;action:{url:string}}};
    try {
     await crawler.goto(shortShares.get(shared.href)!,{waitUntil:"domcontentloaded"});
     miniapp=JSON.parse(await crawler.$eval('meta[name="fc:miniapp"]',node=>node.getAttribute("content")!));
    } finally {await crawler.close();}
    expect(miniapp.button.title).toBe("Watch replay");
    const launch=new URL(miniapp.button.action.url);
    expect(launch.origin).toBe(shared.origin);expect(launch.pathname).toBe(new URL(shortShares.get(shared.href)!).pathname);
    expect(launch.searchParams.get("app")).toBe("mini");
    launch.searchParams.set("t","999");launch.searchParams.set("speed","4");
    await freezeClock(appPage);
    await appPage.goto(launch.href,{waitUntil:"domcontentloaded"});
    await pauseRestored(appPage);
    await appPage.waitForFunction(`location.pathname===${JSON.stringify(shared.pathname)}`);
    for(const [key,value] of shared.searchParams)expect(new URL(appPage.url()).searchParams.get(key)).toBe(value);
    expect(new URL(appPage.url()).searchParams.get("app")).toBe("mini");
    const launched=await captureShare(appPage);
    expect(launched.searchParams.get("cue")).toBe(shared.searchParams.get("cue"));
    expect(Math.abs(Number(launched.searchParams.get("t"))-Number(shared.searchParams.get("t")))).toBeLessThan(1.5);
    for(const key of ["speed","thinking","muted","volume"])expect(launched.searchParams.get(key)).toBe(shared.searchParams.get(key));
    expect(await appPage.$('[data-watch-mode="embed"]')).toBeNull();
   }finally{await appPage.close();}
   // Returning from the app/crawler tabs must resume the iframe's paint loop
   // before asserting its rendered cursor. Exercise an actual keyboard seek.
   await page.bringToFront();
   await frame.waitForSelector('button[aria-label="Play replay"]');
   const scrubber = await frame.$('input[aria-label="Replay position"]');
   if (!scrubber) throw new Error("Missing replay scrubber");
   await scrubber.press("Home");
   await frame.waitForFunction(`document.querySelector('input[aria-label="Replay position"]')?.value === "0"`);
   // Native sharing unavailable: the native dialog exposes a frozen, selectable link.
   await frame.evaluate(()=>Object.defineProperty(navigator,"share",{configurable:true,value:undefined}));await frame.click('button[aria-label="Share this moment"]');
   await frame.waitForSelector('input[aria-label="House share link"]');expect(await frame.$eval('input[aria-label="House share link"]',e=>e.value)).toContain("/s/");
   await page.screenshot({path:`/tmp/${slug}-embed-share.png`});
   expect(requests.some(url=>/clerk|privy|\/api\/auth|posthog|farcaster/.test(url))).toBe(false);
   await clickText(frame,"✕");
   await frame.evaluate('Object.defineProperty(navigator,"share",{configurable:true,value:async()=>{throw new DOMException("Cancelled","AbortError");}})');
   await frame.click('button[aria-label="Share this moment"]');await frame.waitForSelector('input[aria-label="House share link"]');
   await frame.click('button[aria-label="Share link"]');
   await frame.waitForFunction('document.querySelector("dialog[open]")?.textContent.includes("Share cancelled.")');
   await frame.click('button[aria-label="Close share"]');
   for(const width of [320,480]) {
    await page.setViewportSize({width,height:480});
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

test("share preparation failure can retry the original playing moment",async()=>{
 const page=await browser.newPage();await rejectOptionalAnalytics(page);
 const paths:string[]=[];
 await page.route("**/api/share-links",route=>{
  const request=route.request();
  if(new URL(request.url()).pathname==="/api/share-links" && request.method()==="POST"){
   paths.push((JSON.parse(request.postData()!) as {path:string}).path);
   if(paths.length===1)return route.fulfill({status:503,contentType:"application/json",body:'{"error":"unavailable"}'});
  }
  return route.continue();
 });
 try{
  await page.goto(`${servers.webUrl}/games/dark-coral-horn/replay`,{waitUntil:"domcontentloaded"});
  await page.waitForSelector('input[aria-label="Replay position"]:not([disabled])',{timeout:60_000});
  await page.click('button[aria-label="Share this moment"]');
  await page.waitForFunction('document.querySelector("dialog[open]")?.textContent.includes("Try again")');
  expect(await page.$('input[aria-label="House share link"]')).toBeNull();
  const position=await page.$eval('input[aria-label="Replay position"]',e=>Number(e.value));
  await page.waitForFunction(`Number(document.querySelector('input[aria-label="Replay position"]').value)>${position+5}`);
  await clickText(page,"Try again");
  await page.waitForSelector('input[aria-label="House share link"]');
  expect(paths).toHaveLength(2);expect(paths[0]).toBe(paths[1]);
  expect(await page.$eval('input[aria-label="House share link"]',e=>e.value)).toContain("/s/");
 }finally{await page.close();}
},120_000);

test("public profile and House Cut icon buttons produce working short links and matching cards",async()=>{
 const page=await browser.newPage();await rejectOptionalAnalytics(page);
 try{
  for(const item of [
   {path:"/profile/share-player",label:"Share Share Player profile",target:"/profile/share-player",preview:"Share Player"},
   {path:"/games/dark-coral-horn/highlights",label:"Share this Cut: A shared House Cut",target:"/games/dark-coral-horn/highlights?audience=public&scene=share-cut-1",preview:"A shared House Cut"},
  ]){
   await page.goto(`${servers.webUrl}${item.path}`,{waitUntil:"domcontentloaded"});
   await page.waitForSelector(`button[aria-label="${item.label}"]`,{timeout:60_000});
   expect(await page.$eval(`button[aria-label="${item.label}"]`,e=>e.textContent)).toBe("");
   await page.click(`button[aria-label="${item.label}"]`);
   await page.waitForSelector('input[aria-label="House share link"]');
   const short=await page.$eval('input[aria-label="House share link"]',e=>e.value);
   expect(new URL(short).pathname).toMatch(/^\/s\/[1-9A-HJ-NP-Za-km-z]{10}$/);
   const response=await fetch(short,{headers:{"User-Agent":"Twitterbot/1.0"}});expect(response.status).toBe(200);
   const html=await response.text(),head=html.slice(0,html.indexOf("</head>"));expect(head).toContain(item.preview);expect(head).toContain('name="fc:miniapp"');
   if(item.label.includes("Cut"))expect(head).toContain("/highlights/card-image/share-cut-1");
   await page.goto(short,{waitUntil:"domcontentloaded"});
   await page.waitForFunction(`location.pathname+location.search===${JSON.stringify(item.target)}`);
  }
 }finally{await page.close();}
},150_000);
