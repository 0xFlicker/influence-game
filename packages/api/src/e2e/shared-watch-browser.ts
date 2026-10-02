import {expect} from "bun:test";
import type {Page} from "puppeteer";
import type {WerewolfPresentation} from "@influence/engine/werewolf/presentation";
export async function seekWatch(page:Page,cursor:number){
 await page.evaluate(`(() => {const input=document.querySelector('input[aria-label="Replay position"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(input,${JSON.stringify(String(cursor))});input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));})()`);
 await page.waitForFunction(`Number(document.querySelector('[data-werewolf-stage]')?.getAttribute('data-cursor')) >= ${cursor}`);
}
export async function watchText(page:Page,value:string){await page.waitForFunction(`document.body.innerText.includes(${JSON.stringify(value)})`,{timeout:25000});}
export async function checkSharedWerewolfWatch(page:Page,url:string,apiUrl:string){
 const errors:string[]=[],requests:string[]=[];
 page.on("pageerror",error=>errors.push(String(error)));
 page.on("request",request=>{if(request.url().includes('/watch?'))requests.push(request.url());});
 const slug=new URL(url).pathname.split('/').at(-1)!;
 await page.setViewport({width:1440,height:1000});await page.goto(url,{waitUntil:"domcontentloaded"});
 await page.waitForSelector('a[href="?audience=mystery"]'); await page.click('a[href="?audience=mystery"]');
 await page.waitForSelector('[data-werewolf-stage][data-cursor]');await watchText(page,"Cross-examine this game with your AI.");
 expect(await page.$('select[aria-label="Spectator mode"]')).toBeNull();
 await page.click('button[aria-label="Player settings"]');await watchText(page,"Viewing mode: Mystery");await page.click('button[aria-label="Close settings"]');
 expect(await page.$$('a[href="/get-mcp"]')).toHaveLength(1);expect(await page.$$('[data-watch-context]')).toHaveLength(1);await watchText(page,"Role unknown");
 const first=await page.$eval('[data-werewolf-stage]',e=>Number(e.getAttribute('data-cursor'))),stage=await page.$('[data-werewolf-stage]');
 await page.evaluate("document.activeElement?.blur()");await page.keyboard.press("ArrowRight");await page.waitForSelector('[data-speech-bubble]');
 expect(await page.$eval('[data-speech-bubble]',e=>e.textContent?.trim())).not.toBe("Pass");
 await page.screenshot({path:"/tmp/shared-watch-desktop.png"});
 await page.click('button[aria-label="Enter fullscreen"]');await page.waitForSelector('[data-player-fullscreen]');
 await page.locator('button[aria-label="Player settings"]').click();await page.waitForSelector('[role="dialog"][aria-label="Player settings"]');
 expect(await page.$eval('[role="dialog"][aria-label="Player settings"]', element => {const bounds=element.getBoundingClientRect();return bounds.top>=0 && bounds.bottom<=element.ownerDocument.defaultView!.innerHeight;})).toBe(true);
 await page.evaluate("Array.from(document.querySelectorAll('[role=dialog] button')).find(e=>e.textContent==='Transcript').click()");
 await page.waitForSelector('[data-player-fullscreen] [role="dialog"][aria-label="Game transcript"]');
 await page.evaluate("Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Close transcript').click()");
 await page.keyboard.press('Escape');await page.waitForFunction("!document.querySelector('[data-player-fullscreen]')");
 await page.evaluate("document.activeElement?.blur()");await page.keyboard.press('Space');
 const before=await page.$eval('[data-werewolf-stage]',e=>Number(e.getAttribute('data-elapsed')));
 await page.waitForFunction(`Number(document.querySelector('[data-werewolf-stage]')?.getAttribute('data-elapsed'))>${before+100}`);
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
 const vote=mystery.view.entries.findIndex(entry=>entry.kind==="vote");if(vote>=0){await seekWatch(page,vote+1);await page.waitForFunction("document.querySelector('[data-watch-context]')?.textContent?.includes('Vote')");}
 expect(await stage?.evaluate(node=>node.isConnected)).toBe(true);
 expect(await page.evaluate("Array.from(document.querySelectorAll('button')).some(e=>e.getAttribute('aria-label')==='Play replay')")).toBe(true);
 await seekWatch(page,mystery.latestCursor);await watchText(page,"Game complete");await seekWatch(page,1);await watchText(page,"Role unknown");
 expect(await page.$eval('[data-werewolf-stage]',e=>Number(e.getAttribute('data-cursor')))).toBe(first);
 await page.goto(`${url}?audience=omniscient`,{waitUntil:'domcontentloaded'});await page.waitForFunction("Array.from(document.querySelectorAll('aside')).some(e=>e.textContent?.includes('werewolf'))");
 expect(await page.$('[aria-label="Player thinking"]')).toBeNull();await page.click('button[aria-label="Player settings"]');await page.click('input[type="checkbox"]');await page.click('button[aria-label="Close settings"]');
 await page.evaluate("Array.from(document.querySelectorAll('[role=\"tab\"]')).find(e=>e.textContent==='Thinking')?.click()");
 await page.waitForSelector('[aria-label="Player thinking"]');
 const omni=await(await fetch(`${apiUrl}/api/werewolf/${slug}/presentation?audience=omniscient`)).json() as WerewolfPresentation;
 await seekWatch(page,omni.latestCursor);await watchText(page,"Game complete");await page.goto(`${url}?audience=mystery`,{waitUntil:'domcontentloaded'});await watchText(page,"Role unknown");
 expect(await page.$('[aria-label="Player thinking"]')).toBeNull();expect(await page.evaluate("document.body.innerText.includes('Show thinking')")).toBe(false);
 await page.setViewport({width:390,height:844});await page.evaluate("document.activeElement?.blur()");await page.keyboard.press('ArrowRight');await page.waitForSelector('[data-speech-bubble]');
 expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);await page.screenshot({path:"/tmp/shared-watch-mobile.png"});
 const inspectors=await page.$$('button[aria-label^="Inspect "]');for(const button of inspectors){if(await button.boundingBox()){await button.click();break;}}await watchText(page,"Close player info");expect(errors).toEqual([]);
 console.log(`Shared watch proof: ${requests.length} bounded window reads; desktop/mobile, seek, fixed audience sessions, fullscreen and pause checked.`);
}

/** Exercise real paused fades and cached image readiness across consecutive lines. */
export async function checkConsecutiveReplies(page: Page, count = 4) {
  const visible = "Array.from(document.querySelectorAll('[data-speech-bubble]')).some(e => Number(getComputedStyle(e).opacity) === 1 && e.textContent.trim().length > 0)";
  await page.evaluate("document.activeElement?.blur()");
  await page.keyboard.press('ArrowRight');
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
  const slug = new URL(url).pathname.split('/').at(-1)!;
  const presentation = await (await fetch(`${apiUrl}/api/werewolf/${slug}/presentation?audience=omniscient`)).json() as WerewolfPresentation;
  const entries = presentation.view.entries.flatMap((entry, index) => entry.kind === "speech" && entry.text ? [{cursor:index + 1, actorId:entry.actorId, day:entry.day, action:"introduce", thinking:"I should ask one precise question before revealing what I know."}] : []);
  const diagnostics:string[] = [];
  page.on("console", message => {if(message.type() === "error")diagnostics.push(message.text());});
  page.on("requestfailed", request => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.setRequestInterception(true);
  page.on('request', request => {
    if (request.url().includes('/thinking?')) void request.respond({status:200, contentType:'application/json', headers:{'access-control-allow-origin':new URL(url).origin, 'access-control-allow-credentials':'true', 'access-control-allow-headers':'content-type, authorization', 'access-control-allow-methods':'GET, OPTIONS'}, body:JSON.stringify({cursor:Number(new URL(request.url()).searchParams.get('cursor')), entries})});
    else void request.continue();
  });
  await page.goto(`${url}?audience=omniscient`, {waitUntil:'domcontentloaded'});
  await page.waitForSelector('[data-werewolf-stage][data-cursor]');
  const cursor = await page.$eval('[data-werewolf-stage]', element => element.getAttribute('data-cursor'));
  await page.locator('button[aria-label="Player settings"]').click();
  await page.waitForSelector('[role="dialog"][aria-label="Player settings"]');
  await watchText(page, 'Keyboard shortcuts');
  await page.click('[role="dialog"] input[type="checkbox"]');
  try { await page.waitForSelector('[data-in-scene-thinking]', {timeout:10000}); }
  catch(error) {console.log('THINKING_DIAGNOSTICS', JSON.stringify({diagnostics,cursor,entries,body:await page.evaluate("document.body.innerText")}));await page.screenshot({path:'/tmp/werewolf-thinking-failure.png'});throw error;}
  expect(await page.$eval('[data-werewolf-stage]', element => element.getAttribute('data-cursor'))).toBe(cursor);
  await page.screenshot({path:'/tmp/werewolf-thinking-settings.png'});
  await page.select('[role="dialog"] select', 'speech-first');
  await page.waitForFunction("!document.querySelector('[data-in-scene-thinking]')");
  await page.click('button[aria-label="Close settings"]');
  await page.evaluate("document.activeElement?.blur()");
  await page.keyboard.press('Space');
  await page.waitForFunction("Array.from(document.querySelectorAll('[data-speech-bubble]')).some(e => Number(getComputedStyle(e).opacity) === 1)");
  await page.waitForSelector('[data-in-scene-thinking]');
  await page.keyboard.press('Space');
  await page.waitForFunction("document.querySelector('[data-in-scene-thinking]')?.textContent.includes('one precise question')");
  await page.screenshot({path:'/tmp/werewolf-speech-first-thinking.png'});
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
  expect(await page.$('[data-speech-bubble]')).toBeNull();
  expect(await page.$eval('[data-werewolf-stage]', e=>Number(e.getAttribute('data-cursor')))).toBe(index+1);
  await page.screenshot({path:'/tmp/werewolf-hear-more-ledger.png'});
  const revealed = (await page.$$('[data-ledger-voter]')).length;
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(`document.querySelectorAll('[data-ledger-voter]').length < ${revealed}`);
  await page.keyboard.press('2');
}
