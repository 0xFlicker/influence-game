"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import type {MusicStatus} from "./watch-music";

export interface OpeningAudioTrack {src: string; time: number; gain: number}
interface Input {tracks: readonly OpeningAudioTrack[]; playing: boolean; muted: boolean; volume: number; speed: number}
interface Deck {audio: HTMLAudioElement; src: string; pending: boolean; blocked: boolean; failed: boolean; generation: number}
/** Position-locked opening sound; the shared director remains the only advancement clock. */
export class OpeningAudio {
  private decks: Deck[] = [];
  private input: Input | null = null;
  private status: MusicStatus = "idle";
  constructor(private changed: (status: MusicStatus) => void, private create = () => new Audio()) {}
  private report(status: MusicStatus) {if (status !== this.status) {this.status = status; this.changed(status);}}
  suspend() {for (const deck of this.decks) {deck.generation++; deck.pending = false; deck.audio.pause();}}
  dispose() {this.suspend(); for (const deck of this.decks) {deck.audio.removeAttribute("src"); deck.audio.load();} this.decks = [];}
  unlock() {for (const deck of this.decks) {deck.blocked = false; if (deck.failed) {deck.failed = false; deck.audio.load();}} if (this.input) this.update(this.input);}
  update(input: Input) {
    this.input = input;
    if (!input.tracks.length) {this.dispose(); this.report("idle"); return;}
    if (input.muted || !input.playing) {this.suspend(); if (input.muted) this.report("idle"); return;}
    const tracks = input.tracks;
    for (const deck of this.decks.filter(d => !tracks.some(t => t.src === d.src))) {deck.generation++; deck.audio.pause(); deck.audio.removeAttribute("src"); deck.audio.load();}
    this.decks = this.decks.filter(d => tracks.some(t => t.src === d.src));
    for (const track of tracks) {
      let deck = this.decks.find(d => d.src === track.src);
      if (!deck) {
        const audio = this.create(); audio.preload = "auto"; audio.src = track.src;
        deck = {audio, src:track.src, pending:false, blocked:false, failed:false, generation:0};
        this.decks.push(deck);
      }
      const {audio} = deck;
      if (audio.error) deck.failed = true;
      audio.volume = Math.max(0, Math.min(1, input.volume * track.gain));
      audio.playbackRate = input.speed;
      // A seek into the opening must not briefly play from zero while metadata loads.
      if (audio.readyState < 1 && !deck.failed) continue;
      if (audio.readyState >= 1 && Math.abs(audio.currentTime - track.time) > 0.12) audio.currentTime = Math.min(track.time, Math.max(0,audio.duration - 0.01));
      if (track.gain <= 0 || deck.failed || deck.blocked) {audio.pause(); continue;}
      if (audio.paused && !deck.pending) {
        const current = deck; const generation = ++current.generation; current.pending = true;
        void audio.play().then(() => {if (generation === current.generation) current.pending = false;}, cause => {
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
export function useOpeningAudio(input: Input) {
  const controller = useRef<OpeningAudio | null>(null);
  const [status, setStatus] = useState<MusicStatus>("idle");
  const scrubbing = useRef(false);
  useEffect(() => {
    const audio = new OpeningAudio(setStatus); controller.current = audio;
    return () => {audio.dispose();controller.current = null;};
  }, []);
  useEffect(() => {controller.current?.update({...input, playing:input.playing && !scrubbing.current});}, [input]);
  return {status,
    unlock: useCallback(() => controller.current?.unlock(), []),
    suspend: useCallback(() => controller.current?.suspend(), []),
    restart: useCallback(() => controller.current?.dispose(), []),
    beginScrub: useCallback(() => {scrubbing.current = true;controller.current?.suspend();}, []),
    endScrub: useCallback(() => {scrubbing.current = false;}, []),
  };
}
