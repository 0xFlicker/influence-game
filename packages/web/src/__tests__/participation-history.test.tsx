import { expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { HouseParticipation } from "@influence/engine/house-participation";
import { participationOutcome } from "../lib/participation";
import { ParticipationRows } from "../components/participation-history";
import { DashboardHistory } from "../app/dashboard/dashboard-history";
const wolf: Extract<HouseParticipation,{gameKind:"werewolf"}> = {
  gameKind:"werewolf",gameId:"wolf",gameSlug:"moonlit-village",gameTitle:"Lanterns and Lies",playerId:"dead-villager",agentProfileId:"agent",agentName:"Frozen Name",totalPlayers:6,completedAt:"2026-10-05T12:00:00.000Z",
  result:{outcome:"win",faction:"village",alive:false,eliminationDay:1,days:3},
};
const influence: Extract<HouseParticipation,{gameKind:"influence"}> = {
  ...wolf,gameKind:"influence",gameId:"influence",gameSlug:"influence",completedAt:"2026-10-04T12:00:00.000Z",
  result:{outcome:"loss",placement:2,eliminated:true,rounds:3,totalPoints:10},
};
test("faction success and survival are independent; Werewolf has no placement or score",()=>{
  expect(participationOutcome(wolf)).toBe("Village victory · Eliminated day 1");
  expect(participationOutcome({...wolf,result:{...wolf.result!,outcome:"loss",faction:"wolves",alive:true}})).toBe("Wolves defeated · Survived");
  expect(participationOutcome({...wolf,result:{...wolf.result!,outcome:"draw",eliminationDay:null}})).toBe("Draw · Eliminated");
  expect(participationOutcome({...wolf,result:null})).toBe("Result unavailable");
  expect(participationOutcome(influence)).toBe("#2 of 6 · 10 pts");
  expect(participationOutcome({...influence,result:{...influence.result!,placement:null,totalPoints:null}})).toBe("Defeated");
  const html=renderToString(<ParticipationRows entries={[wolf]}/>);
  expect(html).toContain("Lanterns and Lies");expect(html).toContain('/games/moonlit-village/results');expect(html).toContain("Results · Spoilers");
  expect(html).not.toContain("pts");expect(html).not.toContain("#");
});
test("history exposes filters, loading, failure and empty states",()=>{
  const render=(entries:HouseParticipation[],loading=false,error:string|null=null)=>renderToString(<DashboardHistory entries={entries} loading={loading} error={error}/>);
  expect(render([wolf])).toContain('aria-pressed="true"');
  expect(render([])).toContain("No completed games");
  expect(render([],true)).toContain('role="status"');
  expect(render([],false,"History unavailable")).toContain('role="alert"');
});
test("dashboard history hides results until the results page is opened",()=>{
  const html=renderToString(<DashboardHistory entries={[wolf,influence]} loading={false} error={null}/>);
  expect(html).toContain("Frozen Name");
  expect(html).toContain("View results · Spoilers");
  expect(html).toContain('/games/moonlit-village/results');
  expect(html).not.toContain("Village victory");
  expect(html).not.toContain("Eliminated day 1");
  expect(html).not.toContain("#2 of 6");
  expect(html).not.toContain("10 pts");
});
