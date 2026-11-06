import {expect,test} from "bun:test";
import {decodeRenderInput} from "../render-job";
import {resolveRenderExecution,studioRenderEnabled} from "../render-execution-config";
test("render inputs reject unknown variants and path traversal",()=> {
  for(const path of ["../x","assets/../x","assets//x","/manifest.json","assets/x?token=y","assets\\x"])
    expect(()=>decodeRenderInput({version:1,workload:"studio-export",selectionHash:`sha256:${"a".repeat(64)}`,files:[{path,sha256:"b".repeat(64),byteLength:1}]})).toThrow();
  expect(()=>decodeRenderInput({version:1,workload:"trailer",gameId:"game",renderVersion:1,command:"override"})).toThrow();
});
test("Batch targets are explicit workload policy and cannot introduce a fallback target",()=> {
  const environments={staging:{mode:"remote",network:"tailnet",apiOrigin:"https://influence-staging.tail8a79ed.ts.net",targets:{trailer:"existing","studio-export":"aws-batch"}}};
  expect(resolveRenderExecution(JSON.stringify({schemaVersion:1,environments}),"staging").targets?.trailer).toBe("existing");
  environments.staging.targets.trailer="fallback";
  expect(()=>resolveRenderExecution(JSON.stringify({schemaVersion:1,environments}),"staging")).toThrow("Invalid render targets");
});
test("native Studio rendering is available only under the development local policy",()=> {
  const local=resolveRenderExecution(JSON.stringify({schemaVersion:1,environments:{}}),undefined);
  expect(studioRenderEnabled(local)).toBe(true);
  for(const environment of ["prod","staging"] as const)expect(studioRenderEnabled({...local,environment})).toBe(false);
  expect(studioRenderEnabled({...local,mode:"remote"})).toBe(false);
});
