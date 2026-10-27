import {expect, test} from "bun:test";
import {MediaAlignment} from "../components/watch/media-alignment";

function media() {
  let time = 0;
  const seeks: number[] = [];
  return {readyState:4,seeking:false,duration:60,playbackRate:1,seeks,
    get currentTime() {return time;},set currentTime(value:number) {time=value;seeks.push(value);}};
}
const target = {time:4,playing:true,speed:1,revision:0};

test("native playback is not repeatedly sought when its reported clock lags", () => {
  const alignment=new MediaAlignment(), audio=media();
  alignment.sync(audio,target);
  for(let index=1;index<=120;index++) alignment.sync(audio,{...target,time:4+index/30});
  expect(audio.seeks).toEqual([4]);
  alignment.sync(audio,{...target,time:8,revision:1});
  expect(audio.seeks).toEqual([4,8]);
});

test("cold metadata and overlapping seeks retain the latest requested destination", () => {
  const alignment=new MediaAlignment(), audio=media(); audio.readyState=0;
  alignment.sync(audio,target);expect(audio.seeks).toEqual([]);
  audio.readyState=1;alignment.sync(audio,{...target,time:5});expect(audio.seeks).toEqual([5]);
  audio.seeking=true;alignment.sync(audio,{...target,time:20,revision:1});
  expect(audio.seeks).toEqual([5]);
  audio.seeking=false;alignment.sync(audio,{...target,time:21,revision:1});expect(audio.seeks).toEqual([5,21]);
});

test("buffer recovery waits for playable data before one alignment; pause, resume and rate changes align", () => {
  const alignment=new MediaAlignment(), audio=media();
  alignment.sync(audio,target);audio.readyState=2;alignment.waitForData();
  for(let index=1;index<=60;index++) alignment.sync(audio,{...target,time:4+index/30});
  expect(audio.seeks).toEqual([4]);
  audio.readyState=3;alignment.sync(audio,{...target,time:7});expect(audio.seeks).toEqual([4,7]);
  alignment.sync(audio,{...target,time:8,playing:false});
  alignment.sync(audio,{...target,time:10,playing:false});
  alignment.sync(audio,{...target,time:11});
  alignment.sync(audio,{...target,time:12,speed:2});
  expect(audio.seeks).toEqual([4,7,8,10,11,12]);expect(audio.playbackRate).toBe(2);
});
