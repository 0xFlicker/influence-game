import {afterEach,expect,test} from "bun:test";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {GameState} from "../game-state";
import {Phase} from "../types";
import {hashCanonicalJson} from "@influence/prompt-lab-protocol";
import {createRetrospectiveDefinition,prepareRetrospectiveRequest,retrospectiveCompletionProof} from "../retrospective";
import {completedWerewolfResultsFixture} from "../fixtures/werewolf-results";
import { startWerewolf, werewolfConfig } from "../werewolf/rules";
import {GameMcpReadModel} from "../game-mcp/read-model";
import {createGameMcpServer} from "../game-mcp/server";
import {simulationIdentity} from "../simulation-identity";
const roots:string[] = [];
afterEach(() => {for(const root of roots) rmSync(root,{recursive:true,force:true});roots.length = 0;});
function corpus(kind:"influence"|"werewolf",records:unknown[]) {
  const root = mkdtempSync(join(tmpdir(),"retrospective-mcp-"));roots.push(root);
  const directory = join(root,"session");mkdirSync(directory);
  writeFileSync(join(directory,"session.json"),JSON.stringify(simulationIdentity(kind)));
  writeFileSync(join(directory,"game-1-events.jsonl"),records.map(record => JSON.stringify(record)).join("\n")+"\n");
  return {root,directory,reader:new GameMcpReadModel(root)};
}
function influence() {
  const game = new GameState(["a","b","c"].map(id => ({id,name:id})),{gameId:"local-influence"});
  game.eliminatePlayer("b");game.eliminatePlayer("c");
  const outcome = game.getDomainProjection().retrospectiveOutcomeSource!;
  game.recordRetrospective("retrospective.started",createRetrospectiveDefinition({version:1,outcome,dialogue:[],
    sections:[{phase:"fixture",fromEventSequence:1,throughEventSequence:outcome.eventSequence,summary:"The entire fixture: B and C exited; A won."}]},["b","c","a"]));
  for (let i=0;i<3;i++) {
    const request = prepareRetrospectiveRequest(game.getDomainProjection().retrospective!);
    game.recordRetrospective("retrospective.statement_recorded",{version:1,definitionHash:request.definitionHash,actorId:request.actorId,ordinal:request.ordinal,
      requestHash:hashCanonicalJson(request),priorStatementsHash:request.priorStatementsHash,providerLogicalCallId:`fixture-${i}`,speech:`${request.actorId}'s exact final statement.`});
  }
  game.recordRetrospective("retrospective.completed",retrospectiveCompletionProof(game.getDomainProjection().retrospective!));
  game.recordPhaseEntered(Phase.END);
  return game.getCanonicalEvents();
}
test("local Influence inspection keeps canonical order, exact text and bounded public source references",() => {
  const events = influence(),{reader,directory} = corpus("influence",events.map(canonicalEvent => ({canonicalEvent})));
  const first = reader.readRetrospective("session",1,-1,1);
  expect(first).toMatchObject({gameKind:"influence",progress:{status:"completed",statementCount:3},speakerIds:["b","c","a"],hasMore:true});
  expect(first.statements[0]).toMatchObject({actorId:"b",speech:"b's exact final statement.",citation:{sourcePath:join(directory,"game-1-events.jsonl")}});
  expect(reader.readRetrospective("session",1,first.nextAfterOrdinal).statements.map(s => s.actorId)).toEqual(["c","a"]);
  expect(JSON.stringify(first)).not.toContain("inputHash");
  expect(() => reader.readWerewolfHistory("session",1,"mystery")).toThrow("explicit Werewolf");
});
test("local Werewolf adapter validates the full tail and gives Mystery only its audience history",async () => {
  const events = await completedWerewolfResultsFixture("saved","local-wolf",1);
  const {reader,directory} = corpus("werewolf",events.map(werewolfEvent => ({werewolfEvent})));
  expect(reader.listGames()[0]?.gameKind).toBe("werewolf");
  expect(() => reader.readProjection("session",1)).toThrow("Werewolf adapter");
  const report = reader.readRetrospective("session",1),state = reader.readWerewolfProjection("session",1);
  expect(report.speakerIds).toEqual(state.retrospective!.definition.speakerIds);
  expect(report.statements.map(s => s.speech)).toEqual(state.retrospective!.statements.map(s => s.speech));
  const history = reader.readWerewolfHistory("session",1,"mystery",1,64);
  expect(history.moments.every(moment => !(moment.entry.kind === "speech" && moment.entry.audience === "pack"))).toBeTrue();
  expect(JSON.stringify(history)).not.toContain("strategy");
  expect(() => reader.readRetrospective("session",1,-1,13)).toThrow("bounded");
  writeFileSync(join(directory,"game-1-events.jsonl"),events.slice(0,-2).concat(events.at(-1)!).map(werewolfEvent => JSON.stringify({werewolfEvent})).join("\n")+"\n");
  expect(() => reader.readRetrospective("session",1)).toThrow();
});
test("local Werewolf history reads current v9 sessions through the owning versioned projector", () => {
  const players = Array.from({ length: 6 }, (_, index) => ({ id: `v9-${index}`, name: `V9 ${index}`, personality: "Fixture", backstory: "", strategy: "", avatarUrl: null }));
  const started = startWerewolf("local-v9", players, werewolfConfig("one_wolf"), "local-v9-seed");
  const { reader } = corpus("werewolf", [started].map(werewolfEvent => ({ werewolfEvent })));
  const history = reader.readWerewolfHistory("session", 1, "mystery");
  expect(history.rulesVersion).toBe(9);
  expect(history.moments[0]).toMatchObject({ entry: { kind: "phase", phase: "introduction" }, snapshot: { rulesVersion: 9 } });
  expect(reader.readWerewolfProjection("session", 1).config.rulesVersion).toBe(9);
});
test("actual local MCP dispatch uses closed inspection arguments and explicit kind identity",async () => {
  const {root,directory} = corpus("influence",influence().map(canonicalEvent => ({canonicalEvent}))),server = createGameMcpServer(root);
  const call = (args:unknown) => server.handle({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"read_game_retrospective",arguments:args}});
  const valid = await call({sessionId:"session",gameNumber:1,limit:1});
  expect(valid?.error).toBeUndefined();expect(JSON.stringify(valid?.result)).toContain("exact final statement");
  for(const args of [{sessionId:"session",gameNumber:1,private:true},{sessionId:"session",gameNumber:1,limit:0},{sessionId:"session",gameNumber:1,afterOrdinal:0.5}]) expect((await call(args))?.error).toBeDefined();
  writeFileSync(join(directory,"session.json"),JSON.stringify({schema:"house.simulation-session",version:1,gameKind:"third-game"}));
  expect((await call({sessionId:"session",gameNumber:1}))?.error).toBeDefined();
});
