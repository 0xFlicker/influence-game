import {expect,test} from "bun:test";
import {createRef} from "react";
import {renderToString} from "react-dom/server";
import {WatchTransport} from "../components/watch/watch-transport";

test("Werewolf viewing mode is an accessible eye icon in the existing transport row", () => {
  const noop = () => {};
  const html = renderToString(<WatchTransport theater={false} theaterButton={createRef()} toggleTheater={noop}
    fullscreen={false} fullscreenButton={createRef()} toggleFullscreen={noop} fullscreenError={null}
    audio={{muted:true,onMute:noop}} isPlaying={false} togglePlay={noop} speed={1} onSpeed={noop}
    goToBeginning={noop} goToPrevScene={noop} onSeek={noop} goToNextScene={noop} goToEnd={noop}
    timeline={{getFrame:()=>0,subscribe:()=>noop,frameCount:100,fps:30,target:()=>null}}
    audience={{value:"omniscient",onChange:noop}} live={false} cursor={0} count={1} />);
  const eye = html.match(/<button[^>]*aria-label="Viewing mode: Omniscient"[^>]*>[\s\S]*?<\/button>/)?.[0];
  expect(eye).toContain("<svg");
  expect(eye?.replace(/<[^>]*>/g, "").trim()).toBe("");
  const row = html.match(/<div[^>]*data-watch-transport[^>]*>/)?.[0];
  expect(row).toBeDefined();
  expect(row).not.toContain("flex-wrap");
});
