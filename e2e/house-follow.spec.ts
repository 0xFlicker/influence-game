import {test,expect,type Page,type WebSocketRoute} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let bundle:string;
const pair='a'.repeat(64),operator=`http://localhost:3001/admin/follow/fixture#housePort=8787&pair=${pair}`;
test.beforeAll(()=>{
 const dir=mkdtempSync(join(tmpdir(),'house-follow-'));
 try{execFileSync('bun',['build','packages/web/src/__tests__/fixtures/house-follow-browser.tsx','--define','process.env={}','--outfile',join(dir,'fixture.js')]);bundle=readFileSync(join(dir,'fixture.js'),'utf8');}
 finally{rmSync(dir,{recursive:true,force:true});}
});
async function fixture(page:Page,prelude=""){
 await page.route('http://localhost:3001/**',route=>{
  const path=new URL(route.request().url()).pathname;
  return path==='/fixture.js'?route.fulfill({contentType:'text/javascript',body:prelude+bundle}):path.startsWith('/api/')?route.fallback():route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module" src="/fixture.js"></script>'});
 });
}
for(const path of ['/games/fixture','/games/fixture/replay','/embed/games/fixture'])test(`public player ${path} has no follow UI or connections`,async({page})=>{
 await fixture(page);let connections=0,privateReads=0;
 await page.routeWebSocket(/localhost:8787/,()=>{connections++;});
 await page.route('**/api/admin/production/**',route=>{privateReads++;return route.abort();});
 await page.goto(`http://localhost:3001${path}#housePort=8787&pair=${pair}`);
 await page.getByRole('button',{name:'Reveal action'}).click();
 await page.getByRole('button',{name:'Toggle game speech'}).click();
 await expect(page.getByRole('button',{name:/follow|share game/i})).toHaveCount(0);
 await expect(page.getByLabel('House port')).toHaveCount(0);
 expect(connections).toBe(0);expect(privateReads).toBe(0);
});
for(const role of ['','gamer','admin'])test(`operator route denies non-producer role: ${role||'anonymous'}`,async({page})=>{
 await fixture(page);let connections=0;
 await page.routeWebSocket(/localhost:8787/,()=>{connections++;});
 await page.goto(operator.replace('#',`?role=${role}#`));
 await expect(page.getByRole('alert')).toHaveText('Producer or Sysop access is required for this player.');
 await expect(page.getByRole('button',{name:'Reveal action'})).toHaveCount(0);expect(connections).toBe(0);
});
test('paired operator speech ducks once across handoffs and disconnect restores selected music',async({page})=>{
 await fixture(page);let bridge:WebSocketRoute|undefined;
 await page.routeWebSocket(`ws://localhost:8787/follow?pair=${pair}`,ws=>{bridge=ws;ws.onMessage(()=>{});ws.send(JSON.stringify({type:'connected'}));});
 await page.goto(operator);await expect(page.getByRole('status',{name:'House connection'})).toHaveText('Connected to House Studio');
 const volume=page.getByLabel('Music volume'),house=(speaking:boolean)=>bridge!.send(JSON.stringify({type:'host-speech',speaking}));
 await expect(volume).toHaveText('0.80');house(true);await expect(volume).toHaveText('0.28');
 await page.getByRole('button',{name:'Toggle game speech'}).click();house(false);await expect(volume).toHaveText('0.28');
 house(true);await page.getByRole('button',{name:'Toggle game speech'}).click();await expect(volume).toHaveText('0.28');
 await page.getByRole('button',{name:'Lower music'}).click();await expect(volume).toHaveText('0.14');
 house(false);await expect(volume).toHaveText('0.40');house(true);await expect(volume).toHaveText('0.14');
 bridge!.close();await expect(volume).toHaveText('0.40');
});
test('operator context follows the reveal clock and ignores obsolete seek responses',async({page})=>{
 await fixture(page);const messages:Record<string,unknown>[]=[],requests:number[]=[];
 let release:()=>void=()=>{};
 await page.route('**/api/admin/production/games/fixture/follow-context',async route=>{
  const position=route.request().postDataJSON();requests.push(position.cursor);
  if(position.cursor===2)await new Promise<void>(r=>{release=r;});
  await route.fulfill({json:{schemaVersion:1,game:{id:'fixture',slug:'fixture',kind:'werewolf'},position,visibility:'omniscient',rules:{},roster:[],state:{cursor:position.cursor},current:{canonical:'structured speech'},history:[],thinking:[{thinking:'Allowed even with UI thinking off'}]}}).catch(()=>{});
 });
 await page.routeWebSocket(`ws://localhost:8787/follow?pair=${pair}`,ws=>{ws.onMessage(raw=>messages.push(JSON.parse(String(raw))));ws.send(JSON.stringify({type:'connected'}));});
 await page.goto(operator);await expect(page.getByRole('status',{name:'House connection'})).toHaveText('Connected to House Studio');expect(requests).toEqual([]);
 await page.getByRole('button',{name:'Reveal action'}).click();await expect.poll(()=>messages.filter(m=>m.type==='context').length).toBe(1);
 expect(JSON.stringify(messages)).toContain('Allowed even with UI thinking off');expect(JSON.stringify(messages)).not.toContain('NEVER_SEND');
 await page.locator('#untrusted').evaluate(node=>node.remove());expect(requests).toEqual([1]);
 await page.getByRole('button',{name:'Advance',exact:true}).click();await expect.poll(()=>requests).toEqual([1,2]);
 await page.getByRole('button',{name:'Advance',exact:true}).click();await expect.poll(()=>messages.filter(m=>m.type==='context').length).toBe(2);
 release();await page.waitForTimeout(100);expect(messages.filter(m=>m.type==='context').map(m=>(m.knowledge as {position:{cursor:number}}).position.cursor)).toEqual([1,3]);
 await page.unrouteAll({behavior:'ignoreErrors'});
});
test('a replaced operator session unmounts the old playback',async({page})=>{
 await fixture(page);let bridge:WebSocketRoute|undefined;
 await page.routeWebSocket(`ws://localhost:8787/follow?pair=${pair}`,ws=>{bridge=ws;ws.onMessage(()=>{});ws.send(JSON.stringify({type:'connected'}));});
 await page.goto(operator);await expect(page.getByRole('status',{name:'House connection'})).toHaveText('Connected to House Studio');
 await page.getByRole('button',{name:'Toggle game speech'}).click();
 // This harness tab was not opened by Studio, so Chrome retains it; playback
 // must still unmount rather than keep speaking alongside the replacement.
 bridge!.close({code:1000,reason:'Following another player.'});
 await expect(page.getByRole('button',{name:'Toggle game speech'})).toHaveCount(0);
 await expect(page.getByRole('status',{name:'House connection'})).toHaveText('Following another player.');
});

test('development effect replay opens only one paired connection',async({page})=>{
 await fixture(page,`window.followAttempts=0;window.WebSocket=new Proxy(window.WebSocket,{construct(Target,args){if(String(args[0]).includes('/follow?'))window.followAttempts++;return new Target(...args);}});`);
 await page.routeWebSocket(`ws://localhost:8787/follow?pair=${pair}`,ws=>{ws.onMessage(()=>{});ws.send(JSON.stringify({type:'connected'}));});
 await page.goto(operator);
 await expect(page.getByRole('status',{name:'House connection'})).toHaveText('Connected to House Studio');
 expect(await page.evaluate(()=>(window as unknown as {followAttempts:number}).followAttempts)).toBe(1);
});
