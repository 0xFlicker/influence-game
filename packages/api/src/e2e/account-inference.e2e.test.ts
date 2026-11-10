import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq} from 'drizzle-orm';
import {reserveInference,settleInference} from '../services/inference-allowances.js';
import type {Browser} from 'puppeteer';
import {schema} from '../db/index.js';
import {recordCurrentLegalAcceptance} from '../services/legal-acceptance.js';
import {createAdminUser,createPlayerUser} from './test-auth.js';
import {closeBrowser,createAuthenticatedPage,launchBrowser} from './test-browser.js';
import {createIsolatedTestDb,destroyIsolatedTestDb,type TestDB} from './test-db.js';
import {startTestServers,stopTestServers,type TestServerHandles} from './test-server.js';
import {cleanupE2eResources} from './cleanup.js';
process.env.JWT_SECRET='e2e-test-jwt-secret';
let database:TestDB,servers:TestServerHandles,browser:Browser;
let admin:Awaited<ReturnType<typeof createAdminUser>>,owner:Awaited<ReturnType<typeof createPlayerUser>>;
beforeAll(async()=>{
 database=await createIsolatedTestDb();admin=await createAdminUser(database.db);owner=await createPlayerUser(database.db,0);
 for(const id of [admin.userId,owner.userId])await recordCurrentLegalAcceptance(database.db,id,'existing_account','0123456789abcdef0123456789abcdef01234567');
 await database.db.insert(schema.inferenceAccounts).values({userId:owner.userId,textBalance:0});
 servers=await startTestServers({databaseUrl:database.databaseUrl,adminAddress:admin.wallet.address,jwtSecret:process.env.JWT_SECRET,logDirectory:'/tmp/inference-browser-logs'});
 await Promise.all(['/agents/create','/admin/inference'].map(path=>fetch(`${servers.webUrl}${path}`,{signal:AbortSignal.timeout(60000)}).then(response=>{if(!response.ok)throw new Error(`Browser page failed: ${path}`);})));
 browser=await launchBrowser();
},120000);
afterAll(async()=>{await cleanupE2eResources([
 ['browser',async()=>{if(browser)await closeBrowser(browser);}],['servers',async()=>{if(servers)await stopTestServers(servers);}],['database',async()=>{if(database)await destroyIsolatedTestDb(database.databaseUrl);}]
]);},60000);
test('owner exhaustion preserves draft, admin grants allowance and sees usage controls',async()=>{
 const page=await createAuthenticatedPage(browser,owner.jwt,`${servers.webUrl}/agents/create`,{privateKey:owner.wallet.privateKey});
 try {
  await page.waitForSelector('textarea[aria-label="Message the character assistant"]:not([disabled])',{timeout:30000});
  await page.type('textarea[aria-label="Message the character assistant"]','A patient detective with a dry sense of humor');
  await page.waitForSelector('button[aria-label="Send"]:not([disabled])');
  await page.$eval('button[aria-label="Send"]', button => button.scrollIntoView({ block: 'center' }));
  await page.click('button[aria-label="Send"]');
  await page.waitForSelector('dialog[open]',{timeout:20000});
  expect(await page.$eval('dialog[open]',el=>el.textContent)).toContain('Need more generations?');
  expect(await page.evaluate(`document.querySelector('textarea[aria-label="Message the character assistant"]').value`)).toContain('patient detective');
  await page.screenshot({path:'/tmp/inference-contact.png',fullPage:true});
 } finally{await page.close();}
 const adminPage=await createAuthenticatedPage(browser,admin.jwt,`${servers.webUrl}/admin/inference?userId=${owner.userId}`,{privateKey:admin.wallet.privateKey});
 try {
  await adminPage.waitForFunction("document.body.innerText.includes('Available text: 0')",{timeout:30000});
  await adminPage.type('input[maxlength="2000"]','Requested refill');
  await adminPage.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Add allowance')?.click()");
  await adminPage.waitForFunction("document.body.innerText.includes('25 granted')",{timeout:20000});
  expect((await database.db.select().from(schema.inferenceAccounts).where(eq(schema.inferenceAccounts.userId,owner.userId)))[0]!.textGrant).toBe(25);
  await adminPage.setViewport({width:390,height:844});await adminPage.screenshot({path:'/tmp/inference-admin-mobile.png',fullPage:true});
  await database.db.transaction(async tx=>{const id=crypto.randomUUID();await reserveInference(tx,{id,userId:owner.userId,category:'text',inputHash:'browser-fixture'});await settleInference(tx,id,owner.userId,'uncertain');});
  await adminPage.evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Pause generation')?.click()");
  await adminPage.waitForFunction("document.body.innerText.includes('Resume generation')");
  await adminPage.goto(`${servers.webUrl}/admin/inference?status=pending&sort=pending&window=24h`,{waitUntil:'networkidle0'});
  await adminPage.waitForFunction("document.querySelector('tbody')?.innerText.includes('1 pending (1 uncertain)')");
  expect(await adminPage.$eval('tbody',el=>el.textContent)).toContain('Generation paused');
  await adminPage.select('select[aria-label="Account generation status"]','paused');
  await adminPage.waitForFunction("location.search.includes('status=paused')");
  await adminPage.waitForFunction("document.querySelector('tbody')?.innerText.includes('Generation paused')");
  await adminPage.screenshot({path:'/tmp/inference-status-mobile.png',fullPage:true});
  const denied=await fetch(`${servers.apiUrl}/api/admin/inference/usage`,{headers:{Authorization:`Bearer ${owner.jwt}`}});expect(denied.status).toBe(403);
 }finally{await adminPage.close();}
},120000);


// The removed Workshop and Advanced assistant controls were replaced by the
// shared Guided editor. Scoped visual updates are covered by
// agent-workspace.e2e.test.ts and agent-profiles.test.ts; missing identity and
// failed-save recovery are covered by agent-form-draft-recovery.test.tsx.

test('incomplete identity can be completed and a failed save retried',async()=>{
 const agentId='11111111-1111-4111-8111-111111111111';
 const original={id:agentId,name:'Legacy Arden',personality:'Warm and steady.',backstory:'A careful negotiator.',strategyStyle:'Build lasting alliances.',personaKey:null,gender:null,avatarUrl:'/avatars/personas/strategic.png',fullBodyReferenceUrl:'/avatars/personas/strategic.png',performanceInstructions:'Soft voice',visualDesign:'A blue coat',gamesPlayed:2,gamesWon:1,createdAt:'2026-08-01T00:00:00.000Z',updatedAt:'2026-08-01T00:00:00.000Z'};
 const page=await createAuthenticatedPage(browser,owner.jwt,`${servers.webUrl}/dashboard`,{privateKey:owner.wallet.privateKey});
 const saves:Record<string,unknown>[]=[];
 const generations:Record<string,unknown>[]=[];
 try {
  await page.setRequestInterception(true);
  page.on('request',request=>{
   const path=new URL(request.url()).pathname;
   const respond=(body:unknown,status=200)=>request.respond({status,contentType:'application/json',headers:{'access-control-allow-origin':servers.webUrl,'access-control-allow-credentials':'true'},body:JSON.stringify(body)});
   if(path===`/api/agent-profiles/${agentId}` && request.method()==='GET') void respond(original);
   else if(path==='/api/agent-profiles/generate' && request.method()==='POST') {
    generations.push(JSON.parse(request.postData()!));
    void respond({...original,name:'Unwanted rename',personality:'Unwanted rewrite',gender:'female',personaKey:'loyalist',werewolfStrategyStyle:'Compare claims before voting.',introQuips:[]});
   } else if(path===`/api/agent-profiles/${agentId}` && request.method()==='PATCH') {
    saves.push(JSON.parse(request.postData()!));
    void respond(saves.length===1?{error:'Save unavailable. Try again.'}:{...original,...saves.at(-1),receipt:{publication:'held'}},saves.length===1?503:200);
   } else void request.continue();
  });
  await page.goto(`${servers.webUrl}/dashboard/agents/${agentId}/edit`,{waitUntil:'networkidle0'});
  await page.waitForSelector('#agent-name');
  expect(await page.$eval('button[type="submit"]',button=>(button as unknown as {disabled:boolean}).disabled)).toBe(true);
  await page.evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Complete').click()");
  await page.waitForSelector('#agent-gender-female[aria-checked="true"]');
  expect(generations).toHaveLength(1);
  expect(generations[0]!.selectedFields).toEqual(expect.arrayContaining(['personaKey','gender']));
  expect(await page.$eval('#agent-name',element=>(element as unknown as {value:string}).value)).toBe(original.name);
  expect(await page.$eval('#agent-personality',element=>(element as unknown as {value:string}).value)).toBe(original.personality);
  await page.evaluate("[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Review').click()");
  await page.waitForSelector('[role="dialog"][aria-label="Review changes"]');
  await page.evaluate("[...document.querySelector('[aria-label=\"Review changes\"]').querySelectorAll('button')].find(button=>button.textContent.trim()==='Save').click()");
  await page.waitForSelector('[aria-label="Review changes"] [role="alert"]');
  await page.evaluate("[...document.querySelector('[aria-label=\"Review changes\"]').querySelectorAll('button')].find(button=>button.textContent.trim()==='Save').click()");
  await page.waitForFunction('location.pathname === "/dashboard/agents"');
  expect(saves).toHaveLength(2);
  expect(saves[1]).toMatchObject({name:original.name,personality:original.personality,gender:'female',personaKey:'loyalist',fullBodyReferenceUrl:original.fullBodyReferenceUrl});
  expect(saves[1]!.submissionId).toBe(saves[0]!.submissionId);
 } finally { await page.close(); }
},120000);
