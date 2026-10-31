import {sceneSpeechDurationMs, SOLO_READ_START_MS, SCENE_READ_START_MS} from "@influence/engine/visual-speech";
import {expect} from "bun:test";
import type {Page} from "puppeteer";
import type {WerewolfPresentation} from "@influence/engine/werewolf/presentation";
/** Recorded cursors exclude the House, title, cast and door opening stops. */
async function watchStops(page: Page) {
 const urls = await page.evaluate(() => performance.getEntriesByType("resource").map(entry => entry.name).filter(url => new URL(url).pathname.endsWith("/watch")));
 const watchUrl = urls.at(-1);
 if (!watchUrl) throw new Error("Replay has not loaded a watch window");
 const response = await fetch(watchUrl);
 if (!response.ok) throw new Error(`Watch window failed: ${response.status}`);
 const window = await response.json() as import("@influence/engine/werewolf/watch-contract").WerewolfWatchWindow;
 let timeMs = 5000 + 3000 + window.players.length * 2500 + 5300;
 const stops = window.playback.flatMap(entry => entry.durationsMs.map((duration, step) => {const stop = {cursor:entry.cursor,step,startMs:timeMs,key:entry.keys[step]!};timeMs += duration;return stop;}));
 // A later-moment deep link has no opening until the first window is loaded.
 const openingCount = urls.some(url => Number(new URL(url).searchParams.get("fromCursor") ?? 1) === 1) ? window.players.length + 3 : 0;
 await page.waitForSelector('input[aria-label="Replay position"]:not([disabled])');
 return {stops, openingCount, watchUrl};
}
export async function seekWatch(page:Page,cursor:number,step=0,readable=true){
 const {stops, watchUrl} = await watchStops(page);
 const index = stops.findIndex(stop=>stop.cursor>=cursor && (stop.cursor!==cursor || stop.step===step));
 if(index<0)throw new Error(`No playback stop for ${cursor}:${step}`);
 const stop = stops[index]!;
 const targetUrl = new URL(watchUrl);targetUrl.searchParams.set("fromCursor",String(Math.floor((cursor-1)/32)*32+1));
 const targetWindow = await (await fetch(targetUrl)).json() as import("@influence/engine/werewolf/watch-contract").WerewolfWatchWindow;
 const moment = targetWindow.moments.find(moment=>moment.cursor===stop.cursor)!;
 const entry = moment.entry;
 const speech = entry.kind === "speech" ? entry.text
  : entry.kind === "discussion" ? entry.contribution.text
  : entry.kind === "conversation" || entry.kind === "ballot" || entry.kind === "proposal" ? entry.text
  : null;
 const row = targetWindow.playback.find(row=>row.cursor===stop.cursor)!;
 const offset = !readable ? 0 : entry.kind === "ballot" || stop.key.includes(":ballot:") || stop.key.endsWith(":decision") ? SOLO_READ_START_MS : speech ? entry.kind === "speech" && entry.purpose === "retrospective" ? SOLO_READ_START_MS : SCENE_READ_START_MS + row.durationsMs[step]! - sceneSpeechDurationMs(speech) : 0;
 const position = Math.ceil((stop.startMs + offset) * 30 / 1000);
 const endPosition = Math.ceil((stop.startMs + row.durationsMs[step]!) * 30 / 1000);
 await page.evaluate(`(() => {const input=document.querySelector('input[aria-label="Replay position"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(String(position))});input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));})()`);
 // Playing seeks preserve the clock: by the next browser task the exact frame
 // may already be gone. Require the requested cue/step, never an arbitrary later one.
 try { await page.waitForFunction(`(() => {
   const frame = Number(document.querySelector('input[aria-label="Replay position"]')?.value);
   const playing = !!document.querySelector('button[aria-label="Pause replay"]');
   return Number(document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor')) === ${stop.cursor}
     && (playing ? frame >= ${position} && frame < ${endPosition} : frame === ${position})
     && !Array.from(document.querySelectorAll('[role="status"]')).some(node => node.textContent === "Preparing…");
 })()`); } catch (error) {
  console.error("Watch seek failed", {cursor, step, stop, position, endPosition, actual:await page.evaluate("({cursor:document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor'),elapsed:document.querySelector('[data-werewolf-stage]')?.getAttribute('data-elapsed'),frame:document.querySelector('input[aria-label=\"Replay position\"]')?.value,playing:!!document.querySelector('button[aria-label=\"Pause replay\"]'),text:document.body.innerText})")});
  throw error;
 }
}
/** Enter recorded play deliberately; do not wait for a cast-length-dependent opening. */
export async function skipWerewolfOpening(page: Page) {
 try {await page.waitForFunction("Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Skip opening')");}
 catch(error) {
  console.error("Opening entry diagnostics", await page.evaluate("({url:location.href,opening:document.querySelector('[data-werewolf-opening]')?.getAttribute('data-werewolf-opening'),cursor:document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor'),buttons:Array.from(document.querySelectorAll('button')).map(button=>({text:button.textContent,label:button.getAttribute('aria-label')})),alerts:Array.from(document.querySelectorAll('[role=alert],[role=status]')).map(node=>node.textContent),watchRequests:performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).pathname.endsWith('/watch')).map(entry=>({url:entry.name,duration:entry.duration})),text:document.body.innerText})"));
  throw error;
 }
 await page.evaluate("Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Skip opening').click()");
 await page.waitForSelector('[data-werewolf-stage][data-cursor]');
}
/** Playback now opens running; manual-control proofs explicitly pause first. */
export async function pauseWerewolf(page: Page) {
 await page.waitForSelector('button[aria-label="Pause replay"]');
 await page.click('button[aria-label="Pause replay"]');
 await page.waitForSelector('button[aria-label="Play replay"]');
}
export async function watchText(page:Page,value:string){await page.waitForFunction(`document.body.innerText.includes(${JSON.stringify(value)})`,{timeout:25000});}
export async function dismissAnalyticsNotice(page: Page) {
 const ready=await page.waitForFunction(`Array.from(document.querySelectorAll("button")).some(button=>button.textContent?.trim()==="Reject optional tracking")`,{timeout:1500}).then(()=>true).catch(()=>false);
 if(ready) await page.evaluate(`Array.from(document.querySelectorAll("button")).find(button=>button.textContent?.trim()==="Reject optional tracking")?.click()`);
}
export async function checkSharedWerewolfWatch(page:Page,url:string,apiUrl:string){
 const replayUrl=new URL(url);replayUrl.pathname=`/games/${replayUrl.pathname.split('/')[2]}/replay`;replayUrl.search="";url=replayUrl.href;
 const errors:string[]=[],requests:string[]=[];
 page.on("pageerror",error=>errors.push(String(error)));
 page.on("request",request=>{if(request.url().includes('/watch?'))requests.push(request.url());});
 const slug=new URL(url).pathname.split('/')[2]!;
 await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:"domcontentloaded"});await dismissAnalyticsNotice(page);
 // This manual-control scenario starts from a known preference; persistence has its own proof.
 await page.evaluate("localStorage.removeItem('house:watch:viewer:v1')");
 await page.waitForSelector('a[href$="/replay?audience=mystery"]'); await page.click('a[href$="/replay?audience=mystery"]');
 await skipWerewolfOpening(page);await pauseWerewolf(page);await watchText(page,"Cross-examine this game with your AI.");
 expect(await page.$('select[aria-label="Spectator mode"]')).toBeNull();
 await page.click('button[aria-label="Player settings"]');await watchText(page,"Viewing mode: Mystery");await page.click('button[aria-label="Close settings"]');
 expect(await page.$$('a[href="/get-mcp"]')).toHaveLength(1);expect(await page.$$('[data-watch-context]')).toHaveLength(1);expect(await page.evaluate("document.body.innerText.includes('Role unknown')")).toBe(false);
 const presentation=await(await fetch(`${apiUrl}/api/werewolf/${slug}/presentation?audience=mystery`)).json() as WerewolfPresentation;
 const first=presentation.view.entries.findIndex(entry=>entry.kind==="speech" && entry.audience==="public" && Boolean(entry.text))+1;
 if(first===0)throw new Error("Shared watch fixture requires a recorded public introduction");
 const stage=await page.$('[data-werewolf-stage]');
 // Scrub stops already land on readable dialogue; an extra arrow dismisses it.
 await seekWatch(page, first);
 await page.waitForFunction("Array.from(document.querySelectorAll('[data-speech-bubble]')).some(e => Number(getComputedStyle(e).opacity) === 1 && e.textContent.trim().length > 0)");
 expect(await page.$eval('[data-speech-bubble]',e=>e.textContent?.trim())).not.toBe("Pass");
 await page.screenshot({path:"/tmp/shared-watch-desktop.png"});
 await page.click('button[aria-label="Enter fullscreen"]');await page.waitForSelector('[data-player-fullscreen]');
 await page.locator('button[aria-label="Player settings"]').click();await page.waitForSelector('[role="dialog"][aria-label="Player settings"]');
 expect(await page.$eval('[role="dialog"][aria-label="Player settings"]', element => {const bounds=element.getBoundingClientRect();return bounds.top>=0 && bounds.bottom<=element.ownerDocument.defaultView!.innerHeight;})).toBe(true);
 await page.evaluate("Array.from(document.querySelectorAll('[role=dialog] button')).find(e=>e.textContent==='Transcript').click()");
 await page.waitForSelector('[data-player-fullscreen] [role="dialog"][aria-label="Game transcript"]');
 await page.evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Close transcript').click()");
 await page.keyboard.press('Escape');await page.waitForFunction("!document.querySelector('[data-player-fullscreen]')");
 const before=await page.$eval('[data-werewolf-stage]',e=>({elapsed:Number(e.getAttribute('data-elapsed')),cursor:Number(e.getAttribute('data-cursor'))}));
 await page.click('button[aria-label="Play replay"]');
 await page.waitForFunction(`(() => {const stage=document.querySelector('[data-werewolf-stage]');return Number(stage?.getAttribute('data-cursor'))!==${before.cursor} || Number(stage?.getAttribute('data-elapsed'))>${before.elapsed+100};})()`);
 // Seeking while playing must preserve intent, including an overlapping fetch.
 await seekWatch(page, first + 1);
 await page.waitForFunction("Array.from(document.querySelectorAll('button')).some(e=>e.getAttribute('aria-label')==='Pause replay')");
 await page.evaluate("document.activeElement?.blur()"); await page.keyboard.press('ArrowLeft');
 await page.waitForFunction("Array.from(document.querySelectorAll('button')).some(e=>e.getAttribute('aria-label')==='Pause replay')");
 await page.evaluate("document.activeElement?.blur()");
 await page.keyboard.press('Space');const paused=await page.$eval('[data-werewolf-stage]',e=>Number(e.getAttribute('data-elapsed')));
 await page.focus('button[aria-label="Player settings"]');await page.keyboard.press('ArrowRight');
 expect(await page.$eval('[data-werewolf-stage]',e=>Number(e.getAttribute('data-elapsed')))).toBe(paused);
 const mystery=await(await fetch(`${apiUrl}/api/werewolf/${slug}/presentation?audience=mystery`)).json() as WerewolfPresentation;
 const vote=mystery.view.entries.findIndex(entry=>entry.kind==="vote");if(vote>=0){await seekWatch(page,vote+1);await watchText(page,mystery.view.rulesVersion >= 9 ? "Public vote result" : "Vote after thread");}
 expect(await stage?.evaluate(node=>node.isConnected)).toBe(true);
 expect(await page.evaluate("Array.from(document.querySelectorAll('button')).some(e=>e.getAttribute('aria-label')==='Play replay')")).toBe(true);
 const resultCursor=mystery.view.entries.findIndex(entry=>entry.kind==="result")+1;
 await seekWatch(page,resultCursor);await watchText(page,"Game result");
 await page.click('button[aria-label="Play replay"]');
 await page.waitForSelector('section[aria-label^="Retrospective:"]',{timeout:20000});await pauseWerewolf(page);
 await seekWatch(page,mystery.latestCursor);await watchText(page,"Retrospective");
 await page.waitForSelector('section[aria-label^="Retrospective:"] [data-speech-bubble]');
 await seekWatch(page,first);expect(await page.evaluate("document.body.innerText.includes('Role unknown')")).toBe(false);
 expect(await page.$eval('[data-werewolf-stage]',e=>Number(e.getAttribute('data-cursor')))).toBe(first);
 await page.goto(`${url}?audience=omniscient`,{waitUntil:'domcontentloaded'});await skipWerewolfOpening(page);await pauseWerewolf(page);await page.waitForFunction("Array.from(document.querySelectorAll('aside')).some(e=>e.textContent?.includes('werewolf'))");
 await page.evaluate("Array.from(document.querySelectorAll('[role=\"tab\"]')).find(e=>e.textContent==='Decisions')?.click()");
 await page.waitForSelector('[aria-label="Player decisions"]');
 const omni=await(await fetch(`${apiUrl}/api/werewolf/${slug}/presentation?audience=omniscient`)).json() as WerewolfPresentation;
 await seekWatch(page,omni.latestCursor);await watchText(page,"Retrospective");await page.goto(`${url}?audience=mystery`,{waitUntil:'domcontentloaded'});await pauseWerewolf(page);expect(await page.evaluate("document.body.innerText.includes('Role unknown')")).toBe(false);
 expect(await page.$('[aria-label="Player thinking"]')).toBeNull();expect(await page.evaluate("document.body.innerText.includes('Show thinking')")).toBe(false);
 await page.setViewport({width:390,height:844});await seekWatch(page,first);await page.waitForSelector('[data-speech-bubble]');
 expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);await page.screenshot({path:"/tmp/shared-watch-mobile.png"});
 const inspectors=await page.$$('button[aria-label^="Inspect "]');for(const button of inspectors){if(await button.boundingBox()){await button.click();break;}}await watchText(page,"Close player info");expect(errors).toEqual([]);
 console.log(`Shared watch proof: ${requests.length} bounded window reads; desktop/mobile, seek, fixed audience sessions, fullscreen and pause checked.`);
}

/** Exercise real paused fades and cached image readiness across consecutive lines. */
export async function checkConsecutiveReplies(page: Page, count = 4) {
  const visible = "Array.from(document.querySelectorAll('[data-speech-bubble]')).some(e => Number(getComputedStyle(e).opacity) === 1 && e.textContent.trim().length > 0)";
  await page.evaluate("document.activeElement?.blur()");
  // seekWatch lands at the readable stop, not the old empty lead-in.
  await page.waitForFunction(visible);
  for (let index = 0; index < count; index++) {
    const cursor = await page.$eval('[data-werewolf-stage]', element => Number(element.getAttribute('data-cursor')));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction("Array.from(document.querySelectorAll('[data-speech-bubble]')).every(e => Number(getComputedStyle(e).opacity) === 0)");
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(`Number(document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor')) > ${cursor}`);
    await page.waitForFunction(visible);
  }
}

/** Exact per-contribution fixture isolates overlay timing from paid model generation. */
export async function checkInSceneThinking(page: Page, url: string, apiUrl: string) {
  const slug = new URL(url).pathname.split('/')[2]!;
  const presentation = await (await fetch(`${apiUrl}/api/werewolf/${slug}/presentation?audience=omniscient`)).json() as WerewolfPresentation;
  const entries = presentation.view.entries.flatMap((entry, index) => entry.kind === "speech" && entry.day === 0 && entry.text ? [{cursor:index + 1, actorId:entry.actorId, day:entry.day, action:"introduce", thinking:"I should ask one precise question before revealing what I know."}] : []);
  const first = entries[0];
  if (!first) throw new Error("Thinking overlay fixture requires a recorded introduction");
  const diagnostics:string[] = [];
  page.on("console", message => {if(message.type() === "error")diagnostics.push(message.text());});
  page.on("requestfailed", request => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().includes('/thinking?')) void request.respond({status:200, contentType:'application/json', headers:{'access-control-allow-origin':new URL(url).origin, 'access-control-allow-credentials':'true', 'access-control-allow-headers':'content-type, authorization', 'access-control-allow-methods':'GET, OPTIONS'}, body:JSON.stringify({cursor:Number(new URL(request.url()).searchParams.get('cursor')), entries})});
    else void request.continue();
  });
  await page.evaluate("localStorage.removeItem('house:watch:viewer:v1')");
  await page.goto(`${url}?audience=omniscient`, {waitUntil:'domcontentloaded'});
  // Wait for the new audience's opening instead of accepting the previous
  // session's stage during navigation and missing the new opening entirely.
  await skipWerewolfOpening(page);await pauseWerewolf(page);
  await seekWatch(page, first.cursor);
  const cursor = await page.$eval('[data-werewolf-stage]', element => element.getAttribute('data-cursor'));
  const framesWithoutThinking = await page.$eval('input[aria-label="Replay position"]', element => Number(element.getAttribute('max')));
  await page.locator('button[aria-label="Player settings"]').click();
  await page.waitForSelector('[role="dialog"][aria-label="Player settings"]');
  await watchText(page, 'Keyboard shortcuts');
  await page.click('aria/Show thinking');
  expect(await page.$('[aria-label="Thinking order"]')).toBeNull();
  await page.click('button[aria-label="Close settings"]');
  // Enabling thoughts preserves the current speech position. Wait for the
  // thought's timeline segment, then rewind this cue to test its actual entrance.
  await page.waitForFunction(`Number(document.querySelector('input[aria-label="Replay position"]')?.getAttribute('max')) > ${framesWithoutThinking}`);
  await seekWatch(page, first.cursor, 0, false);
  await page.evaluate("document.activeElement?.blur()");
  await page.keyboard.press('ArrowRight');
  try { await page.waitForSelector('[data-in-scene-thinking]', {timeout:10000}); }
  catch(error) {console.log('THINKING_DIAGNOSTICS', JSON.stringify({diagnostics,cursor,entries,body:await page.evaluate("document.body.innerText")}));throw error;}
  await page.waitForFunction("Number(getComputedStyle(document.querySelector('[data-in-scene-thinking]')).opacity) === 1");
  expect(await page.$('[data-speech-bubble]')).toBeNull();
  await page.screenshot({path:'/tmp/werewolf-thinking-focus.png'});
  expect(await page.evaluate("(() => {const bubble=document.querySelector('[data-in-scene-thinking]').getBoundingClientRect(), stage=document.querySelector('[data-werewolf-stage]').getBoundingClientRect(); return bubble.top>=stage.top && bubble.bottom<=stage.bottom && document.querySelectorAll('[data-thought-tail]').length>=1;})()")).toBe(true);
  expect(await page.$eval('[data-werewolf-stage]', element => element.getAttribute('data-cursor'))).toBe(cursor);
  await page.setViewport({width:390,height:844});
  await page.waitForFunction("document.querySelector('[data-in-scene-thinking]')?.textContent.includes('one precise question')");
  await page.screenshot({path:'/tmp/werewolf-mobile-thinking.png'});
}

/** Roll-call playback uses canonical ballots; abstentions have no speech bubble. */
export async function checkBallotCollection(page: Page, presentation: WerewolfPresentation) {
  const index = presentation.view.entries.findIndex(entry => entry.kind === "vote" && entry.result.ballots.some(b => b.targetId === null));
  expect(index).toBeGreaterThan(0);
  await seekWatch(page, index + 1);
  await page.waitForSelector('[data-vote-presentation]');
  await page.evaluate("document.activeElement?.blur()");
  await page.keyboard.press('Space');
  await page.waitForSelector('[data-ballot-collection]');
  await page.screenshot({path:'/tmp/werewolf-ballot-collection.png'});
  await page.keyboard.press('4');
  await page.waitForSelector('[data-vote-target="abstain"]');
  await page.keyboard.press('Space');
  await page.waitForSelector('button[aria-label="Play replay"]');
  const entry = presentation.view.entries[index]!;
  if (entry.kind !== "vote") throw new Error("Ballot collection fixture needs a canonical vote");
  const total = entry.result.ballots.length;
  // Rewind from the known last ballot, rather than sampling a collection
  // animation that may advance between the pause input and its React commit.
  await seekWatch(page, index + 1, total - 1);
  await page.waitForFunction(`document.querySelectorAll('[data-ledger-voter]').length === ${total}`);
  expect(await page.$('[data-speech-bubble]')).toBeNull();
  expect(await page.$eval('[data-werewolf-stage]', e=>Number(e.getAttribute('data-cursor')))).toBe(index+1);
  await page.screenshot({path:'/tmp/werewolf-hear-more-ledger.png'});
  await page.evaluate("document.activeElement?.blur()");
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(`document.querySelectorAll('[data-ledger-voter]').length === ${total - 1}`);
  await page.keyboard.press('2');
}
