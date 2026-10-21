import {expect, test} from "bun:test";
import {thoughtTail} from "../components/watch/thought-tail";

test("long thinking connections have more growing circles without crossing the head or bubble", () => {
  const head = {x:100,y:100}, edge = {x:500,y:100};
  const circles = thoughtTail(head,edge,1.5);
  expect(circles.length).toBeGreaterThan(5);
  expect(circles.at(-1)!.width).toBeGreaterThan(30);
  for (const [i,circle] of circles.entries()) {
    expect(circle.left).toBeGreaterThan(head.x);
    expect(circle.left+circle.width).toBeLessThan(edge.x);
    if(i) expect(circle.left).toBeGreaterThan(circles[i-1]!.left+circles[i-1]!.width);
  }
  const reverse = thoughtTail(edge,head,1.5);
  expect(reverse.map(circle=>circle.width)).toEqual(circles.map(circle=>circle.width));
  expect(thoughtTail(head,head)).toEqual([]);
});
