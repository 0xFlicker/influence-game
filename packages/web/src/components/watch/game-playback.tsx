"use client";
import {createContext,useCallback,useContext,useEffect} from 'react';
import type {GameFollowPosition} from '@influence/engine/game-follow';
import type {WatchSampler} from './watch-sampling';

export type GameSpeaker={id:string|null;name:string}|null;
export type PlaybackUpdate={game:{id:string;slug:string;kind:'influence'|'werewolf'};position:GameFollowPosition|null;timing?:{director:WatchSampler&{getElapsedBaseMs():number};revealAtMs:number}};
export const GamePlaybackContext=createContext<{
  update(value:PlaybackUpdate):void;
  speech(speaking:boolean,speaker:GameSpeaker):void;
  houseSpeaking:boolean;
}|null>(null);

/** Public players have no subscriber: no network connection or follow controls. */
export function useGamePlayback(game:PlaybackUpdate['game'],position:GameFollowPosition|null|(()=>GameFollowPosition|null),names:readonly {id:string;name:string}[],timing?:PlaybackUpdate['timing']) {
  const observer=useContext(GamePlaybackContext);
  const update=observer?.update, speech=observer?.speech;
  const positionKey=observer?JSON.stringify(typeof position==='function'?position():position):'null',director=timing?.director,revealAtMs=timing?.revealAtMs;
  useEffect(()=>{
    update?.({game:{id:game.id,slug:game.slug,kind:game.kind},position:JSON.parse(positionKey),timing:director?{director,revealAtMs:revealAtMs??0}:undefined});
  },[update,game.id,game.slug,game.kind,positionKey,director,revealAtMs]);
  const onSpeech=useCallback((speaking:boolean,id:string|null)=>speech?.(speaking,speaking?{id,name:names.find(player=>player.id===id)?.name??(id?'Game player':'Game voice')}:null),[speech,names]);
  return {onSpeech,houseSpeaking:observer?.houseSpeaking??false};
}
