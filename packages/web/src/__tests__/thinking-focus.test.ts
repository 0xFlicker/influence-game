import {expect,test} from "bun:test";
import {thinkingFocus} from "../components/watch/thinking-focus";
import {thoughtTiming,sampleThought,thoughtSpeechBoundaries} from "../components/watch/thinking-timing";
for(const [width,height] of [[3440,1440],[1280,720],[390,700],[640,250]]) test(`thinking framing stays readable at ${width}x${height}`,()=>{
 const face={left:width!*.3,top:height!*.2,width:60,height:80};
 const layout=thinkingFocus(width!,height!,face,1);
 expect(layout.box.left).toBeGreaterThanOrEqual(0);expect(layout.box.top).toBeGreaterThanOrEqual(0);
 expect(layout.box.left+layout.box.width).toBeLessThanOrEqual(width!);
 expect(layout.box.top+layout.box.height).toBeLessThanOrEqual(height!);
 expect(layout.box.height).toBeGreaterThan(100);
 expect(layout.head.x).toBeGreaterThan(0);expect(layout.head.y).toBeGreaterThan(0);
 expect(layout.head.x<layout.box.left || layout.head.y<layout.box.top).toBe(true);
 expect(thinkingFocus(width!,height!,face,0).mediaStyle.transform).toBe('translate(0px, 0px) scale(1)');
 expect(thinkingFocus(width!,height!,face,.2,true,true).mediaStyle).toEqual(thinkingFocus(width!,height!,face,1,true).mediaStyle);
});
test('thought never overlaps speech, and reads only after camera entrance',()=>{
 const speech={showAtMs:650,readAtMs:850,hideAtMs:6000,hiddenAtMs:6200};
 const thought=thoughtTiming('One deliberate thought.',speech)!;
 const shifted=thoughtSpeechBoundaries(speech,thought)!;
 for(let time=0;time<shifted.hiddenAtMs;time+=25){
  const frame=sampleThought(time,thought);
  if(frame){expect(time).toBeLessThan(shifted.showAtMs);if(frame.opacity>0)expect(frame.focus).toBe(1);}
 }
 expect(sampleThought(shifted.showAtMs,thought)).toBeNull();
 expect(sampleThought(thought.insertAt+thought.returnAtMs+450,thought)).toMatchObject({opacity:0,focus:.5});
});

for (const width of [1280, 3440]) test(`right-side scene heads keep thoughts on the left at ${width}px`, () => {
 const face={left:width / 2 - 40,top:140,width:80,height:100};
 // Focal scene framing can center a head that belongs to the right of the source image.
 const right=thinkingFocus(width,720,face,1,false,false,"right");
 const left=thinkingFocus(width,720,face,1,false,false,"left");
 expect(right.head.x).toBeGreaterThan(width / 2);
 expect(right.box.left+right.box.width).toBeLessThan(right.head.x-right.radius*.65);
 expect(right.head.x).toBeCloseTo(width-left.head.x);
 expect(right.box.left).toBeCloseTo(width-left.box.left-left.box.width);
 expect(thinkingFocus(width,720,face,0,false,false,"right").mediaStyle.transform).toBe("translate(0px, 0px) scale(1)");
 const mobile=thinkingFocus(390,700,face,1,false,false,"right");
 expect(mobile.faceOnRight).toBe(false);
 expect(mobile.head.y).toBeLessThan(mobile.box.top);
});
