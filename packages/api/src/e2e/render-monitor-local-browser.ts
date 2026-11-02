import {join,resolve} from "node:path";
import {mkdir,readdir,readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {launchBrowser,createAuthenticatedPage,closeBrowser} from "./test-browser";
import {cleanupE2eResources} from "./cleanup";
import type {Browser,Page} from "puppeteer";

/** Real localhost Next dev UI. This owns its child, browser, screenshots and download folder. */
export async function openLocalRenderMonitor(apiOrigin:string,token:string,output:string) {
  const portReservation=Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response()});
  const port=portReservation.port;portReservation.stop(true);const webUrl=`http://localhost:${port}`;
  const webRoot=resolve(import.meta.dir,"../../../web"),node=Bun.which("node");if(!node)throw new Error("Local Next browser proof requires Node");
  const web=Bun.spawn([node,"./node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1"],{cwd:webRoot,
    env:{...process.env,NODE_ENV:"development",PORT:String(port),API_URL:"",NEXT_PUBLIC_API_URL:"",API_BACKEND_URL:apiOrigin,
      NEXT_PUBLIC_E2E_AUTH:"true",NEXT_PUBLIC_E2E_LAYERED_AUTH:"true",MANAGED_AUTH_MODE:"full",PRIVY_APP_ID:"e2e-test-privy-app-id-001",NEXT_PUBLIC_PRIVY_APP_ID:"e2e-test-privy-app-id-001",
      CLERK_PUBLISHABLE_KEY:"pk_test_layered_auth_e2e",NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:"pk_test_layered_auth_e2e"},
    stdout:Bun.file(join(output,"web-stdout.log")),stderr:Bun.file(join(output,"web-stderr.log"))});
  let browser:Browser|undefined,page:Page|undefined;
  async function close() {
    await cleanupE2eResources([
      ["monitor browser",async()=>{if(browser)await closeBrowser(browser);}],
      ["monitor Next child",async()=>{if(web.exitCode===null)web.kill();await web.exited;}],
      ["generated Next paths",async()=> {
        const envPath=join(webRoot,"next-env.d.ts"),configPath=join(webRoot,"tsconfig.json");
        const env=await readFile(envPath,"utf8"),config=await readFile(configPath,"utf8");
        const restored=env.replace('import "./.next/e2e/dev/types/routes.d.ts";','import "./.next/dev/types/routes.d.ts";');
        const restoredConfig=config.replace(/,\n\s*"\.next\/e2e\/types\/\*\*\/\*\.ts",\n\s*"\.next\/e2e\/dev\/types\/\*\*\/\*\.ts"/,"");
        if(restored!==env)await writeFile(envPath,restored);if(restoredConfig!==config)await writeFile(configPath,restoredConfig);
      }],
    ]);
  }
  try {
    const deadline=Date.now()+60000;
    while(true) {
      if(web.exitCode!==null||Date.now()>deadline)throw new Error(`Local monitor web startup failed; inspect ${output}`);
      try {if((await fetch(`${webUrl}/admin/production/renders`,{signal:AbortSignal.timeout(1000)})).ok)break;}catch { /* Bounded owned-child startup poll. */ }
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    browser=await launchBrowser();page=await createAuthenticatedPage(browser,token,`${webUrl}/admin/production/renders`);
    await page.emulateTimezone("America/Denver");await page.setViewport({width:1440,height:1000});
    await page.waitForSelector('[aria-label="Global render monitor"]');
    const downloadDirectory=join(output,"browser-downloads");await mkdir(downloadDirectory,{recursive:true});
    const downloads=await browser.target().createCDPSession();
    const monitor=page;
    async function job(jobId:string,state:string,filename:string) {
      await monitor.goto(`${webUrl}/admin/production/renders?search=${encodeURIComponent(jobId)}`,{waitUntil:"domcontentloaded"});
      await monitor.waitForFunction(`document.querySelector('[data-render-job-id="${jobId}"]')?.getAttribute('data-state')===${JSON.stringify(state)}`);
      await monitor.screenshot({path:join(output,filename),fullPage:true});
    }
    async function download(jobId:string,expected:{sha256:string;byteLength:number}) {
      const jobDirectory=join(downloadDirectory,jobId);await mkdir(jobDirectory,{recursive:true});
      await downloads.send("Browser.setDownloadBehavior",{behavior:"allow",downloadPath:jobDirectory});
      const grant=monitor.waitForResponse(response=>new URL(response.url()).pathname===`/api/admin/renders/${jobId}/download`&&response.request().method()==="POST");
      await monitor.locator(`[data-render-job-id="${jobId}"] button`).filter(button=>button.textContent?.trim()==="Download video").click();
      const response=await grant;if(!response.ok())throw new Error(`Browser download grant failed (${response.status()})`);
      const deadline=Date.now()+30000;
      while(Date.now()<deadline) {
        for(const name of await readdir(jobDirectory)) {
          if(name.endsWith(".crdownload"))continue;
          const path=join(jobDirectory,name),file=Bun.file(path);if(file.size!==expected.byteLength)continue;
          const sha256=createHash("sha256").update(await file.bytes()).digest("hex");
          if(sha256!==expected.sha256)throw new Error("Browser download differs from the verified output");
          return path;
        }
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      throw new Error("Browser private download did not complete");
    }
    async function overview() {
      await monitor.goto(`${webUrl}/admin/production/renders`,{waitUntil:"domcontentloaded"});await monitor.waitForSelector('[data-render-job-id]');
      await monitor.screenshot({path:join(output,"global-render-monitor-verified.png"),fullPage:true});
    }
    return {webUrl,job,download,overview,close};
  }catch(error){await close();throw error;}
}
