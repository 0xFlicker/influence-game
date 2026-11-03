import {expect,test} from "bun:test";
import {workerMediaFetch} from "./worker-media-fetch";

test("assigned workers scope private media while retaining public uploaded portraits and external media",async()=> {
  const requests:Request[]=[];
  const fetcher=Object.assign(async(input:Parameters<typeof fetch>[0],init?:RequestInit)=> {
    requests.push(new Request(input,init));return new Response();
  },{preconnect:fetch.preconnect});
  const scoped=workerMediaFetch(new URL("http://127.0.0.1:3000"),"job-id","execution-secret",new AbortController().signal,undefined,fetcher);
  await scoped("http://127.0.0.1:3000/api/admin/production/games/g/visual/artifacts/image");
  expect(new URL(requests[0]!.url).pathname).toBe("/api/internal/renders/job-id/media");
  expect(requests[0]!.headers.get("Authorization")).toBe("Bearer execution-secret");
  for(const url of ["http://127.0.0.1:3000/api/uploads/local?key=portrait.webp","https://public.invalid/portrait.webp"]) {
    await scoped(url);expect(requests.at(-1)!.url).toBe(url);expect(requests.at(-1)!.headers.has("Authorization")).toBe(false);
  }
});
