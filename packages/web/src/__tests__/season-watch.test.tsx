import { afterEach, beforeEach, expect, test } from 'bun:test';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { Window } from 'happy-dom';
import { SeasonWatch } from '../app/seasons/season-watch';
import type { SeasonGame } from '../app/seasons/season-games';
const previous={window:globalThis.window,document:globalThis.document,navigator:globalThis.navigator};
const originalFetch=globalThis.fetch;
let dom:Window;let requests=0;
beforeEach(()=>{dom=new Window({url:'http://localhost:3001/seasons'});Object.defineProperty(globalThis,'window',{configurable:true,value:dom});Object.defineProperty(globalThis,'document',{configurable:true,value:dom.document});Object.defineProperty(globalThis,'navigator',{configurable:true,value:dom.navigator});requests=0;globalThis.fetch=Object.assign(async()=>{requests++;throw new Error('Unexpected player request before playback');},{preconnect:originalFetch.preconnect});});
afterEach(()=>{cleanup();globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(previous))Object.defineProperty(globalThis,key,{configurable:true,value});dom.close();});
const live:SeasonGame={id:'live',slug:'real-live-game',gameKind:'influence',status:'in_progress',createdAt:'2026-01-01',startedAt:null,endedAt:null};
test('initial render and feed refresh do not mount or request a player',()=>{
 const view=render(<SeasonWatch games={[live]} seasonName="Season 1" seasonSlug="s1" loading={false} error={null}/>);
 expect(view.getByTestId('season-player').getAttribute('data-playing')).toBe('false');
 expect(view.getByRole('link',{name:'All Season 1 games'}).getAttribute('href')).toBe('/games/season/s1');
 expect(view.queryByRole('button',{name:'Close player'})).toBeNull();
 expect(view.getByTestId('season-player-caption').getAttribute('aria-hidden')).toBe('true');
 expect(view.getByTestId('season-player-caption').textContent).toContain('Close player');
 view.rerender(<SeasonWatch games={[{...live,status:'completed'}]} seasonName="Season 1" seasonSlug="s1" loading={false} error={null}/>);
 expect(view.getByRole('button',{name:'Watch replay'})).toBeTruthy();expect(requests).toBe(0);
});
test('waiting, empty and unavailable feeds never claim playback exists',()=>{
 const props={seasonName:'Season 1',seasonSlug:'s1',loading:false,error:null};
 const view=render(<SeasonWatch {...props} games={[{...live,status:'waiting'}]}/>);
 expect(view.getByRole('link',{name:'View game →'})).toBeTruthy();expect(view.queryByRole('button',{name:/Watch live/})).toBeNull();
 view.rerender(<SeasonWatch {...props} games={[]}/>);expect(view.getByText('No games to watch.')).toBeTruthy();
 view.rerender(<SeasonWatch {...props} games={[]} error="Unavailable"/>);expect(view.getByRole('alert').textContent).toBe('Unavailable');expect(requests).toBe(0);
});
