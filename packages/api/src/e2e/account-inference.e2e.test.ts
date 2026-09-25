import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq} from 'drizzle-orm';
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
 await Promise.all(['/dashboard/agents/create','/admin/inference'].map(path=>fetch(`${servers.webUrl}${path}`,{signal:AbortSignal.timeout(60000)}).then(response=>{if(!response.ok)throw new Error(`Browser page failed: ${path}`);})));
 browser=await launchBrowser();
},120000);
afterAll(async()=>{await cleanupE2eResources([
 ['browser',async()=>{if(browser)await closeBrowser(browser);}],['servers',async()=>{if(servers)await stopTestServers(servers);}],['database',async()=>{if(database)await destroyIsolatedTestDb(database.databaseUrl);}]
]);},60000);
test('owner exhaustion preserves draft, admin grants allowance and sees usage controls',async()=>{
 const page=await createAuthenticatedPage(browser,owner.jwt,`${servers.webUrl}/dashboard/agents/create`,{privateKey:owner.wallet.privateKey});
 try {
  await page.waitForSelector('textarea[aria-label="Message the character assistant"]',{timeout:30000});
  await page.type('textarea[aria-label="Message the character assistant"]','A patient detective with a dry sense of humor');
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
  const denied=await fetch(`${servers.apiUrl}/api/admin/inference/usage`,{headers:{Authorization:`Bearer ${owner.jwt}`}});expect(denied.status).toBe(403);
 }finally{await adminPage.close();}
},120000);
