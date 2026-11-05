import {afterEach, expect, test} from "bun:test";
import {act, cleanup, fireEvent, render} from "@testing-library/react";
import {Window} from "happy-dom";
import {useState} from "react";
import {ActiveFormatOverlay} from "../app/games/[slug]/components/active-format-label";
import {FormatRulesDialog} from "../app/games/[slug]/components/format-rules-dialog";
import {shouldSuppressDramaticAdvance} from "../app/games/[slug]/components/dramatic-interaction";

let restore: (() => Promise<void>) | undefined;
afterEach(async () => {await restore?.(); restore = undefined;});

test("the format button opens readable rules and Escape closes them without advancing", async () => {
  const dom = new Window({url:"http://localhost"});
  const keys = ["window","document","navigator","HTMLElement","Element","Node","Event"] as const;
  const previous = new Map(keys.map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for (const key of keys) Object.defineProperty(globalThis,key,{configurable:true,value:key === "window" ? dom : dom[key]});
  restore = async () => {await act(async () => cleanup()); await dom.close(); for (const key of keys) {const old = previous.get(key); if (old) Object.defineProperty(globalThis,key,old); else Reflect.deleteProperty(globalThis,key);}};
  let advances = 0, pauses = 0;
  function Player() {
    const [open,setOpen] = useState(false);
    return <div onClick={event => {if (!shouldSuppressDramaticAdvance(event.target)) advances++;}}><ActiveFormatOverlay formatId="majority_elimination" onOpen={() => {pauses++;setOpen(true);}} />
      {open && <FormatRulesDialog formatId="majority_elimination" onClose={() => setOpen(false)} />}</div>;
  }
  const view = render(<Player />);
  const button = view.getByRole("button",{name:"Read Highest Count format rules"});
  // The real player's ancestor suppresses button clicks through data-replay-controls.
  button.focus();
  fireEvent.click(button);
  expect(pauses).toBe(1);
  expect(view.getByRole("dialog").textContent).toContain("The highest total goes out");
  const close = view.getByRole("button",{name:"Close format rules"});
  expect(document.activeElement).toBe(close);
  fireEvent.keyDown(close,{key:"Escape"});
  expect(view.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(button);
  expect(advances).toBe(0);
});
