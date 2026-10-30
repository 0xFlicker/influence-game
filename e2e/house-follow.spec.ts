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

for(const thinking of [false,true])test(`Buffered commentary waits for ${thinking?'thinking':'speech'} to finish, holds the clock and preserves music`,async({page})=>{
 const dir=mkdtempSync(join(tmpdir(),'house-commentary-'));let script:string;
 try{execFileSync('bun',['build','packages/web/src/__tests__/fixtures/house-commentary-browser.tsx','--define','process.env={}','--outfile',join(dir,'fixture.js')]);script=readFileSync(join(dir,'fixture.js'),'utf8');}finally{rmSync(dir,{recursive:true,force:true});}
 const wav=Buffer.alloc(44+24000*2*8);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);for(let i=0;i<24000*8;i++)wav.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*220/24000)*2000),44+i*2);
 const musicWav=Buffer.concat([wav,wav.subarray(44),wav.subarray(44),wav.subarray(44)]);musicWav.writeUInt32LE(musicWav.length-8,4);musicWav.writeUInt32LE(musicWav.length-44,40);
 const position={kind:'werewolf',audience:'omniscient',cursor:1,part:{kind:'speech'}};
 const coordinate={kind:'werewolf',cursor:1,actorId:'bea',part:'speech'};
 await page.addInitScript(({thinking,position,coordinate})=>{
  Object.assign(window,{replayData:{game:{id:'fixture',slug:'fixture',kind:'werewolf'},thinking,names:[{id:'bea',name:'Bea'}],cues:[{key:'one',baseDurationMs:4000,position,coordinate,name:'Bea',text:'A game contribution.',thinking:'A private thought.'}]},testMedia:[]});
  const Original=window.Audio;window.Audio=new Proxy(Original,{construct(Target,args){const audio=new Target(...args);(window as unknown as {testMedia:HTMLAudioElement[]}).testMedia.push(audio);return audio;}});
 },{thinking,position,coordinate});
 await page.route('http://localhost:3001/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path==='/fixture.js')return route.fulfill({contentType:'text/javascript',body:script});
  if(path.endsWith('.wav'))return route.fulfill({contentType:'audio/wav',body:path==='/background.wav'?musicWav:wav});
  if(path.endsWith('/audio'))return route.fulfill({json:{id:'track',clips:['speech','thinking'].map(part=>({momentId:'m',watch:{...coordinate,part},speakerId:'bea',textHash:'h',versionId:part,sha256:'h',durationMs:8000,url:`/${part}.wav`}))}});
  if(path.endsWith('/follow-context'))return route.fulfill({json:{schemaVersion:1,game:{id:'fixture',slug:'fixture',kind:'werewolf'},position,visibility:'omniscient',rules:{},roster:[],state:{},current:{},history:[],thinking:[]}});
  return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script type="module" src="/fixture.js"></script>'});
 });
 let bridge:WebSocketRoute|undefined;const acknowledgments:string[]=[];
 await page.routeWebSocket(`ws://localhost:8787/follow?pair=${pair}`,ws=>{bridge=ws;ws.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.type==='commentary-ready')acknowledgments.push(m.id);});ws.send(JSON.stringify({type:'connected'}));ws.send(JSON.stringify({type:'host-speech',speaking:false,pauseForHouse:true}));});
 await page.goto(operator);
 await expect(page.locator('[data-player-theater="true"]')).toBeVisible();
 expect(await page.evaluate(()=>document.fullscreenElement===null)).toBe(true);
 await expect.poll(()=>page.evaluate(()=>(window as unknown as {replayState:{playing:boolean}}).replayState?.playing)).toBe(false);
 await page.getByRole('button',{name:'Play',exact:true}).click();
 const voice=()=>page.evaluate(part=>{const a=(window as unknown as {testMedia:HTMLAudioElement[]}).testMedia.find(a=>a.src.endsWith('/'+part+'.wav'));return a?{paused:a.paused,time:a.currentTime}:null;},thinking?'thinking':'speech');
 await expect.poll(async()=>(await voice())?.paused).toBe(false);await expect(page.getByLabel('Music state')).toHaveText('playing');
 const holdId='1f85a2b4-3b8a-4934-bba1-6b83800acf72';
 bridge!.send(JSON.stringify({type:'commentary-hold',id:holdId,held:true}));
 await page.waitForTimeout(300);expect((await voice())?.paused).toBe(false);expect(acknowledgments).toEqual([]);
 await expect.poll(()=>acknowledgments,{timeout:15000}).toEqual([holdId]);
 expect((await voice())!.time).toBeGreaterThan(7.7);
 bridge!.send(JSON.stringify({type:'host-speech',speaking:true,pauseForHouse:true}));
 await expect.poll(async()=>(await voice())?.paused).toBe(true);await expect(page.getByLabel('Music gain')).toHaveText('0.14');
 const before=await voice();const state=await page.evaluate(()=>(window as unknown as {replayState:{elapsed:number;playing:boolean}}).replayState);
 await page.waitForTimeout(800);expect((await voice())?.time).toBeCloseTo(before!.time,2);
 expect(await page.evaluate(()=>(window as unknown as {replayState:{elapsed:number}}).replayState.elapsed)).toBeCloseTo(state.elapsed,1);expect(state.playing).toBe(true);
 await expect(page.getByLabel('Music state')).toHaveText('playing');
 const musicTimes=await page.evaluate(()=>(window as unknown as {testMedia:HTMLAudioElement[]}).testMedia.filter(a=>a.src.endsWith('/background.wav')).map(a=>a.currentTime));
 await page.waitForTimeout(300);expect(await page.evaluate(()=>Math.max(...(window as unknown as {testMedia:HTMLAudioElement[]}).testMedia.filter(a=>a.src.endsWith('/background.wav')).map(a=>a.currentTime)))).toBeGreaterThan(Math.max(...musicTimes)+.15);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 bridge!.send(JSON.stringify({type:'host-speech',speaking:false,pauseForHouse:true}));
 bridge!.send(JSON.stringify({type:'commentary-hold',id:holdId,held:false}));
 await page.waitForTimeout(200);expect((await voice())?.paused).toBe(true);
});
