import { expect } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import type { Page, HTTPRequest } from "puppeteer";

/** No provider calls: delay real fixture reads and observe the actual App Router DOM. */
export async function checkAdminContinuity(page: Page, gameId: string) {
  const directory = process.env.INFLUENCE_E2E_RECORD_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  const recorder = directory ? await page.screencast({ path: `${directory}/admin-continuity.webm`, ffmpegPath: Bun.which("ffmpeg") ?? "ffmpeg" }) : null;
  const requests: Array<{ path: string; elapsed: number }> = [];
  const started = Date.now();
  let held: HTTPRequest | undefined, hold = true, fail = false;
  await page.setRequestInterception(true);
  const intercept = (request: HTTPRequest) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/admin/")) requests.push({path, elapsed: Date.now() - started});
    if (request.method() === "GET" && path === `/api/admin/werewolf/${gameId}/costs`) {
      if (hold) { held = request; return; }
      if (fail) { void request.respond({status:503, contentType:"application/json", headers:{"Access-Control-Allow-Origin":"*"}, body:JSON.stringify({error:"Cost fixture unavailable"})}); return; }
    }
    void request.continue();
  };
  page.on("request", intercept);
  await page.evaluate(`window.__continuity = { header:document.querySelector('[data-game-header]'), shell:document.querySelector('[data-admin-shell]'), frames:0, blank:0, changed:0, owners:0 }; window.__continuitySampling = true; (function sample(){if(!window.__continuitySampling)return; const m=window.__continuity,p=document.querySelector('[data-workspace-section]');m.frames++; if(!p || !p.textContent.trim())m.blank++;if(m.header!==document.querySelector('[data-game-header]')||m.shell!==document.querySelector('[data-admin-shell]'))m.changed++;if(document.querySelectorAll('[data-workspace-section]').length!==1)m.owners++;requestAnimationFrame(sample)})()`);
  const pane = (name: string) => page.waitForFunction(`document.querySelector('[data-workspace-section]')?.dataset.workspaceSection === ${JSON.stringify(name)} && !document.querySelector('[data-workspace-section]').inert`);
  const select = (name: string) => page.evaluate(`document.querySelector('nav[aria-label="Game workspace"] a[href${name === "overview" ? "=" : "*="}${JSON.stringify(name === "overview" ? `/admin/werewolf/${gameId}?${new URL(page.url()).searchParams}` : `/${name}?`)}]')?.click()`);
  try {
    const initialUrl = page.url(), initialHistory = await page.evaluate("history.length");
    await select("costs");
    await page.waitForFunction("document.body.innerText.includes('Opening Costs')");
    expect(page.url()).toBe(initialUrl);
    expect(await page.evaluate("document.querySelector('[data-workspace-section]').dataset.workspaceSection")).toBe("overview");
    expect(await page.evaluate("document.querySelector('[data-workspace-section]').inert")).toBe(true);
    // A later selection wins while the old request still has no response.
    await select("activity"); await pane("activity");
    hold = false; if (!held) throw new Error("Delayed cost request was not issued"); await held.continue();
    await page.waitForFunction("document.querySelector('[data-workspace-section]').dataset.workspaceSection === 'activity'");
    expect(new URL(page.url()).pathname.endsWith("/activity")).toBe(true);
    await page.evaluate("window.scrollTo(0,120)");
    const activityScroll = await page.evaluate("window.scrollY") as number;
    expect(activityScroll).toBeGreaterThan(0);
    await select("costs"); await pane("costs");
    expect(Math.abs((await page.evaluate("window.scrollY") as number)-activityScroll)).toBeLessThan(4);
    expect(await page.evaluate("history.length")).toBe(Number(initialHistory) + 2);
    const beforeWarm = requests.filter(r=>r.path.endsWith("/activity")).length;
    await page.goBack(); await pane("activity");
    expect(Math.abs((await page.evaluate("window.scrollY") as number)-activityScroll)).toBeLessThan(4);
    await page.goForward(); await pane("costs");
    expect(requests.filter(r=>r.path.endsWith("/activity")).length).toBe(beforeWarm);
    await select("overview"); await pane("overview");
    // Cached section data expires after ten seconds; force an actual failed preparation.
    await page.evaluate("window.dispatchEvent(new Event('blur'))");
    await new Promise(resolve => setTimeout(resolve, 10_100));
    fail = true;
    const beforeFailure = page.url(), historyBeforeFailure = await page.evaluate("history.length");
    await select("costs"); await page.waitForFunction("document.body.innerText.includes('Cost fixture unavailable')");
    expect(page.url()).toBe(beforeFailure); expect(await page.evaluate("history.length")).toBe(historyBeforeFailure);
    await pane("overview");
    fail = false;
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Retry')?.click()"); await pane("costs");
    await page.emulateMediaFeatures([{name:"prefers-reduced-motion",value:"reduce"}]);
    await page.setViewport({width:390,height:844});
    await page.select('label select', 'activity'); await pane("activity");
    expect(await page.evaluate("document.querySelector('[data-workspace-section]').getAnimations({subtree:true}).filter(a=>a.playState==='running').length")).toBe(0);
    expect(await page.evaluate("document.documentElement.scrollWidth <= innerWidth")).toBe(true);
    await page.select('label select', 'overview'); await pane("overview");
    expect(await page.evaluate("document.activeElement?.textContent")).toBe("Game overview");
    const evidence = await page.evaluate("JSON.stringify({frames:window.__continuity.frames,blank:window.__continuity.blank,changed:window.__continuity.changed,owners:window.__continuity.owners})") as string;
    const stats = JSON.parse(evidence) as {frames:number;blank:number;changed:number;owners:number};
    expect(stats.frames).toBeGreaterThan(0); expect(stats.blank).toBe(0); expect(stats.changed).toBe(0); expect(stats.owners).toBe(0);
    if(directory) { await writeFile(`${directory}/admin-continuity.json`,JSON.stringify({stats,requests},null,2)); await page.screenshot({path:`${directory}/reduced-motion-mobile.png`}); }
  } finally {
    await page.evaluate("window.__continuitySampling=false");
    page.off("request",intercept); await page.setRequestInterception(false);
    await recorder?.stop();
    await page.emulateMediaFeatures([]); await page.setViewport({width:1440,height:1000});
  }
}
