import {expect, test} from "bun:test";
import {renderToStaticMarkup} from "react-dom/server";
import {cleanSpeechPage} from "../app/games/[slug]/components/speech-pages";
import {TimedSpeech} from "../app/games/[slug]/components/timed-speech";
import {SpeechBubble} from "../components/watch/speech-bubble";

test("historical pages hide XML even when a tag crosses a frozen page boundary", () => {
  const pages = ['<warm mood="very ', 'friendly">Hello 🐺</warm> [Ada]', ' <soft>Stay.</soft>[pause]'];
  expect(pages.map((_, index) => cleanSpeechPage(pages, index))).toEqual(["", "Hello 🐺 [Ada]", " Stay."]);
  expect(pages[0]).toBe('<warm mood="very ');
});

test("Studio timed and static speech hide unsupported XML in saved dialogue", () => {
  const text = "<warm>Haiku, quite the elegant puzzle.</warm> [Ada]";
  const timed = renderToStaticMarkup(<TimedSpeech text={text} elapsedMs={500}/>);
  const staticBubble = renderToStaticMarkup(<SpeechBubble speaker="Gemini Pro" text={text}
    box={{left:0,top:0,width:500,height:300}} opacity={1} padding={20} elapsedMs={0}
    staticSpeech tail={{side:"bottom",style:{}}}/>);
  for (const html of [timed, staticBubble]) {
    expect(html).toContain("Haiku, quite the elegant puzzle.");
    expect(html).toContain("[Ada]");
    expect(html).not.toContain("warm");
  }
});
