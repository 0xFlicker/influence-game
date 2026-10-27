"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import type {MusicStatus} from "./watch-music";
import {sampleWatch, type WatchSampler} from "./watch-sampling";
import {MediaAlignment} from "./media-alignment";

export interface OpeningAudioTrack {src: string; time: number; gain: number}
interface Input {tracks: readonly OpeningAudioTrack[]; playing: boolean; muted: boolean; volume: number; speed: number; navigationRevision: number}
interface Deck {audio: HTMLAudioElement; src: string; pending: boolean; blocked: boolean; failed: boolean; generation: number; alignment: MediaAlignment}
/** Position-locked opening sound; the shared director remains the only advancement clock. */
export class OpeningAudio {
  private decks: Deck[] = [];
  private input: Input | null = null;
  private status: MusicStatus = "idle";
  constructor(private changed: (status: MusicStatus) => void, private create = () => new Audio()) {}
  private report(status: MusicStatus) {if (status !== this.status) {this.status = status; this.changed(status);}}
  suspend() {for (const deck of this.decks) {deck.generation++; deck.pending = false; deck.alignment.invalidate(); deck.audio.pause();}}
  dispose() {this.suspend(); for (const deck of this.decks) {deck.audio.onloadedmetadata = null; deck.audio.oncanplay = null; deck.audio.onseeked = null; deck.audio.onwaiting = null; deck.audio.removeAttribute("src"); deck.audio.load();} this.decks = [];}
  unlock(muted = this.input?.muted ?? true) {for (const deck of this.decks) {deck.blocked = false; if (deck.failed) {deck.failed = false; deck.audio.load();}} if (this.input) this.update({...this.input, muted}, true);}
  update(input: Input, gesture = false) {
    this.input = input;
    if (!input.tracks.length) {this.dispose(); this.report("idle"); return;}
    if (input.muted || !input.playing && !gesture) {this.suspend(); if (input.muted) this.report("idle"); return;}
    const tracks = input.tracks;
    for (const deck of this.decks.filter(d => !tracks.some(t => t.src === d.src))) {deck.generation++; deck.audio.pause(); deck.audio.onloadedmetadata = null; deck.audio.oncanplay = null; deck.audio.onseeked = null; deck.audio.onwaiting = null; deck.audio.removeAttribute("src"); deck.audio.load();}
    this.decks = this.decks.filter(d => tracks.some(t => t.src === d.src));
    for (const track of tracks) {
      let deck = this.decks.find(d => d.src === track.src);
      if (!deck) {
        const audio = this.create(); audio.preload = "auto"; audio.src = track.src;
        deck = {audio, src:track.src, pending:false, blocked:false, failed:false, generation:0, alignment:new MediaAlignment()};
        this.decks.push(deck);
        audio.onloadedmetadata = () => {if (this.input && this.decks.includes(deck!)) this.update(this.input);};
        audio.oncanplay = audio.onloadedmetadata;
        audio.onseeked = audio.onloadedmetadata;
        audio.onwaiting = () => {if (!audio.seeking) deck!.alignment.waitForData();};
      }
      const {audio} = deck;
      if (audio.error) deck.failed = true;
      audio.volume = Math.max(0, Math.min(1, input.volume * track.gain));
      // A seek into the opening must not briefly play from zero while metadata loads.
      // Call play in the gesture even on a cold load. Silence until the seek is
      // applied so a distant seek never leaks the beginning of the track.
      audio.muted = audio.readyState < 1 || !input.playing;
      if (audio.readyState < 1 && !deck.failed && !gesture) continue;
      if (gesture) deck.alignment.invalidate();
      deck.alignment.sync(audio, {time:track.time, playing:input.playing, speed:input.speed, revision:input.navigationRevision});
      if (track.gain <= 0 && !gesture || deck.failed || deck.blocked) {audio.pause(); continue;}
      if (audio.paused && !deck.pending) {
        const current = deck; const generation = ++current.generation; current.pending = true;
        void audio.play().then(() => {if (generation === current.generation) {current.pending = false;if (!this.input?.playing) audio.pause();}}, cause => {
          if (generation !== current.generation) return;
          current.pending = false;
          if (cause instanceof DOMException && cause.name === "NotAllowedError") current.blocked = true;
          else if (!(cause instanceof DOMException && cause.name === "AbortError")) current.failed = true;
        });
      }
    }
    this.report(this.decks.some(d => d.blocked) ? "blocked" : this.decks.some(d => d.failed) ? "unavailable" : this.decks.some(d => d.pending || d.audio.readyState < 2) ? "loading" : "playing");
  }
}
export function useOpeningAudio(input: Omit<Input, "tracks" | "navigationRevision"> & {tracks: readonly OpeningAudioTrack[] | (() => readonly OpeningAudioTrack[])}, director: WatchSampler & {getNavigationRevision(): number}) {
  const controller = useRef<OpeningAudio | null>(null);
  const [status, setStatus] = useState<MusicStatus>("idle");
  const scrubbing = useRef(false);
  useEffect(() => {
    const audio = new OpeningAudio(setStatus); controller.current = audio;
    return () => {audio.dispose();controller.current = null;};
  }, []);
  useEffect(() => {
    const tracks = () => typeof input.tracks === "function" ? input.tracks() : input.tracks;
    const update = () => controller.current?.update({...input, navigationRevision:director.getNavigationRevision(), tracks:tracks(), playing:input.playing && !scrubbing.current});
    update();
    return input.playing && !input.muted && tracks().length ? sampleWatch(director, update) : undefined;
  }, [input, director]);
  return {status,
    unlock: useCallback((muted?: boolean) => controller.current?.unlock(muted), []),
    suspend: useCallback(() => controller.current?.suspend(), []),
    restart: useCallback(() => controller.current?.dispose(), []),
    beginScrub: useCallback(() => {scrubbing.current = true;controller.current?.suspend();}, []),
    endScrub: useCallback(() => {scrubbing.current = false;}, []),
  };
}
