import { expect, test } from "bun:test";
import { defaultSeason, recommendedSeasonAgent } from "../app/seasons/season-selection";
import type { SavedAgent, SeasonDashboard, SeasonIdentity } from "../lib/api";
const season = (slug: string, status: SeasonIdentity["status"], finalizedAt: string | null = null): SeasonIdentity => ({id:slug,slug,name:slug,status,finalizedAt,ratedPool:"free",admissionStartsAt:null,admissionClosesAt:null});
const agent = (id: string, createdAt: string): SavedAgent => ({id,name:id,createdAt,updatedAt:createdAt,backstory:null,personality:"",strategyStyle:null,personaKey:null,avatarUrl:null,gamesPlayed:0,gamesWon:0});
const row = (agentId: string, totalPoints: number): SeasonDashboard["agentStandings"][number] => ({agentId,totalPoints,rank:1,agentName:agentId,ownerName:"Owner",gamesPlayed:1,wins:0,runnerUpFinishes:0,averageNormalizedPlacement:0});
test("explicit history selection wins; real finalized season precedes an unfinalized fixture", () => {
 const seasons = [season("fixture","final"),season("zero","final","2026-10-01")];
 expect(defaultSeason(seasons)?.slug).toBe("zero");
 expect(defaultSeason(seasons,"fixture")?.slug).toBe("fixture");
 expect(defaultSeason([season("one","active"),...seasons])?.slug).toBe("one");
 expect(defaultSeason([])).toBeUndefined();
});
test("recommendation uses selected season points, not lifetime wins or update time", () => {
 const agents = [agent("older","2026-01-01"),agent("newest","2026-02-01")];
 agents[1]!.gamesWon=99;
 expect(recommendedSeasonAgent(agents,[row("older",10),row("other-owner",1000)])?.id).toBe("older");
 expect(recommendedSeasonAgent(agents,[])?.id).toBe("newest");
 expect(recommendedSeasonAgent(agents,[row("older",0)])?.id).toBe("newest");
 expect(recommendedSeasonAgent([],[])).toBeUndefined();
 expect(agents[0]!.id).toBe("older");
});
