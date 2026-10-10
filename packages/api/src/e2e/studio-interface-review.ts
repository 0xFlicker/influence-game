import { expect } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { HTTPRequest, Page } from "puppeteer";

type Bounds = {x: number; y: number; width: number; height: number; bottom: number};
type Layout = {viewport: {width: number; height: number}; page: {width: number; height: number}; monitor: Bounds; editor: Bounds; timeline: Bounds};
type StudioDialog = "Presentation" | "Local recordings" | "Export selected cut" | "Selected cut rule" | "Scene versions & production";

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
  const trigger = {Presentation: "Presentation", "Local recordings": "Recordings", "Export selected cut": "Export…", "Selected cut rule": "Cut rule", "Scene versions & production": "Scene versions…"}[title];
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
  const row = await page.waitForSelector(`[data-moment-id="${id}"] button`, {visible: true});
  await row!.click();
  await page.waitForFunction(`document.querySelector('[data-preview-moment]')?.getAttribute('data-preview-moment') === ${JSON.stringify(id)}`);
  await synchronized(page);
}

/** Actual canonical Studio UI against the caller's isolated API and database. */
export async function proveStudioInterface(page: Page, narrow: Page, fixture: {thoughtId: string; speechId: string; roomSpeechId: string; werewolfUrl: string}) {
  const errors: string[] = [], consoleErrors: string[] = [], failedResponses: {url: string; status: number}[] = [];
  for (const surface of [page, narrow]) {
    surface.on("pageerror", error => {errors.push(String(error)); console.error("[Studio interface pageerror]",String(error));});
    surface.on("console", message => {if (message.type() === "error") consoleErrors.push(message.text());});
    surface.on("response", response => {if (response.status() >= 400) failedResponses.push({url: response.url(), status: response.status()});});
  }
  const influenceUrl = page.url();
  await page.bringToFront(); await page.setViewport({width: 1440, height: 920});
  await page.waitForSelector("[data-composition-frame]"); await synchronized(page);
  const desktop = await layout(page);
  console.info(`STUDIO_INTERFACE_DESKTOP ${JSON.stringify(desktop)}`);
  expect(desktop.page.width).toBeLessThanOrEqual(desktop.viewport.width);
  expect(desktop.page.height).toBeLessThanOrEqual(desktop.viewport.height);
  expect(desktop.monitor.x).toBeGreaterThan(desktop.viewport.width / 2);
  expect(desktop.monitor.height).toBeLessThanOrEqual(272);
  expect(desktop.timeline.bottom).toBeLessThan(desktop.viewport.height);

  // Pinning a displayed draft must not stop transport seeks from discovering
  // a different source row or silently switch the draft to that moment.
  await clickMoment(page, fixture.speechId);
  const speechFrame = Number(await page.$eval("[data-preview-frame]", node => node.getAttribute("data-preview-frame")));
  expect(speechFrame).toBeGreaterThan(0);
  await clickMoment(page, fixture.thoughtId); await page.click('[aria-label="Tag value 1"]');
  await setStudioInput(page, "Seek frame", String(speechFrame)); await synchronized(page, false);
  expect(await page.$eval("[data-selected-moment]", node => node.getAttribute("data-selected-moment"))).toBe(fixture.thoughtId);
  expect(await page.$eval('[data-moment-id] button[data-active="true"]', node => node.parentElement?.getAttribute("data-moment-id"))).toBe(fixture.speechId);
  expect(await page.$eval('[aria-label="Tag value 1"]', node => (node as unknown as {value: string}).value)).toBe("youtube");
  await clickStudioButton(page, "Follow playhead"); await synchronized(page);

  const timeline = await page.$('[aria-label="Timeline playhead"]'), area = (await timeline!.boundingBox())!;
  const maximum = await page.$eval('[aria-label="Timeline playhead"]', node => Number(node.getAttribute("aria-valuemax")));
  await page.mouse.move(area.x + area.width * .12, area.y + area.height / 2); await page.mouse.down();
  const dragFrames: number[] = [];
  for (const part of [.2,.6,.85,.35]) {
    await page.mouse.move(area.x + area.width * part, area.y + area.height / 2);
    await page.waitForFunction(`Math.abs(Number(document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame')) - ${Math.round(maximum * part)}) <= 1`);
    await synchronized(page);
    dragFrames.push(Number(await page.$eval("[data-preview-frame]", node => node.getAttribute("data-preview-frame"))));
  }
  await page.mouse.up(); expect(new Set(dragFrames).size).toBe(4);
  await clickStudioButton(page,"Fullscreen");
  await page.waitForFunction("document.fullscreenElement?.hasAttribute('data-production-workspace')");
  const fullscreenTimeline = (await (await page.$('[aria-label="Timeline playhead"]'))!.boundingBox())!;
  expect(fullscreenTimeline.height).toBeGreaterThan(0);
  await page.mouse.click(fullscreenTimeline.x + fullscreenTimeline.width * .45, fullscreenTimeline.y + fullscreenTimeline.height / 2);
  await page.waitForFunction(`Math.abs(Number(document.querySelector('[data-preview-frame]')?.getAttribute('data-preview-frame'))-${Math.round(maximum*.45)})<=1`); await synchronized(page);
  await clickStudioButton(page,"Fullscreen"); await page.waitForFunction("!document.fullscreenElement");

  // Save an independent speech tag, then remove it and watch the exact
  // thought-only shortened cut through the same compiler and Player.
  await clickMoment(page, fixture.speechId); await clickStudioButton(page, "Add tag");
  const saveSpeech = page.waitForResponse(response => response.url().includes(`/moments/${encodeURIComponent(fixture.speechId)}/annotation`) && response.request().method() === "POST");
  await clickStudioButton(page, "Save tags"); expect((await saveSpeech).status()).toBe(200);
  await clickStudioButton(page, "Selected cut");
  await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut'"); await synchronized(page, false);
  expect(await page.$$eval('[data-moment-id]', nodes => nodes.map(node => node.getAttribute("data-moment-id")))).toEqual([fixture.thoughtId, fixture.speechId]);
  await clickMoment(page, fixture.speechId);
  const beforeRemoval = Number(await page.$eval('[data-composition-frame]', node => node.getAttribute('data-composition-frame')));
  await clickStudioButton(page, "Play");
  await page.waitForFunction(`Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame')) > ${beforeRemoval}`);
  await page.click('[aria-label="Remove tag 1"]');
  expect(await page.$eval('[data-selected-moment]', node => node.getAttribute('data-selected-moment'))).toBe(fixture.speechId);
  expect(await page.$$eval('[aria-label="Playback controls"] button', nodes => nodes.some(node => node.textContent?.trim() === "Play"))).toBe(true);
  let releaseSave!: () => void, sawSave!: () => void;
  const saveGate = new Promise<void>(accept => {releaseSave = accept;});
  const saveRequested = new Promise<void>(accept => {sawSave = accept;});
  const delaySave = async (request: HTTPRequest) => {
    if (request.url().includes(`/moments/${encodeURIComponent(fixture.speechId)}/annotation`) && request.method() === "POST") {sawSave(); await saveGate;}
    await request.continue();
  };
  await page.setRequestInterception(true); page.on("request", delaySave);
  try {
    const removeSpeech = page.waitForResponse(response => response.url().includes(`/moments/${encodeURIComponent(fixture.speechId)}/annotation`) && response.request().method() === "POST");
    await clickStudioButton(page, "Save tags"); await saveRequested;
    expect(await page.$$eval('[aria-label="Moment properties"] button', nodes => nodes.find(node => node.textContent?.trim() === "Add tag")?.hasAttribute("disabled"))).toBe(true);
    expect(await page.$$eval('[aria-label="Moment properties"] button', nodes => nodes.find(node => node.textContent?.trim() === "Saving…")?.hasAttribute("disabled"))).toBe(true);
    releaseSave(); expect((await removeSpeech).status()).toBe(200);
  } finally {releaseSave(); page.off("request", delaySave); await page.setRequestInterception(false);}
  await clickMoment(page, fixture.thoughtId);
  expect(await page.$$eval('[data-moment-id] [data-kind]', nodes => nodes.map(node => node.getAttribute("data-kind")))).toEqual(["thinking"]);
  const cutMaximum = await page.$eval('[aria-label="Timeline playhead"]', node => Number(node.getAttribute("aria-valuemax")));
  expect(cutMaximum).toBeLessThan(maximum);
  await setStudioInput(page, "Seek frame", "60"); await synchronized(page);
  expect(await page.$eval('[data-preview-frame]', node => node.textContent?.includes("I will listen closely"))).toBe(false);
  await clickStudioButton(page, "Play"); await page.waitForFunction("Number(document.querySelector('[data-composition-frame]')?.getAttribute('data-composition-frame')) > 65");
  await clickStudioButton(page, "Pause"); await synchronized(page);
  await page.screenshot({path: join(tmpdir(), "production-studio-revised-desktop.png")});
  await clickStudioButton(page, "Source");
  await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='source'"); await synchronized(page);

  await openStudioDialog(page, "Presentation"); await openStudioSelect(page, "Aspect ratio");
  const dropdown = await page.evaluate(`(() => {
    const menu = document.querySelector('[role="listbox"]').getBoundingClientRect(), trigger = document.querySelector('button[role="combobox"][aria-expanded="true"]').getBoundingClientRect();
    return {left:menu.left,top:menu.top,right:menu.right,bottom:menu.bottom,triggerLeft:trigger.left,triggerBottom:trigger.bottom,insideDialog:!!document.querySelector('[role="listbox"]').closest('dialog[open]')};
  })()`) as {left:number;top:number;right:number;bottom:number;triggerLeft:number;triggerBottom:number;insideDialog:boolean};
  expect(dropdown.insideDialog).toBe(true);
  expect(Math.abs(dropdown.left - dropdown.triggerLeft)).toBeLessThanOrEqual(12);
  expect(Math.abs(dropdown.top - dropdown.triggerBottom)).toBeLessThanOrEqual(12);
  expect(dropdown.right).toBeLessThanOrEqual(desktop.viewport.width);
  await page.keyboard.press("Escape"); expect(await page.$('dialog[open]')).not.toBeNull(); expect(await page.$('[role="listbox"]')).toBeNull();
  await chooseStudioOption(page, "Aspect ratio", "Portrait · 9:16");
  expect(await page.$eval('input[aria-label="readingRate"]', node => node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(110);
  await page.screenshot({path: join(tmpdir(), "production-studio-revised-presentation.png")});
  await closeStudioDialog(page); await synchronized(page); const portrait = await layout(page);
  const beforeFps = Number(await page.$eval('[data-preview-frame]', node => node.getAttribute("data-preview-frame")));
  const beforeFpsMoment = await page.$eval('[data-preview-moment]', node => node.getAttribute("data-preview-moment"));
  await openStudioDialog(page, "Export selected cut");
  await chooseStudioOption(page, "Output size", "1920 pixels · full HD"); await chooseStudioOption(page, "Frames per second", "60 fps");
  await closeStudioDialog(page); await synchronized(page);
  const fullHd = await layout(page); expect(fullHd.monitor.height).toBe(portrait.monitor.height); expect(fullHd.monitor.width).toBe(portrait.monitor.width);
  expect(await page.$eval('[data-preview-moment]', node => node.getAttribute("data-preview-moment"))).toBe(beforeFpsMoment);
  expect(Math.abs(Number(await page.$eval('[data-preview-frame]', node => node.getAttribute("data-preview-frame"))) - beforeFps * 2)).toBeLessThanOrEqual(1);
  await openStudioDialog(page, "Export selected cut"); await chooseStudioOption(page, "Frames per second", "30 fps"); await closeStudioDialog(page);
  await openStudioDialog(page, "Selected cut rule"); await setStudioInput(page,"Cut tag value","festival"); await closeStudioDialog(page);
  const thinkingToggle = "Array.from(document.querySelectorAll('label')).find(node=>node.textContent?.trim()==='Show thinking moments')?.querySelector('input')";
  const toggle = await page.evaluateHandle(thinkingToggle);
  try {await toggle.asElement()!.click();} finally {await toggle.dispose();}
  await page.waitForFunction("document.querySelector('[data-composition-frame]') && !document.querySelector('[data-moment-id] [data-kind=thinking]')");
  await openStudioDialog(page,"Export selected cut");
  expect(await page.$eval('dialog[open]',node=>node.textContent?.includes("1920 pixels · full HD"))).toBe(true);
  expect(await page.$eval('dialog[open]',node=>node.textContent?.includes("30 fps"))).toBe(true); await closeStudioDialog(page);
  await openStudioDialog(page,"Presentation");
  expect(await page.$eval('dialog[open]',node=>node.textContent?.includes("Portrait · 9:16"))).toBe(true); await closeStudioDialog(page);
  await openStudioDialog(page,"Selected cut rule");
  expect(await page.$eval('[aria-label="Cut tag value"]',node=>(node as unknown as {value:string}).value)).toBe("festival");
  await setStudioInput(page,"Cut tag value","youtube"); await closeStudioDialog(page);
  const toggleBack = await page.evaluateHandle(thinkingToggle);
  try {await toggleBack.asElement()!.click();} finally {await toggleBack.dispose();}
  await page.waitForSelector('[data-moment-id] [data-kind="thinking"]'); await synchronized(page);
  await openStudioDialog(page, "Selected cut rule"); await setStudioInput(page, "Cut tag key", "");
  await page.waitForSelector('dialog [role="alert"]'); await setStudioInput(page, "Cut tag key", "cut"); await closeStudioDialog(page);
  await openStudioDialog(page, "Local recordings"); await page.waitForSelector('[aria-label="Import local recordings"]', {visible:true}); await closeStudioDialog(page);
  await clickMoment(page, fixture.roomSpeechId);
  const sceneFrame = Number(await page.$eval('[data-preview-frame]', node => node.getAttribute("data-preview-frame")));
  await openStudioDialog(page, "Scene versions & production"); await page.waitForSelector('[aria-label="Scene inspector"] [role="combobox"]');
  await openStudioSelect(page, "Inspect scene"); await page.keyboard.press("Escape");
  expect(await page.$('dialog[open][aria-label="Scene versions & production"]')).not.toBeNull();
  await closeStudioDialog(page); await synchronized(page);
  expect(Number(await page.$eval('[data-preview-frame]', node => node.getAttribute("data-preview-frame")))).toBe(sceneFrame);

  await narrow.bringToFront(); await narrow.setViewport({width:390,height:844}); await narrow.waitForSelector("[data-composition-frame]");
  const phone = await layout(narrow);
  expect(phone.page.width).toBeLessThanOrEqual(390); expect(phone.page.height).toBeLessThanOrEqual(844); expect(phone.monitor.height).toBeLessThanOrEqual(182);
  expect(await narrow.$eval('[aria-label="Source moment browser"]', node => node.getBoundingClientRect().height)).toBeGreaterThan(120);
  await clickMoment(narrow, fixture.thoughtId); await clickStudioButton(narrow, "Properties"); await narrow.waitForSelector('[aria-label="Tag value 1"]', {visible:true});
  await narrow.click('[aria-label="Tag value 1"]');
  const field = await narrow.$eval('[aria-label="Tag value 1"]', node => ({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom}));
  const body = await narrow.$eval('[aria-label="Moment properties"] > div:nth-of-type(2)', node => ({top:node.getBoundingClientRect().top,bottom:node.getBoundingClientRect().bottom}));
  expect(field.top).toBeGreaterThanOrEqual(body.top); expect(field.bottom).toBeLessThanOrEqual(body.bottom);
  await narrow.screenshot({path: join(tmpdir(), "production-studio-revised-narrow-properties.png")});
  await openStudioDialog(narrow, "Local recordings"); await narrow.waitForSelector('[aria-label="Import local recordings"]', {visible:true}); await closeStudioDialog(narrow);
  await openStudioDialog(narrow, "Presentation"); await openStudioSelect(narrow, "Aspect ratio");
  expect(await narrow.$eval('[role="listbox"]', node => node.getBoundingClientRect().right)).toBeLessThanOrEqual(390);
  await narrow.keyboard.press("End"); await narrow.keyboard.press("Enter"); await closeStudioDialog(narrow);
  await clickStudioButton(narrow, "Source");
  await narrow.screenshot({path: join(tmpdir(), "production-studio-revised-narrow.png")});
  await page.bringToFront(); await page.setViewport({width:1000,height:600}); const short = await layout(page);
  expect(short.page.width).toBeLessThanOrEqual(1000); expect(short.page.height).toBeLessThanOrEqual(600); expect(short.timeline.bottom).toBeLessThanOrEqual(600);
  await page.setViewport({width:1440,height:920}); await page.goto(fixture.werewolfUrl, {waitUntil:"domcontentloaded"}); await page.waitForSelector('[data-composition-frame]');
  expect(await page.$$('[data-moment-id] [data-kind="thinking"]')).toHaveLength(0);
  await chooseStudioOption(page, "Production audience", "Omniscient"); await page.waitForSelector('[data-moment-id] [data-kind="thinking"]'); await synchronized(page);
  await page.screenshot({path: join(tmpdir(), "production-studio-revised-werewolf.png")});
  // The audience selector sits outside a dialog. Its portal must remain inside
  // the native fullscreen tree rather than disappearing behind that top layer.
  const dialogueRow = await page.waitForSelector('[data-moment-id] [data-kind="speech"]');
  const dialogueId = (await dialogueRow!.evaluate(node => node.closest('[data-moment-id]')!.getAttribute('data-moment-id')))!;
  await clickMoment(page,dialogueId);
  const dialogueFrame = await page.$eval('[data-composition-frame]',node => Number(node.getAttribute('data-composition-frame')));
  await clickStudioButton(page,"Fullscreen");
  await page.waitForFunction("document.fullscreenElement?.hasAttribute('data-production-workspace')");
  await openStudioSelect(page,"Production audience");
  const fullscreenAudienceMenu = await page.evaluate(`(() => {
    const menu=document.querySelector('[role="listbox"]'), bounds=menu.getBoundingClientRect();
    return {insideFullscreen:document.fullscreenElement.contains(menu),visible:menu.getClientRects().length>0,
      left:bounds.left,top:bounds.top,right:bounds.right,bottom:bounds.bottom,width:bounds.width,height:bounds.height,viewportWidth:innerWidth,viewportHeight:innerHeight};
  })()`) as {insideFullscreen:boolean;visible:boolean;left:number;top:number;right:number;bottom:number;width:number;height:number;viewportWidth:number;viewportHeight:number};
  expect(fullscreenAudienceMenu.insideFullscreen).toBe(true); expect(fullscreenAudienceMenu.visible).toBe(true);
  expect(fullscreenAudienceMenu.width).toBeGreaterThan(0); expect(fullscreenAudienceMenu.height).toBeGreaterThan(0);
  expect(fullscreenAudienceMenu.left).toBeGreaterThanOrEqual(0); expect(fullscreenAudienceMenu.top).toBeGreaterThanOrEqual(0);
  expect(fullscreenAudienceMenu.right).toBeLessThanOrEqual(fullscreenAudienceMenu.viewportWidth);
  expect(fullscreenAudienceMenu.bottom).toBeLessThanOrEqual(fullscreenAudienceMenu.viewportHeight);
  await page.screenshot({path:join(tmpdir(),"production-studio-revised-fullscreen-audience.png")});
  await page.keyboard.press("Escape"); await page.waitForFunction("!document.querySelector('[role=\"listbox\"]')");
  expect(await page.evaluate("document.activeElement?.getAttribute('role')==='combobox' && document.getElementById(document.activeElement.getAttribute('aria-labelledby')?.split(' ')[0])?.textContent==='Production audience'")).toBe(true);
  await synchronized(page);
  expect(await page.$eval('[data-composition-frame]',node => Number(node.getAttribute('data-composition-frame')))).toBe(dialogueFrame);
  expect(await page.$eval('[data-composition-moment]',node => node.getAttribute('data-composition-moment'))).toBe(dialogueId);
  // Escape may also leave native fullscreen; either way, restore the ordinary
  // editing window before the remainder of the actual interface proof.
  if (await page.evaluate("!!document.fullscreenElement")) {await clickStudioButton(page,"Fullscreen"); await page.waitForFunction("!document.fullscreenElement");}
  await page.goto(influenceUrl, {waitUntil:"domcontentloaded"}); await page.waitForSelector('[data-composition-frame]');
  await clickMoment(page, fixture.thoughtId); await clickStudioButton(page, "Selected cut");
  await page.waitForFunction("document.querySelector('[data-preview-view]')?.getAttribute('data-preview-view')==='cut'"); await synchronized(page);
  expect(errors).toEqual([]); expect(consoleErrors.filter(message => message.includes('unique "key"'))).toEqual([]);
  return {desktop,phone,short,portrait,fullHd,dropdown,dragFrames,fullscreenAudienceMenu,fullscreenSeekSynchronized:true,draftPinPreserved:true,independentSpeechTagsSaved:true,fpsAnchorPreserved:true,thinkingToggleRetainedSetup:true,consoleErrors,failedResponses,
    images:["desktop","narrow","werewolf","presentation","narrow-properties","fullscreen-audience"].map(name => join(tmpdir(), `production-studio-revised-${name}.png`)),
    limitations:"Actual canonical editing against an isolated local API/database. Recording audio, exact repair/publication and encoded parity remain separate canonical tests; no paid providers or live writes."};
}
