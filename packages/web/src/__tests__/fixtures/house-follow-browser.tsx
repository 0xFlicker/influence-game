import React,{StrictMode,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {useGamePlayback} from '../../components/watch/game-playback';
import {OperatorFollowAccess} from '../../app/admin/follow/operator-follow';
import {speechMusicVolume} from '../../components/watch/watch-music';
import {setApiBase} from '../../lib/api';
setApiBase('http://localhost:3001');
function Fixture(){
 const [cursor,setCursor]=useState(1);
 const [gameSpeaking,setGameSpeaking]=useState(false),[volume,setVolume]=useState(.8);
 const elapsed=useRef(0),listeners=useRef(new Set<()=>void>());
 const [director]=useState(()=>({getElapsedBaseMs:()=>elapsed.current,isAnimating:()=>false,subscribe:(fn:()=>void)=>{listeners.current.add(fn);return()=>{listeners.current.delete(fn);};}}));
 const follow=useGamePlayback({id:'fixture',slug:'fixture',kind:'werewolf'},{kind:'werewolf',audience:'omniscient',cursor,part:{kind:'speech'}},[{id:'bea',name:'Bea'}],{director,revealAtMs:100});
 return <><output aria-label="Music volume">{speechMusicVolume(volume,gameSpeaking,follow.houseSpeaking).toFixed(2)}</output><button onClick={()=>{setGameSpeaking(s=>!s);follow.onSpeech(!gameSpeaking,'bea');}}>Toggle game speech</button><button onClick={()=>setVolume(.4)}>Lower music</button><button onClick={()=>{elapsed.current=100;listeners.current.forEach(fn=>fn());}}>Reveal action</button><button onClick={()=>setCursor(n=>n+1)}>Advance</button><div id="untrusted">DOM future winner: NEVER_SEND</div></>;
}
const roles=new URLSearchParams(location.search).get('role')?.split(',')??['producer'];
createRoot(document.getElementById('root')!).render(<StrictMode>{location.pathname.startsWith('/admin/follow/')?<OperatorFollowAccess loading={false} roles={roles}><Fixture/></OperatorFollowAccess>:<Fixture/>}</StrictMode>);
