import {expect,test} from "bun:test";
import {decodeProductionRecordings,decodeSpeechAttachments,validateAlignment} from "./recordings";
const recording={momentId:"moment",messageId:"message",speakerId:"actor",textHash:"a".repeat(64),sha256:"b".repeat(64),durationMs:1000};
test("frozen recording evidence is bounded metadata without file paths or object URLs",()=>{
  expect(decodeProductionRecordings([recording])).toEqual([recording]);
  for (const changed of [{file:"/private/audio.wav"},{url:"blob:local"},{sha256:"changed"},{durationMs:0},{speakerId:undefined}])
    expect(()=>decodeProductionRecordings([{...recording,...changed}])).toThrow();
  expect(()=>decodeProductionRecordings([recording,recording])).toThrow("duplicate");
});
test("alignment must cover exact text in order within its measured recording",()=>{
  const spans=[{textStart:0,textEnd:4,startMs:10,endMs:400},{textStart:4,textEnd:8,startMs:400,endMs:900}];
  expect(validateAlignment(spans,"abcdefgh",1000)).toEqual(spans);
  for (const changed of [[spans[0]], [{...spans[0]!,textStart:1},spans[1]], [spans[0],{...spans[1]!,startMs:200}], [spans[0],{...spans[1]!,endMs:1001}]])
    expect(()=>validateAlignment(changed,"abcdefgh",1000)).toThrow();
  expect(()=>decodeProductionRecordings([{...recording,alignment:[{...spans[1]!,endMs:1001}]}])).toThrow("duration");
});
test("local manifest identity remains strict before a host opens audio",()=>{
  const entry={messageId:"message",speakerId:null,textHash:"a".repeat(64),file:"audio.wav"};
  expect(decodeSpeechAttachments([entry])).toEqual([entry]);
  expect(()=>decodeSpeechAttachments([{...entry,speakerId:undefined}])).toThrow();
  expect(()=>decodeSpeechAttachments([entry,entry])).toThrow("duplicate");
});
