import { expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Page } from "puppeteer";

type Bounds = {x: number; y: number; width: number; height: number; bottom: number};
type Layout = {viewport: {width: number; height: number}; page: {width: number; height: number}; monitor: Bounds; editor: Bounds; timeline: Bounds};
type StudioDialog = "Presentation" | "Local recordings" | "Export selected cut" | "Selected cut rule" | "Scene versions & production" | "Source settings" | "Studio tools";

/** Native clicks stay inside the current top-layer dialog, when one is open. */
export async function clickStudioButton(page: Page, text: string, scope = "") {
  const expression = `(() => {const root = ${scope ? `document.querySelector(${JSON.stringify(scope)})` : "Array.from(document.querySelectorAll('dialog[open]')).at(-1) ?? document"};
    return Array.from(root?.querySelectorAll('button') ?? []).find(node => node.textContent?.trim() === ${JSON.stringify(text)} && !node.disabled && node.getClientRects().length > 0);})()`;
  await page.waitForFunction(expression);
  const node = await page.evaluateHandle(expression);
  try {await node.asElement()!.click();} finally {await node.dispose();}
}

export async function setStudioInput(page: Page, label: string, value: string) {
  await page.waitForSelector(`input[aria-label="${label}"]`);
  await page.evaluate(`(() => {const node = document.querySelector(${JSON.stringify(`input[aria-label="${label}"]`)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event('input', {bubbles: true}));})()`);
}

export async function openStudioDialog(page: Page, title: StudioDialog) {
  if (await page.$(`dialog[open][aria-label="${title}"]`)) return;
  const trigger = {Presentation: "Presentation", "Local recordings": "Recordings", "Export selected cut": "Export…", "Selected cut rule": "Cut rule", "Scene versions & production": "Scene versions…", "Source settings": "Source settings", "Studio tools": "Tools"}[title];
  if (["Presentation", "Local recordings", "Source settings"].includes(title)) await clickStudioButton(page, "Tools");
  if (title === "Selected cut rule") {
    const expression = "Array.from(document.querySelectorAll('button')).find(node => node.textContent?.trim().startsWith('Cut rule') && node.getClientRects().length > 0)";
    await page.waitForFunction(expression);
    const node = await page.evaluateHandle(expression);
    try {await node.asElement()!.click();} finally {await node.dispose();}
  } else await clickStudioButton(page, trigger);
  await page.waitForSelector(`dialog[open][aria-label="${title}"]`, {visible: true});
  if (title === "Scene versions & production") {
    // The bounded reads expand the comparison pane and can move its action
    // buttons. Wait for those reads before issuing a real pointer click.
    await page.waitForFunction("!Array.from(document.querySelectorAll('dialog[open] [aria-label=\"Scene inspector\"] [role=status]')).some(node=>node.textContent?.startsWith('Loading '))");
  }
}

export async function closeStudioDialog(page: Page) {
  await clickStudioButton(page, "Done");
  await page.waitForFunction("!document.querySelector('dialog[open]')");
}

export async function openStudioSelect(page: Page, label: string) {
  const expression = `Array.from(document.querySelectorAll('button[role="combobox"]')).find(node => document.getElementById(node.getAttribute('aria-labelledby')?.split(' ')[0])?.textContent === ${JSON.stringify(label)} && node.getClientRects().length > 0)`;
  await page.waitForFunction(expression);
  const node = await page.evaluateHandle(expression);
  try {await node.asElement()!.click();} finally {await node.dispose();}
  await page.waitForSelector('[role="listbox"]', {visible: true});
}

export async function chooseStudioOption(page: Page, label: string, optionLabel: string) {
  if (label === "Production audience" && !await page.$('dialog[open][aria-label="Source settings"]')) await openStudioDialog(page,"Source settings");
  await openStudioSelect(page, label);
  const expression = `Array.from(document.querySelectorAll('[role="listbox"] [role="option"]')).find(node => node.lastElementChild?.textContent === ${JSON.stringify(optionLabel)})`;
  await page.waitForFunction(expression);
  const node = await page.evaluateHandle(expression);
  try {await node.asElement()!.click();} finally {await node.dispose();}
  await page.waitForFunction("!document.querySelector('[role=\"listbox\"]')");
}

async function layout(page: Page) {
  return await page.evaluate(`(() => {
    const bounds = node => {const {x,y,width,height,bottom} = node.getBoundingClientRect(); return {x,y,width,height,bottom};};
    return {viewport: {width: innerWidth, height: innerHeight}, page: {width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight},
      monitor: bounds(document.querySelector('[data-preview-frame]').parentElement), editor: bounds(document.querySelector('[data-production-workspace]')), timeline: bounds(document.querySelector('[aria-label="Timeline playhead"]'))};
  })()`) as Layout;
}

async function synchronized(page: Page, following = true) {
  try {await page.waitForFunction(`(() => {const preview = document.querySelector('[data-preview-frame]'), composition = document.querySelector('[data-composition-frame]');
    return preview && composition && preview.getAttribute('data-preview-frame') === composition.getAttribute('data-composition-frame')
      && preview.getAttribute('data-preview-moment') === composition.getAttribute('data-composition-moment')
      && (${!following} || preview.getAttribute('data-preview-moment') === document.querySelector('[data-selected-moment]')?.getAttribute('data-selected-moment'));})()`);
  } catch (error) {
    console.error("[Studio synchronization]", await page.evaluate(`(()=>{const preview=document.querySelector('[data-preview-frame]'),composition=document.querySelector('[data-composition-frame]');return {url:location.href,requested:preview?.getAttribute('data-preview-frame'),committed:composition?.getAttribute('data-composition-frame'),requestedMoment:preview?.getAttribute('data-preview-moment'),committedMoment:composition?.getAttribute('data-composition-moment'),properties:document.querySelector('[data-selected-moment]')?.getAttribute('data-selected-moment'),propertiesState:document.querySelector('[aria-label="Moment properties"]')?.innerText};})()`));
    throw error;
  }
}

async function clickMoment(page: Page, id: string) {
  const row = await page.waitForSelector(`[data-moment-id="${id}"] button[aria-label="Seek to moment"]`, {visible: true});
  await row!.click();
  await page.waitForFunction(`document.querySelector('[data-preview-moment]')?.getAttribute('data-preview-moment') === ${JSON.stringify(id)}`);
  await synchronized(page);
}

export async function markStudioLabel(page: Page, name = "Smart", checked = true, waitForSave = true) {
  const expression = `Array.from(document.querySelectorAll('[aria-label="Moment properties"] label')).find(node=>node.textContent?.trim()===${JSON.stringify(name)})?.querySelector('input[type="checkbox"]')`;
  await page.waitForFunction(expression);
  if (await page.evaluate(`${expression}?.checked`) !== checked) {
    const node = await page.evaluateHandle(expression);
    try {await node.asElement()!.click();} finally {await node.dispose();}
    if (waitForSave) await page.waitForFunction("!Array.from(document.querySelectorAll('[aria-label=\"Moment properties\"] button')).some(node=>node.textContent?.trim()==='Saving…')");
  }
}

export async function addStudioTag(page: Page) {
  await page.$eval('[aria-label="Moment properties"] details',node=>{(node as unknown as {open:boolean}).open=true;});
  await clickStudioButton(page,"Add tag");
  const count=await page.$$eval('[aria-label="Moment properties"] input[aria-label^="Tag key"]',nodes=>nodes.length);
  await setStudioInput(page,`Tag key ${count}`,"cut"); await setStudioInput(page,`Tag value ${count}`,"youtube");
  // This helper exercises explicit metadata Save (including known label keys).
  // Checkbox marking is separately proved without pressing Save.
  const existing = await page.$$eval('[aria-label="Moment properties"] input[aria-label^="Tag key"]',nodes=>nodes.findIndex(node=>(node as unknown as {value:string}).value==="label.smart"));
  if (existing < 0) {
    await clickStudioButton(page,"Add tag");
    await setStudioInput(page,`Tag key ${count+1}`,"label.smart"); await setStudioInput(page,`Tag value ${count+1}`,"true");
  } else await setStudioInput(page,`Tag value ${existing+1}`,"true");
}

/** Build finite cut rules through their real controls, without injecting selection state. */
export async function configureStudioCut(page: Page, thinking: "Smart" | "Mistake" | "None" | "All", speech: "Smart" | "Mistake" | "None" | "All") {
  await openStudioDialog(page,"Selected cut rule");
  for (const [kind, value] of [["Thinking",thinking],["Speech",speech]]) {
    await chooseStudioOption(page,`${kind} inclusion`,["Smart","Mistake"].includes(value!) ? "Matching labels" : value!);
    if (["Smart","Mistake"].includes(value!)) for (const label of kind === "Thinking" ? ["Smart","4th wall","Mistake"] : ["Smart","Mistake","Aggressive"]) {
      const selector = `[aria-label="Keep ${kind!.toLowerCase()} marked ${label}"]`;
      if (await page.$eval(selector,node=>(node as unknown as {checked:boolean}).checked) !== (label === value)) await page.click(selector);
    }
  }
  for (const label of ["Include normal gameplay","Add episode opening","Add game result"]) {
    const selector = `[aria-label="${label}"]`;
    if (await page.$eval(selector,node=>(node as unknown as {checked:boolean}).checked)) await page.click(selector);
  }
  await closeStudioDialog(page);
}

/** Actual canonical Studio UI against the caller's isolated API and database. */
export async function proveStudioInterface(page: Page, narrow: Page, fixture: {thoughtId: string; speechId: string; roomSpeechId: string; werewolfUrl: string}) {
  const errors: string[] = [], consoleErrors: string[] = [];
  for (const surface of [page,narrow]) {
    surface.on("pageerror",error=>{errors.push(String(error));console.error("STUDIO_INTERFACE_ERROR",String(error));});
    surface.on("console",message=>{if(message.type()==="error") consoleErrors.push(message.text());});
  }
  await page.bringToFront(); await page.setViewport({width:1440,height:920});
  await page.waitForSelector("[data-composition-frame]"); await synchronized(page);
  const desktop = await layout(page);
  expect(desktop.page.width).toBeLessThanOrEqual(1440); expect(desktop.page.height).toBeLessThanOrEqual(920);
  expect(desktop.editor.y).toBe(0); expect(desktop.monitor.height).toBeGreaterThan(270);
  expect(desktop.monitor.x).toBeGreaterThan(230); expect(desktop.timeline.bottom).toBeLessThan(920);

  await clickMoment(page,fixture.speechId);
  const speechFrame = Number(await page.$eval("[data-preview-frame]",node=>node.getAttribute("data-preview-frame")));
  await page.click(`[data-moment-id="${fixture.thoughtId}"] button:not([aria-label])`);
  await page.waitForFunction(`document.querySelector('[data-selected-moment]')?.getAttribute('data-selected-moment')===${JSON.stringify(fixture.thoughtId)}`);
  await synchronized(page);
  await page.waitForFunction("Number(getComputedStyle(document.querySelector('[data-preview-frame] [data-in-scene-thinking]')).opacity)===1");
  const thoughtContent = Number(await page.$eval("[data-preview-frame]",node=>node.getAttribute("data-preview-frame")));
  expect(thoughtContent).not.toBe(speechFrame);
  expect(await page.$('[data-preview-frame] [data-speech-bubble]')).toBeNull();
  await clickMoment(page,fixture.thoughtId);
  expect(Number(await page.$eval("[data-preview-frame]",node=>node.getAttribute("data-preview-frame")))).toBeLessThan(thoughtContent);
  await page.click(`[data-moment-id="${fixture.thoughtId}"] > button:first-child`);
  await synchronized(page);
  expect(Number(await page.$eval("[data-preview-frame]",node=>node.getAttribute("data-preview-frame")))).toBe(thoughtContent);
  await markStudioLabel(page,"4th wall");
  expect(await page.evaluate("document.body.innerText.includes('Checkbox labels save immediately.')")).toBe(true);
  await setStudioInput(page,"Seek frame",String(speechFrame+1)); await synchronized(page,false);
  expect(await page.$eval("[data-selected-moment]",node=>node.getAttribute("data-selected-moment"))).toBe(fixture.thoughtId);
  await clickStudioButton(page,"Follow current moment"); await synchronized(page);

  // Content selection and start seeking stay distinct; filtering never seeks.
  const beforeFilter = await page.$eval("[data-preview-frame]",node=>node.getAttribute("data-preview-frame"));
  await page.click('[aria-label="Moment type filters"] button:nth-child(2)');
  expect(await page.$$('[data-moment-id] [data-kind="speech"]')).toHaveLength(0);
  expect(await page.$eval("[data-preview-frame]",node=>node.getAttribute("data-preview-frame"))).toBe(beforeFilter);
  await page.click('[aria-label="Moment type filters"] button:first-child');

  const viewport = () => page.evaluate(`(()=>{const timeline=document.querySelector('[aria-label="Timeline playhead"]'),box=timeline.parentElement;return {left:box.scrollLeft,width:box.clientWidth,total:box.scrollWidth,frame:Number(document.querySelector('[data-preview-frame]').getAttribute('data-preview-frame')),duration:Number(timeline.getAttribute('aria-valuemax'))+1};})()`) as Promise<{left:number;width:number;total:number;frame:number;duration:number}>;
  const maximum = (await viewport()).duration-1;
  await setStudioInput(page,"Seek frame",String(Math.floor(maximum*.55))); await synchronized(page);
  const frameBeforeZoom = (await viewport()).frame;
  await setStudioInput(page,"Timeline zoom","2"); // logarithmic slider: four times Fit
  await page.waitForFunction(`(()=>{const box=document.querySelector('[aria-label="Timeline playhead"]').parentElement;return box.scrollWidth>box.clientWidth*3.9 && box.scrollLeft>0;})()`);
  const centered = await viewport();
  console.info("STUDIO_VIEWPORT_PROOF zoom",JSON.stringify(centered));
  expect(Math.abs(centered.frame/centered.duration*centered.total-centered.left-centered.width/2)).toBeLessThan(3);
  expect(centered.frame).toBe(frameBeforeZoom);
  const boxBounds = (await (await page.$('[aria-label="Timeline playhead"]'))!.evaluate(node=> {
    const r=node.parentElement!.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
  }));
  await page.mouse.move(boxBounds.x+boxBounds.width/2,boxBounds.y+boxBounds.height/2);
  await page.mouse.wheel({deltaY:-120});
  await page.waitForFunction(`document.querySelector('[aria-label="Timeline playhead"]').parentElement.scrollWidth>${centered.total}`);
  const wheel = await viewport(); expect(wheel.frame).toBe(frameBeforeZoom);
  expect(Math.abs(wheel.frame/wheel.duration*wheel.total-wheel.left-wheel.width/2)).toBeLessThan(4);
  await page.keyboard.down("Shift"); await page.mouse.wheel({deltaY:100}); await page.keyboard.up("Shift");
  await page.waitForFunction(`document.querySelector('[aria-label="Timeline playhead"]').parentElement.scrollLeft>${wheel.left+50} && !document.querySelector('[aria-label="Auto-scroll timeline"]').checked`);
  expect(await page.$eval('[aria-label="Auto-scroll timeline"]',node=>(node as unknown as {checked:boolean}).checked)).toBe(false);
  const shifted = await viewport(); await page.mouse.wheel({deltaX:-80});
  await page.waitForFunction(`document.querySelector('[aria-label="Timeline playhead"]').parentElement.scrollLeft<${shifted.left-30}`);
  await setStudioInput(page,"Timeline horizontal position","0");
  await page.waitForFunction("document.querySelector('[aria-label=\"Timeline playhead\"]').parentElement.scrollLeft===0");
  expect((await viewport()).frame).toBe(frameBeforeZoom);
  await clickStudioButton(page,"Recenter"); const recentered=await viewport();
  expect(recentered.left).toBeGreaterThan(0);
  expect(await page.$eval('[aria-label="Auto-scroll timeline"]',node=>(node as unknown as {checked:boolean}).checked)).toBe(false);

  // Real captured pointer held at each edge pans and samples continuously.
  const dragFrames: number[] = [];
  await page.mouse.move(boxBounds.x+boxBounds.width-2,boxBounds.y+boxBounds.height/2); await page.mouse.down();
  await page.waitForFunction(`document.querySelector('[aria-label="Timeline playhead"]').parentElement.scrollLeft>${recentered.left+60}`);
  await synchronized(page); dragFrames.push((await viewport()).frame);
  await page.mouse.move(boxBounds.x+2,boxBounds.y+boxBounds.height/2);
  const right = await viewport();
  await page.waitForFunction(`document.querySelector('[aria-label="Timeline playhead"]').parentElement.scrollLeft<${right.left-60}`);
  await synchronized(page); dragFrames.push((await viewport()).frame);
  await page.mouse.up(); expect(dragFrames[0]!).toBeGreaterThan(dragFrames[1]!);
  console.info("STUDIO_VIEWPORT_PROOF drag",JSON.stringify(dragFrames));
  // Losing native capture must stop edge seeking and must not resume playback.
  await clickStudioButton(page,"Play");
  await page.evaluate("(()=>{const node=document.querySelector('[aria-label=\"Timeline playhead\"]');node.addEventListener('pointerdown',event=>{window.__studioPointer=event.pointerId;},{once:true});node.addEventListener('lostpointercapture',()=>{window.__studioLostCapture=true;},{once:true});})()");
  await page.mouse.move(boxBounds.x+boxBounds.width-2,boxBounds.y+boxBounds.height/2); await page.mouse.down();
  await page.mouse.move(boxBounds.x+boxBounds.width-3,boxBounds.y+boxBounds.height/2);
  await page.waitForFunction("Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).some(node=>node.textContent?.trim()==='Play')");
  await page.evaluate("document.querySelector('[aria-label=\"Timeline playhead\"]').releasePointerCapture(window.__studioPointer)");
  await page.mouse.move(boxBounds.x+boxBounds.width/2,boxBounds.y+boxBounds.height/2);
  await page.waitForFunction("window.__studioLostCapture===true"); await page.mouse.up();
  await synchronized(page);
  const cancelled=await viewport();
  await page.evaluate("new Promise(resolve=>setTimeout(resolve,150))");
  expect((await viewport()).frame).toBe(cancelled.frame); expect((await viewport()).left).toBe(cancelled.left);
  expect(await page.evaluate("Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).some(node=>node.textContent?.trim()==='Play')")).toBe(true);
  await setStudioInput(page,"Timeline horizontal position","0");
  await page.click('[aria-label="Auto-scroll timeline"]');
  for(const start of [0,Math.floor(maximum*.35)]) {
    await setStudioInput(page,"Seek frame",String(start));
    const v=await viewport();
    const edgeFrame=Math.min(maximum-3,Math.floor((v.left+v.width*.895)/v.total*v.duration));
    await setStudioInput(page,"Seek frame",String(edgeFrame));
    const before=await viewport(); await clickStudioButton(page,"Play");
    console.info("STUDIO_VIEWPORT_PROOF paging",JSON.stringify(before));
    await page.waitForFunction(`document.querySelector('[aria-label="Timeline playhead"]').parentElement.scrollLeft>${before.left+10}`);
    await clickStudioButton(page,"Pause"); await synchronized(page);
    const after=await viewport(); expect(after.frame/after.duration*after.total-after.left).toBeLessThan(after.width*.4);
  }
  await setStudioInput(page,"Seek frame",String(maximum-2)); await clickStudioButton(page,"Play");
  await page.waitForFunction("Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).some(node=>node.textContent?.trim()==='Play')");
  expect((await viewport()).frame).toBe(maximum);
  await clickStudioButton(page,"Fit"); await page.waitForFunction("document.querySelector('[aria-label=\"Timeline playhead\"]').parentElement.scrollLeft===0");

  // Actual accessible separator resize, native arrow behavior, breakpoint identity.
  await clickMoment(page,fixture.thoughtId); await page.evaluate("window.__studioPlayer=document.querySelector('[data-preview-frame]').firstElementChild");
  const preserved=(await viewport()).frame;
  const separator=(await (await page.$('[role="separator"]'))!.boundingBox())!;
  await page.mouse.move(separator.x+separator.width/2,separator.y+separator.height/2); await page.mouse.down();
  await page.mouse.move(separator.x-130,separator.y+separator.height/2); await page.mouse.up();
  await page.waitForFunction(`document.querySelector('[aria-label="Playable preview"]').getBoundingClientRect().left<${desktop.monitor.x-80}`);
  expect((await layout(page)).monitor.height).toBeGreaterThan(desktop.monitor.height + 20);
  expect((await viewport()).frame).toBe(preserved);
  await page.focus('[role="separator"]'); await page.keyboard.press("ArrowLeft");
  expect((await viewport()).frame).toBe(preserved);
  expect(await page.evaluate("window.__studioPlayer===document.querySelector('[data-preview-frame]').firstElementChild")).toBe(true);
  const muteBeforeResize=await page.evaluate("Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).find(node=>['Mute','Unmute'].includes(node.textContent?.trim()))?.textContent");
  await clickStudioButton(page,"Play");
  const playingSeparator=(await (await page.$('[role="separator"]'))!.boundingBox())!;
  await page.mouse.move(playingSeparator.x+playingSeparator.width/2,playingSeparator.y+playingSeparator.height/2); await page.mouse.down();
  await page.mouse.move(playingSeparator.x+60,playingSeparator.y+playingSeparator.height/2); await page.mouse.up();
  await page.waitForFunction(`Number(document.querySelector('[data-preview-frame]').getAttribute('data-preview-frame'))>${preserved+3}`);
  expect(await page.evaluate("window.__studioPlayer===document.querySelector('[data-preview-frame]').firstElementChild")).toBe(true);
  expect(await page.evaluate("Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).some(node=>node.textContent?.trim()==='Pause')")).toBe(true);
  expect(await page.evaluate("Array.from(document.querySelectorAll('[aria-label=\"Playback controls\"] button')).find(node=>['Mute','Unmute'].includes(node.textContent?.trim()))?.textContent")).toBe(muteBeforeResize);
  await clickStudioButton(page,"Pause"); await setStudioInput(page,"Seek frame",String(preserved)); await synchronized(page);
  await page.setViewport({width:390,height:844}); await synchronized(page);
  expect(await page.evaluate("window.__studioPlayer===document.querySelector('[data-preview-frame]').firstElementChild")).toBe(true);
  await clickStudioButton(page,"Properties");
  expect((await viewport()).frame).toBe(preserved);
  expect(await page.evaluate("window.__studioPlayer===document.querySelector('[data-preview-frame]').firstElementChild")).toBe(true);
  await page.setViewport({width:1440,height:920}); await synchronized(page);

  // Save speech independently via the same annotation owner, build then shorten a cut.
  await clickMoment(page,fixture.thoughtId); await markStudioLabel(page);
  await clickMoment(page,fixture.speechId); await addStudioTag(page);
  const saveSpeech=page.waitForResponse(r=>r.url().includes(`/moments/${encodeURIComponent(fixture.speechId)}/annotation`) && r.request().method()==="POST");
  const saveModifier = await page.evaluate("navigator.platform.toLowerCase().includes('mac')") ? "Meta" : "Control";
  await page.keyboard.down(saveModifier); await page.keyboard.press("Enter"); await page.keyboard.up(saveModifier);
  expect((await saveSpeech).status()).toBe(200);
  await configureStudioCut(page,"Smart","Smart"); await clickStudioButton(page,"Selected cut");
  await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut'");
  expect(await page.$$eval('[data-moment-id]',nodes=>nodes.map(n=>n.getAttribute('data-moment-id')))).toEqual([fixture.thoughtId,fixture.speechId]);
  await clickMoment(page,fixture.speechId); await markStudioLabel(page,"Smart",false);
  await page.waitForFunction(`!document.querySelector('[data-moment-id="${fixture.speechId}"]')`);
  await clickMoment(page,fixture.thoughtId); await setStudioInput(page,"Seek frame","60"); await synchronized(page);
  expect(await page.$eval('[data-preview-frame]',node=>node.textContent?.includes("I will listen closely"))).toBe(false);
  await page.screenshot({path:join(tmpdir(),"production-studio-revised-desktop.png")});
  await clickStudioButton(page,"Source"); await synchronized(page);

  await openStudioDialog(page,"Presentation"); await openStudioSelect(page,"Aspect ratio");
  const dropdown=await page.evaluate(`(()=>{const menu=document.querySelector('[role="listbox"]').getBoundingClientRect(),trigger=document.querySelector('button[role="combobox"][aria-expanded="true"]').getBoundingClientRect();return {left:menu.left,top:menu.top,triggerLeft:trigger.left,triggerBottom:trigger.bottom,right:menu.right,insideDialog:!!document.querySelector('[role="listbox"]').closest('dialog[open]')};})()`) as {left:number;top:number;triggerLeft:number;triggerBottom:number;right:number;insideDialog:boolean};
  expect(dropdown.insideDialog).toBe(true); expect(Math.abs(dropdown.left-dropdown.triggerLeft)).toBeLessThan(12);
  await page.keyboard.press("Escape"); expect(await page.$('dialog[open]')).not.toBeNull();
  await chooseStudioOption(page,"Aspect ratio","Portrait · 9:16");
  expect(await page.$eval('[aria-label="readingRate"]',node=>node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(110);
  await closeStudioDialog(page); await synchronized(page); const portrait=await layout(page);
  const beforeFps=(await viewport()).frame;
  await openStudioDialog(page,"Export selected cut"); await chooseStudioOption(page,"Output size","1920 pixels · full HD"); await chooseStudioOption(page,"Frames per second","60 fps"); await closeStudioDialog(page);
  await synchronized(page); const fullHd=await layout(page);
  expect(Math.abs((await viewport()).frame-beforeFps*2)).toBeLessThanOrEqual(1); expect(fullHd.monitor.height).toBe(portrait.monitor.height);

  await narrow.bringToFront(); await narrow.setViewport({width:390,height:844}); await narrow.waitForSelector("[data-composition-frame]");
  const phone=await layout(narrow); expect(phone.editor.y).toBe(0);
  expect(phone.page.width).toBeLessThanOrEqual(390); expect(phone.page.height).toBeLessThanOrEqual(844); expect(phone.monitor.height).toBeGreaterThan(180);
  expect(await narrow.$eval('[aria-label="Source moment browser"]',node=>node.getBoundingClientRect().height)).toBeGreaterThan(150);
  await clickMoment(narrow,fixture.thoughtId); await clickStudioButton(narrow,"Properties");
  await narrow.waitForSelector('fieldset input[type="checkbox"]',{visible:true});
  expect((await layout(narrow)).monitor.height).toBeGreaterThanOrEqual(phone.monitor.height);
  await openStudioDialog(narrow,"Local recordings"); await closeStudioDialog(narrow);
  await narrow.screenshot({path:join(tmpdir(),"production-studio-revised-narrow.png")});
  await page.bringToFront(); await page.setViewport({width:1000,height:600}); const short=await layout(page);
  expect(short.page.width).toBeLessThanOrEqual(1000); expect(short.page.height).toBeLessThanOrEqual(600);
  await page.setViewport({width:1440,height:920});
  await clickStudioButton(page,"Fullscreen"); await page.waitForFunction("document.fullscreenElement?.hasAttribute('data-production-workspace')");
  await openStudioDialog(page,"Source settings"); await closeStudioDialog(page);
  await clickStudioButton(page,"Fullscreen"); await page.waitForFunction("!document.fullscreenElement");
  await page.goto(fixture.werewolfUrl,{waitUntil:"domcontentloaded"}); await page.waitForSelector("[data-composition-frame]");
  await page.click('[aria-label="Moment type filters"] button:nth-child(2)');
  expect(await page.$$('[data-moment-id]')).toHaveLength(0);
  expect(await page.evaluate("document.body.innerText.includes('Thinking is unavailable in Mystery')")).toBe(true);
  await openStudioDialog(page,"Source settings"); await chooseStudioOption(page,"Production audience","Omniscient");
  await page.waitForSelector('[data-moment-id] [data-kind="thinking"]'); await synchronized(page);
  expect(errors).toEqual([]); expect(consoleErrors.filter(s=>s.includes('unique "key"'))).toEqual([]);
  return {desktop,phone,short,portrait,fullHd,dropdown,dragFrames,playheadZoom:true,realWheelPan:true,heldEdgeDragging:true,lostCaptureStopsSeek:true,playbackPaging:true,resizePreservesPlayer:true,playingResizePreservesPlayback:true,
    limitations:"Isolated canonical data and real browser input. Paid providers, live writes and operator acceptance remain separate."};
}
