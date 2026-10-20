import {expect,test} from "bun:test";
import {OpeningAudio} from "../components/watch/use-opening-audio";
import type {MusicStatus} from "../components/watch/watch-music";
class AudioStub {
  src=""; preload=""; paused=true; readyState=4; currentTime=0;duration=190;volume=1;playbackRate=1; error=null;
  plays=0;deny=false;
  async play(){this.plays++;if(this.deny) throw new DOMException("Denied","NotAllowedError"); this.paused=false;}
  pause(){this.paused=true;}
  load(){}
  removeAttribute(){this.src="";}
}
const input={tracks:[{src:"/score.mp3",time:6.5,gain:1}],playing:true,muted:false,volume:.3,speed:1};
test("opening sound follows presentation offset, pause, speed and seeks; leaving it disposes media",async()=>{
 const media:AudioStub[]=[];const controller=new OpeningAudio(()=>{},()=>{const audio=new AudioStub();media.push(audio);return audio as unknown as HTMLAudioElement;});
 controller.update(input);await Promise.resolve();expect(media[0]!.currentTime).toBe(6.5);expect(media[0]!.paused).toBe(false);
 controller.update({...input,playing:false});expect(media[0]!.paused).toBe(true);
 controller.update({...input,tracks:[{...input.tracks[0]!,time:7.1}],speed:2});await Promise.resolve();expect(media[0]!.currentTime).toBe(7.1);expect(media[0]!.playbackRate).toBe(2);
 controller.update({...input,muted:true});expect(media[0]!.paused).toBe(true);
 controller.update({...input,tracks:[]});expect(media[0]!.src).toBe("");
});
test("blocked autoplay does not retry every frame, and explicit unlock seeks to the current position",async()=>{
 const media=new AudioStub();media.deny=true;const states:MusicStatus[]=[];
 const controller=new OpeningAudio(s=>states.push(s),()=>media as unknown as HTMLAudioElement);
 controller.update(input);await Promise.resolve();controller.update({...input,tracks:[{...input.tracks[0]!,time:6.7}]});
 expect(states.at(-1)).toBe("blocked");expect(media.plays).toBe(1);
 media.deny=false;controller.unlock();await Promise.resolve();controller.update({...input,tracks:[{...input.tracks[0]!,time:6.8}]});
 expect(media.currentTime).toBeCloseTo(6.7);expect(states.at(-1)).toBe("playing");controller.dispose();
});
test("late play rejection after a seek cannot mark a disposed deck blocked",async()=>{
 const media=new AudioStub();let reject!:(reason:unknown)=>void;
 media.play=()=>new Promise<void>((_,fail)=>{reject=fail;});
 const states:MusicStatus[]=[];const controller=new OpeningAudio(s=>states.push(s),()=>media as unknown as HTMLAudioElement);
 controller.update(input);controller.update({...input,tracks:[]});reject(new DOMException("Denied","NotAllowedError"));await Promise.resolve();
 expect(states.at(-1)).toBe("idle");expect(media.paused).toBe(true);
});
test("a cold seek waits for metadata before playing at the requested offset", async()=>{
 const media=new AudioStub();media.readyState=0;
 const controller=new OpeningAudio(()=>{},()=>media as unknown as HTMLAudioElement);
 controller.update(input);expect(media.plays).toBe(0);
 media.readyState=1;controller.update(input);await Promise.resolve();
 expect(media.currentTime).toBe(6.5);expect(media.plays).toBe(1);
 controller.dispose();
});
