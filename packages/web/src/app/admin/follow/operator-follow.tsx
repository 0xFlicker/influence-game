"use client";
import {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import type {GameFollowKnowledge} from '@influence/engine/game-follow';
import {apiFetch} from '@/lib/api';
import {usePermissions} from '@/hooks/use-permissions';
import {GamePlaybackContext,type PlaybackUpdate,type GameSpeaker} from '@/components/watch/game-playback';
import {sampleWatch} from '@/components/watch/watch-sampling';

export function OperatorFollow({children}:{children:ReactNode}) {
  const {loading,roles}=usePermissions();
  return <OperatorFollowAccess loading={loading} roles={roles}>{children}</OperatorFollowAccess>;
}
/** Shares the exact access boundary with the browser harness. API reads also authorize server-side. */
export function OperatorFollowAccess({loading,roles,children}:{loading:boolean;roles:readonly string[];children:ReactNode}) {
  if(loading)return <p role="status">Checking operator access…</p>;
  if(!roles.some(role=>role==='producer'||role==='sysop'))return <p role="alert">Producer or Sysop access is required for this player.</p>;
  return <PairedPlayer>{children}</PairedPlayer>;
}
function PairedPlayer({children}:{children:ReactNode}) {
  const socket=useRef<WebSocket|null>(null);
  const speechState=useRef<{speaking:boolean;speaker:GameSpeaker}>({speaking:false,speaker:null});
  const [playback,setPlayback]=useState<PlaybackUpdate|null>(null);
  const [connected,setConnected]=useState(false),[houseSpeaking,setHouseSpeaking]=useState(false),[status,setStatus]=useState('Open this player using Follow game in House Studio.');
  const [replaced,setReplaced]=useState(false);
  const [pauseForHouse,setPauseForHouse]=useState(false);
  const boundary=useRef<PlaybackUpdate['timing']>(undefined);
  const pendingHold=useRef<string|null>(null);
  const [heldRequest,setHeldRequest]=useState<string|null>(null);
  const update=useCallback((value:PlaybackUpdate)=>{boundary.current=value.timing;setPlayback(value);},[]);
  const holdAtSilence=useCallback(()=>{
    if(!pendingHold.current||speechState.current.speaking)return;
    // Freeze synchronously at the media boundary, before another cue can start.
    boundary.current?.director.setCommentaryHeld(true);
    setHeldRequest(pendingHold.current);
  },[]);
  useLayoutEffect(()=>{
    // Children have applied the voice suspension before this acknowledgment.
    if(heldRequest&&socket.current?.readyState===WebSocket.OPEN)
      socket.current.send(JSON.stringify({type:'commentary-ready',id:heldRequest}));
  },[heldRequest]);
  useEffect(()=>{
    const args=new URLSearchParams(window.location.hash.slice(1)),port=args.get('housePort'),pair=args.get('pair');
    if(!port||!/^\d+$/.test(port)||Number(port)<1024||Number(port)>65534||!pair||!/^[a-f0-9]{64}$/.test(pair)){
      return;
    }
    let cancelled=false,connection:WebSocket|null=null;
    // React development replay cleans up the first effect synchronously. Do not
    // consume a one-use pairing for that discarded mount.
    queueMicrotask(()=>{
      if(cancelled)return;
      const ws=new WebSocket(`ws://localhost:${port}/follow?pair=${pair}`);socket.current=ws;connection=ws;
      ws.onopen=()=>{if(socket.current===ws)setStatus('Connecting to House Studio…');};
      ws.onmessage=event=>{
        if(socket.current!==ws)return;
        const message=JSON.parse(event.data);
        if(message.type==='connected'){setConnected(true);setStatus('Connected to House Studio');ws.send(JSON.stringify({type:'speech',...speechState.current}));}
        else if(message.type==='host-speech'&&typeof message.speaking==='boolean'){
          setHouseSpeaking(message.speaking);setPauseForHouse(message.pauseForHouse===true);
        }
        else if(message.type==='commentary-hold'&&typeof message.id==='string'&&typeof message.held==='boolean'){
          if(message.held){pendingHold.current=message.id;holdAtSilence();}
          else if(pendingHold.current===message.id){pendingHold.current=null;setHeldRequest(null);boundary.current?.director.setCommentaryHeld(false);}
        }
      };
      ws.onerror=()=>{if(socket.current===ws)setStatus('House Studio is unavailable. Start following again there.');};
      ws.onclose=event=>{
        if(socket.current!==ws)return;
        setConnected(false);setHouseSpeaking(false);setStatus(event.reason||'Following ended in House Studio.');
        pendingHold.current=null;setHeldRequest(null);boundary.current?.director.setCommentaryHeld(false);
        if(event.reason==='Following another player.'){
          // The paired tab closes itself; Studio keeps no cross-origin opener.
          // Unmount playback even when the browser retains the tab in its history.
          setReplaced(true);window.close();
        }
      };
    });
    return()=>{cancelled=true;socket.current=null;connection?.close(1000,'Operator player closed');};
  },[holdAtSilence]);
  const speech=useCallback((speaking:boolean,speaker:GameSpeaker)=>{
    speechState.current={speaking,speaker};
    if(!speaking)holdAtSilence();
    if(socket.current?.readyState===WebSocket.OPEN)socket.current.send(JSON.stringify({type:'speech',speaking,speaker}));
  },[holdAtSilence]);
  const value=useMemo(()=>({update,speech,houseSpeaking,pauseForHouse,commentaryHeld:heldRequest!==null}),[update,speech,houseSpeaking,pauseForHouse,heldRequest]);
  useEffect(()=>{
    if(!connected||!playback?.game.id||!playback.position)return;
    const controller=new AbortController(),ws=socket.current;
    let requested=false;
    const read=()=>{
      if(requested||playback.timing&&playback.timing.director.getElapsedBaseMs()<playback.timing.revealAtMs)return;
      requested=true;
      void apiFetch<GameFollowKnowledge>(`/api/admin/production/games/${encodeURIComponent(playback.game.id)}/follow-context`,{method:'POST',body:JSON.stringify(playback.position),signal:controller.signal}).then(knowledge=>{
        if(!controller.signal.aborted&&ws===socket.current&&ws?.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:'context',knowledge}));setStatus('House is following this player');}
      }).catch(error=>{if(!controller.signal.aborted)setStatus(`Game context unavailable: ${error instanceof Error?error.message:String(error)}`);});
    };
    const unsubscribe=playback.timing?sampleWatch(playback.timing.director,read):undefined;
    read();return()=>{controller.abort();unsubscribe?.();};
  },[connected,playback]);
  return <GamePlaybackContext value={value}><p role="status" aria-label="House connection" className="px-4 text-sm text-white/60">{status}</p>{!replaced&&children}</GamePlaybackContext>;
}
