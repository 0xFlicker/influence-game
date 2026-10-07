import {afterEach, expect, test} from "bun:test";
import {WatchMusic, type MusicDeck, type MusicOutput, type MusicSection, type MusicStatus} from "../components/watch/watch-music";
class Deck implements MusicDeck {
  time = 0; duration = 160; ready = true; ended = false; failed = false;
  level = 0; playing = false; src = ""; loads = 0; starts = 0;
  nextPlay: (() => Promise<void>) | null = null;
  load(src: string) {this.src = src; this.time = 0; this.loads++; this.ended = false;}
  play() {this.starts++; this.playing = true; return this.nextPlay?.() ?? Promise.resolve();}
  pause() {this.playing = false;}
  gain(value: number) {this.level = value;}
  dispose() {this.pause();}
}
class Output implements MusicOutput {
  decks: [Deck, Deck] = [new Deck(), new Deck()]; time = 0; level = 0; closed = false;
  resume() {return Promise.resolve();}
  master(value: number) {this.level = value;}
  dispose() {this.closed = true; this.decks.forEach(d => d.dispose());}
}
const intro: MusicSection = {key:"game:mystery:intro", src:"/intro.mp3", title:"Intro", repeat:true};
const day: MusicSection = {key:"game:mystery:day:1", src:"/day.mp3", title:"Day", repeat:true};
const instances: WatchMusic[] = [];
function setup() {
  const output = new Output(), statuses: MusicStatus[] = [];
  const music = new WatchMusic(() => output, s => statuses.push(s), false); instances.push(music);
  const input = {section: intro, playing:true, muted:false, volume:0.3};
  return {output, music, input, statuses};
}
const settled = async () => {await Promise.resolve(); await Promise.resolve(); await Promise.resolve();};
afterEach(() => {instances.splice(0).forEach(m => m.dispose());});
test("mute on first visit allocates no media; a gesture unlock creates just two decks", async () => {
  let creations = 0; const output = new Output(); const music = new WatchMusic(() => {creations++; return output;}, () => {}, false); instances.push(music);
  const input = {section:intro, playing:true, muted:true, volume:0.3};
  music.update(input); expect(creations).toBe(0);
  music.unlock(); await settled(); music.update({...input, muted:false});
  expect(creations).toBe(1); expect(output.level).toBe(0.3);
});
test("speaker updates, mute and same-section seek preserve music position; pause wins", async () => {
  const {music, output, input} = setup(); music.update(input); await settled(); output.time = 1; music.tick();
  const deck = output.decks.find(d => d.playing)!; deck.time = 37;
  music.update({...input, section:{...intro}}); music.update({...input, muted:true});
  expect(deck.time).toBe(37); expect(deck.loads).toBe(1); expect(output.level).toBe(0);
  music.suspend(); expect(deck.playing).toBe(false);
  music.update(input); await settled(); expect(deck.time).toBe(37); expect(deck.playing).toBe(true);
  music.update({...input, playing:false}); expect(deck.playing).toBe(false); expect(output.level).toBe(0);
});
test("section crossfade is bounded, freezes on pause, resumes without replaying the intro", async () => {
  const {music, output, input} = setup(); music.update(input); await settled(); output.time = 1; music.tick();
  const old = output.decks.find(d => d.playing)!; old.time = 25;
  music.update({...input, section:day}); await settled(); output.time += 0.35; music.tick();
  expect(output.decks.reduce((sum,d)=>sum+d.level,0)).toBeCloseTo(1);
  const levels = output.decks.map(d=>d.level); music.update({...input, section:day, playing:false});
  output.time += 20; music.tick(); expect(output.decks.map(d=>d.level)).toEqual(levels);
  music.update({...input, section:day}); await settled(); output.time += 0.36; music.tick();
  expect(old.playing).toBe(false); expect(old.level).toBe(0);
  expect(output.decks.filter(d=>d.playing)).toHaveLength(1);
});
test("rapid A to B to A retires oldest deck and restarts destination from zero", async () => {
  const {music, output, input} = setup(); music.update(input); await settled(); output.time = 1; music.tick();
  music.update({...input, section:day}); music.update(input); await settled(); output.time += 1; music.tick();
  const audible = output.decks.filter(d=>d.playing && d.level > 0);
  expect(audible).toHaveLength(1); expect(audible[0]!.src).toBe(intro.src); expect(audible[0]!.time).toBe(0);
});
test("background tracks loop from front; terminal tracks do not", async () => {
  const {music, output, input} = setup(); music.update(input); await settled(); output.time = 1; music.tick();
  const old = output.decks.find(d=>d.playing)!; old.time = 159.5;
  music.tick(); await settled(); output.time += 0.8; music.tick();
  expect(old.playing).toBe(false); expect(output.decks.find(d=>d.playing)?.time).toBe(0);
  music.update({...input, section:{...day, repeat:false}}); await settled(); output.time += 1; music.tick();
  const ending = output.decks.find(d=>d.playing)!; const loads = output.decks.map(d=>d.loads);
  ending.time = ending.duration; ending.ended = true; music.tick();
  expect(output.decks.map(d=>d.loads)).toEqual(loads); expect(ending.playing).toBe(false);
});
test("late play resolution after pause or disposal cannot leave audio playing", async () => {
  const {music, output, input} = setup(); let release!: () => void;
  output.decks[1].nextPlay = () => new Promise<void>(resolve=>{release=resolve;});
  music.update(input); music.suspend(); release(); await settled();
  expect(output.decks.some(d=>d.playing)).toBe(false);
  music.dispose(); expect(output.closed).toBe(true); expect(output.level).toBe(0);
});
test("autoplay rejection is visible without retries on every update; explicit unlock retries", async () => {
  const {music, output, input, statuses} = setup();
  output.decks[1].nextPlay = () => Promise.reject(new DOMException("gesture", "NotAllowedError"));
  music.update(input); await settled(); expect(statuses.at(-1)).toBe("blocked");
  const starts = output.decks[1].starts; music.update(input); expect(output.decks[1].starts).toBe(starts);
  music.update({...input, section:day}); expect(output.decks[0].starts).toBe(0);
  output.decks[1].nextPlay = null; music.unlock(); await settled(); expect(statuses.at(-1)).toBe("playing");
});
test("network errors stop the affected bed and explicit retry reloads it", async () => {
  const {music, output, input, statuses} = setup(); music.update(input); await settled(); output.time = 1; music.tick();
  output.decks.find(d=>d.playing)!.failed = true; music.tick(); expect(statuses.at(-1)).toBe("unavailable");
  expect(output.decks.some(d=>d.playing)).toBe(false);
  output.decks.forEach(d=>{d.failed=false;}); music.unlock(); await settled(); expect(statuses.at(-1)).toBe("playing");
});
test("explicit restart resets same section; zero volume does not pause; live-tail gain fades", async () => {
  const {music, output, input} = setup(); music.update(input); await settled(); output.time = 1; music.tick();
  output.decks.find(d=>d.playing)!.time=54; music.restart(); music.update({...input, volume:0}); await settled();
  expect(output.decks.find(d=>d.playing)!.time).toBe(0); expect(output.level).toBe(0);
  music.update({...input, fadeGain:0.5}); expect(output.level).toBe(0.15);
});
test("new audible preview suspends the old one until an explicit gesture", async () => {
  const first=setup(), second=setup(); first.music.update(first.input); await settled(); second.music.update(second.input); await settled();
  first.music.update({...first.input}); await settled(); expect(first.output.decks.some(d=>d.playing)).toBe(false);
  first.music.unlock(); await settled(); expect(second.output.decks.some(d=>d.playing)).toBe(false);
});
