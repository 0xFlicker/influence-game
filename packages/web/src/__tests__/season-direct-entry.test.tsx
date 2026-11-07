import {afterEach,beforeEach,expect,test} from 'bun:test';
import {act,cleanup,fireEvent,render,waitFor} from '@testing-library/react';
import {Window} from 'happy-dom';
import {SeasonsContent} from '../app/seasons/seasons-content';
import {InfluenceAuthContext,type InfluenceAuthState} from '../hooks/use-auth';
const keys=['window','document','navigator','HTMLElement','Element','Node','Event','localStorage'] as const;
const saved=new Map(keys.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const fetchBefore=globalThis.fetch;
let dom:Window;let posts:unknown[];let owned:Array<Omit<(typeof agents)[number], 'fullBodyReferenceUrl'> & {fullBodyReferenceUrl:string|null}>;let joined:string|null;let rejectJoin:boolean;
const season={id:'s1',slug:'season-one',name:'Season 1',status:'active',ratedPool:'free',admissionStartsAt:null,admissionClosesAt:null,finalizedAt:null};
const agents=['First','Second'].map((name,i)=>({id:name,name,createdAt:`2026-01-0${i+1}`,avatarUrl:`/${name}.png`,transparentBodyUrl:`/${name}-body.png`,fullBodyReferenceUrl:`/${name}-body.png`,personality:'',visualDesign:'Coat',performanceInstructions:'Calm',gamesPlayed:0,gamesWon:0}));
beforeEach(()=>{dom=new Window({url:'http://localhost/seasons'});for(const key of keys)Object.defineProperty(globalThis,key,{configurable:true,value:key==='window'?dom:dom[key]});posts=[];owned=agents;joined=null;rejectJoin=false;
 globalThis.fetch=Object.assign(async(input:string|URL|Request,init?:RequestInit)=>{const path=new URL(String(input),"http://localhost").pathname;
 if(path==='/api/seasons')return Response.json({seasons:[season]});
 if(path==='/api/seasons/season-one')return Response.json({schemaVersion:2,season,agentStandings:[],architectStandings:[],honors:null,championships:[]});
 if(path==='/api/seasons/season-one/games')return Response.json({games:[]});
 if(path==='/api/agent-profiles')return Response.json(owned);
 if(path.includes('/visual-update'))return Response.json({needsUpdate:false,job:null});
 if(path==='/api/free-queue')return Response.json({acceptingSeasonId:'s1',userEntry:joined?{agentProfileId:joined,agentName:joined}:null});
 if(path==='/api/free-queue/join'){const body=JSON.parse(String(init?.body));posts.push(body);if(rejectJoin)return Response.json({error:'Season is closed'},{status:409});joined=body.agentProfileId;return Response.json({ok:true});}
 throw new Error(`Unexpected request ${path}`);
 },{preconnect:fetchBefore.preconnect});});
afterEach(async()=>{await act(async()=>{cleanup();await new Promise(resolve=>setTimeout(resolve,0));});globalThis.fetch=fetchBefore;for(const key of keys){const value=saved.get(key);if(value)Object.defineProperty(globalThis,key,value);else Reflect.deleteProperty(globalThis,key);}dom.close();});
function mount(){return render(<InfluenceAuthContext.Provider value={{ready:true,authenticated:true,account:{id:'owner'}} as InfluenceAuthState}><SeasonsContent/></InfluenceAuthContext.Provider>);}
test('selected agent joins with one visible action and season intent, then offers change without disclosure',async()=>{const view=mount();await waitFor(()=>expect(view.getByRole('button',{name:'Join Season 1'})).toBeTruthy());expect(view.getByRole('img',{name:'Second'}).getAttribute('src')).toContain('Second-body');await act(async()=>fireEvent.change(view.getByRole('combobox',{name:'Your season agent'}),{target:{value:'First'}}));expect(view.getByRole('img',{name:'First'})).toBeTruthy();expect(posts).toHaveLength(0);await act(async()=>{const button=view.getByRole('button',{name:'Join Season 1'});fireEvent.click(button);fireEvent.click(button);});expect(posts).toEqual([{agentProfileId:'First',expectedSeasonId:'s1'}]);expect(view.getByText('✓ Entered')).toBeTruthy();expect(view.getByRole('combobox',{name:'Your season agent'})).toBeTruthy();expect(view.queryByRole('button',{name:'Join Season 1'})).toBeNull();await act(async()=>fireEvent.change(view.getByRole('combobox',{name:'Your season agent'}),{target:{value:'Second'}}));expect(view.getByRole('button',{name:'Switch agent'})).toBeTruthy();expect(view.getByText('Currently entered: First')).toBeTruthy();expect(posts).toHaveLength(1);});
test('no-agent entry offers the season-scoped create flow and never auto-joins on arrival',async()=>{owned=[];const view=mount();await waitFor(()=>expect(view.getByRole('link',{name:'Create agent'})).toBeTruthy());expect(view.getByRole('img',{name:'Choose your first agent'})).toBeTruthy();expect(view.getByRole('link',{name:'Create agent'}).getAttribute('href')).toBe('/agents/create?flow=daily_free&seasonId=s1&season=season-one');expect(posts).toHaveLength(0);});
test('closed-season rejection stays visible and does not claim entry',async()=>{rejectJoin=true;const view=mount();await waitFor(()=>expect(view.getByRole('button',{name:'Join Season 1'})).toBeTruthy());await act(async()=>fireEvent.click(view.getByRole('button',{name:'Join Season 1'})));expect(view.getByRole('alert').textContent).toContain('Season is closed');expect(view.queryByText('✓ Entered')).toBeNull();expect(posts).toHaveLength(1);});
test('an Agent without full-body art goes to completion before entering Daily Free',async()=>{owned=agents.map(agent=>agent.id==='Second'?{...agent,fullBodyReferenceUrl:null}:agent);const view=mount();const link=await waitFor(()=>view.getByRole('link',{name:'Complete Agent & join'}));expect(link.getAttribute('href')).toBe('/agents/prepare?flow=daily_free&seasonId=s1&season=season-one&agentId=Second');expect(posts).toHaveLength(0);});
