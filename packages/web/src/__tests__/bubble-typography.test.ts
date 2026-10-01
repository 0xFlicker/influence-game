import {expect,test} from "bun:test";
import {fitBubbleText, type BubbleBudget} from "../components/watch/bubble-typography";
const measure = (text:string,width:number,font:number) => Math.max(1,Math.ceil(text.length * font * .5 / width)) * font * 1.4;
const budget:BubbleBudget = {width:480,height:300,chrome:66,padding:18,maxFont:28,minFont:18};
test("short dialogue uses larger type and a snug bubble without changing padding", () => {
 const fit=fitBubbleText("Why did you change your vote?",budget,measure);
 expect(fit.fontSize).toBe(28);expect(fit.height).toBeLessThan(150);expect(fit.pages).toHaveLength(1);
 expect(fit.height).toBeGreaterThanOrEqual(budget.chrome + measure(fit.pages[0]!,442,fit.fontSize));
});
test("all pages use the tallest page's single frame and preserve every character", () => {
 const text="I need to hear your explanation before deciding where I stand. ".repeat(40);
 const fit=fitBubbleText(text,budget,measure);
 expect(fit.pages.length).toBeGreaterThan(2);expect(fit.pages.join("")).toBe(text);
 expect(fit.fontSize).toBe(18);
 for(const page of fit.pages) expect(measure(page,442,fit.fontSize)+budget.chrome+22).toBeLessThanOrEqual(fit.height);
 expect(fit.height).toBeLessThanOrEqual(budget.height);
 expect(fitBubbleText(text,budget,measure)).toEqual(fit);
});
test("compact frames shrink type before adding pages, without shrinking margins", () => {
 const text="Give me a reason to change my mind.";
 const small={...budget,width:220,height:120,chrome:42,padding:10,maxFont:20,minFont:12};
 const fit=fitBubbleText(text,small,measure);
 expect(fit.fontSize).toBeLessThanOrEqual(20);expect(fit.pages.join("")).toBe(text);
 expect(fit.height).toBeLessThanOrEqual(120);
});

test("a very short reply narrows without reducing its type or changing its line count", () => {
 const fit=fitBubbleText("Agreed.",budget,measure);
 expect(fit.width).toBe(240);expect(fit.fontSize).toBe(28);expect(fit.pages).toEqual(["Agreed."]);
});

test("a tight bubble moves its counter to the header rather than producing character pages", () => {
 const text="Give me a reason to change my mind. ".repeat(10);
 const fit=fitBubbleText(text,{width:440,height:76,chrome:50,padding:10,maxFont:20,minFont:12},measure);
 expect(fit.footerHeight).toBe(0);expect(fit.pages.join("")).toBe(text);
 expect(fit.pages.length).toBeLessThan(12);
 for(const page of fit.pages) expect(measure(page,418,fit.fontSize)+50).toBeLessThanOrEqual(fit.height);
});
