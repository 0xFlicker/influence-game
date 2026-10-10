import {afterEach, beforeEach, expect, test} from "bun:test";
import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {Window} from "happy-dom";
import {ReplayScrubber} from "../components/watch/replay-scrubber";

const globals = ["window", "document", "navigator", "HTMLElement", "Node", "Event"] as const;
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis,key)]));
let dom: Window;
beforeEach(() => {
  dom = new Window({url:"http://localhost"});
  for (const key of globals) Object.defineProperty(globalThis,key,{configurable:true,value:dom[key]});
});
afterEach(async () => {
  await act(async () => cleanup()); dom.close();
  for (const key of globals) {
    const descriptor = saved.get(key);
    if (descriptor) Object.defineProperty(globalThis,key,descriptor); else Reflect.deleteProperty(globalThis,key);
  }
});
function slider(view: ReturnType<typeof render>) {
  const input = view.getByRole("slider") as HTMLInputElement;
  input.setPointerCapture = () => {};
  return input;
}

test("drag follows the pointer across playback rerenders and commits only once, retaining its target while loading", async () => {
  const seeks: number[] = [];
  let complete!: () => void;
  const onSeek = (value: number) => {seeks.push(value);return new Promise<void>(resolve => {complete=resolve;});};
  const props = {cursor:4,count:130,onSeek};
  const view = render(<ReplayScrubber {...props} />), input = slider(view);
  fireEvent.pointerDown(input,{button:0,pointerId:1});
  fireEvent.input(input,{target:{value:"40"}});
  view.rerender(<ReplayScrubber {...props} cursor={5} />);
  expect(input.value).toBe("40");
  fireEvent.input(input,{target:{value:"92"}});
  expect(input.value).toBe("92"); expect(seeks).toEqual([]);
  fireEvent.pointerUp(input,{pointerId:1});
  fireEvent.lostPointerCapture(input,{pointerId:1});
  expect(seeks).toEqual([92]); expect(input.value).toBe("92");
  view.rerender(<ReplayScrubber {...props} cursor={91} />);
  await act(async () => complete());
  expect(input.value).toBe("92");
});

test("canceled drags do not seek and end the scrub session once", () => {
  const seeks: number[] = []; let ends=0;
  const view = render(<ReplayScrubber cursor={2} count={130} onSeek={value=>{seeks.push(value);}} onScrubEnd={()=>{ends++;}} />), input=slider(view);
  fireEvent.pointerDown(input,{button:0,pointerId:1});
  fireEvent.input(input,{target:{value:"90"}});
  fireEvent.pointerCancel(input,{pointerId:1}); fireEvent.lostPointerCapture(input,{pointerId:1});
  expect(input.value).toBe("3"); expect(seeks).toEqual([]); expect(ends).toBe(1);
});

test("keyboard changes seek immediately; an earlier completion cannot reset a newer target", async () => {
  const seeks: number[] = [], completions: Array<()=>void> = [];
  const view = render(<ReplayScrubber cursor={2} count={130} onSeek={value=>{seeks.push(value);return new Promise<void>(resolve=>completions.push(resolve));}} />), input=slider(view);
  fireEvent.input(input,{target:{value:"4"}}); fireEvent.input(input,{target:{value:"5"}});
  expect(seeks).toEqual([4,5]);
  await act(async () => completions[0]!()); expect(input.value).toBe("5");
  await act(async () => completions[1]!()); expect(input.value).toBe("3");
});

test("a track click commits on release and blur commits an interrupted drag", async () => {
  const seeks: number[] = [];
  const view=render(<ReplayScrubber cursor={0} count={118} onSeek={value=>{seeks.push(value);}} />),input=slider(view);
  await act(async () => {
    fireEvent.pointerDown(input,{button:0,pointerId:1}); fireEvent.input(input,{target:{value:"80"}}); fireEvent.pointerUp(input,{pointerId:1});
  });
  await act(async () => {
    fireEvent.pointerDown(input,{button:0,pointerId:2}); fireEvent.input(input,{target:{value:"100"}}); fireEvent.blur(input);
  });
  expect(seeks).toEqual([80,100]);
});
