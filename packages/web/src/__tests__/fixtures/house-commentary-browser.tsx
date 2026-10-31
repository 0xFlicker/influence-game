import React,{useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OperatorFollowAccess} from '../../app/admin/follow/operator-follow';
import {useGamePlayback,useIsFollowPlayer} from '../../components/watch/game-playback';
import {usePlayerFullscreen} from '../../components/watch/use-player-fullscreen';
import {PresentationDirector,type WatchCue} from '../../components/watch/watch-director';
import {useWatchVoice} from '../../components/watch/use-watch-voice';
import {useWatchMusic} from '../../components/watch/use-watch-music';
import {speechMusicVolume} from '../../components/watch/watch-music';
import {setApiBase} from '../../lib/api';
import type {GameFollowPosition} from '@influence/engine/game-follow';
import type {AudioWatchCoordinate} from '@influence/engine/audio-watch';
import {werewolfCommentaryReady,werewolfPlaybackConcluded} from '../../components/games/werewolf/werewolf-follow-position';
import {werewolfPlaybackPolicy,type WerewolfPlaybackCue} from '../../components/games/werewolf/werewolf-opening';
interface Cue extends WatchCue {position:GameFollowPosition;coordinate:AudioWatchCoordinate;name:string;text:string;thinking:string|null;canonical?:WerewolfPlaybackCue}
declare global {interface Window {replayData:{game:{id:string;slug:string;kind:'werewolf'};cues:Cue[];names:{id:string;name:string}[];thinking:boolean};replayState:unknown;holdCommentaryBoundary?:(held:boolean)=>void;isSpeechComplete?:()=>boolean;setBufferedHouseSpeaking?:(speaking:boolean)=>void}}
setApiBase('http://localhost:3001');
function Replay(){
 const data=window.replayData;
 const frame=useRef<HTMLElement>(null),fullscreen=usePlayerFullscreen(frame,useIsFollowPlayer());
 const [director]=useState(()=>{
  const d=new PresentationDirector<Cue>({policy:{position:c=>c.position.kind==='werewolf'?c.position.cursor:0,speech:c=>c?.canonical?werewolfPlaybackPolicy.speech(c.canonical):({showAtMs:0,readAtMs:0,hideAtMs:3800,hiddenAtMs:4000}),isCatchUp:()=>false,acceptAtWatermark:()=>true,reconcile:c=>c}});
  d.load(data.cues);d.setThinkingEnabled(data.thinking);for(const c of data.cues)d.setThinking(c.key,c.thinking);return d;
 });
 const [snapshot,setSnapshot]=useState(()=>director.getSnapshot());
 useEffect(()=>{const off=director.subscribe(()=>setSnapshot(director.getSnapshot()));return()=>{off();director.dispose();};},[director]);
 const cue=director.getActiveCue();
 const commentaryReady=useCallback(()=>!director.getActiveCue()?.canonical||werewolfCommentaryReady({getActiveCue:()=>director.getActiveCue()?.canonical??null,getSnapshot:()=>director.getSnapshot(),getElapsedBaseMs:()=>director.getElapsedBaseMs()}),[director]);
 const concluded=useCallback(()=>werewolfPlaybackConcluded(director.getActiveCue()?.canonical??null,'completed'),[director]);
 const follow=useGamePlayback(data.game,cue?.position??null,data.names,{director,revealAtMs:0,commentaryReady,concluded});
 const [boundaryHeld,setBoundaryHeld]=useState(false);
 const [bufferedHouseSpeaking,setBufferedHouseSpeaking]=useState(false);
 useEffect(()=>{window.setBufferedHouseSpeaking=setBufferedHouseSpeaking;return()=>{delete window.setBufferedHouseSpeaking;};},[]);
 useLayoutEffect(()=>{window.isSpeechComplete=()=>director.getAudioPosition()===null&&director.getSnapshot().isPlaying;window.holdCommentaryBoundary=(held)=>{director.setCommentaryHeld(held||follow.houseHolding);setBoundaryHeld(held);};director.setCommentaryHeld(boundaryHeld||follow.houseHolding);return()=>{delete window.holdCommentaryBoundary;delete window.isSpeechComplete;};},[director,boundaryHeld,follow.houseHolding]);
 const voice=useWatchVoice({director,gameId:data.game.id,audience:'omniscient',thinking:data.thinking,coordinate:cue?.canonical&&'reprise' in cue.canonical&&cue.canonical.reprise?null:cue?.coordinate??null,coordinateForCue:c=>c.canonical&&'reprise' in c.canonical&&c.canonical.reprise?null:c.coordinate,onPause:()=>director.pause(),onSpeech:follow.onSpeech,suspended:follow.houseHolding||boundaryHeld});
 const volume=speechMusicVolume(.4,voice.speaking,follow.houseSpeaking||bufferedHouseSpeaking);
 const music=useWatchMusic({section:{key:'test',src:'/background.wav',title:'Replay background',repeat:true},playing:snapshot.isPlaying,muted:false,volume,preparing:false,holding:false,live:false,navigationRevision:director.getNavigationRevision()});
 useEffect(()=>{const sample=()=>{window.replayState={held:follow.houseHolding,boundaryHeld,bufferedHouseSpeaking,playing:director.getSnapshot().isPlaying,key:director.getActiveCue()?.key,elapsed:director.getTimelineElapsedBaseMs(),music:music.status,volume};};sample();const t=setInterval(sample,50);return()=>clearInterval(t);},[director,follow.houseHolding,boundaryHeld,bufferedHouseSpeaking,music.status,volume]);
 return <main ref={frame} data-player-theater={fullscreen.theater||undefined} style={fullscreen.expanded?{position:'fixed',inset:0,width:'100vw',height:'100dvh',margin:0}:undefined}><h1>House replay commentary experiment</h1><button onClick={()=>{voice.resume();music.unlock(false);director.play();}}>Play</button><button onClick={()=>director.pause()}>Pause</button><p role="status">{follow.houseHolding?'House speaking — game held':snapshot.isPlaying?'Playing':'Paused'}</p><h2>{cue?.name}</h2><p>{cue?.text}</p><output aria-label="Music state">{music.status}</output><output aria-label="Music gain">{volume.toFixed(2)}</output>{voice.error&&<p role="alert">{voice.error}</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<OperatorFollowAccess loading={false} roles={['producer']}><Replay/></OperatorFollowAccess>);
