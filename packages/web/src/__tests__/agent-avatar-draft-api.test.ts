import { Window } from "happy-dom";
import { afterEach, describe, expect, test } from "bun:test";
import {
  getDraftAgentAvatarGeneration,
  requestDraftAgentAvatarGeneration,
  setApiBase,
} from "../lib/api";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
  globalThis.fetch = originalFetch;
  setApiBase("");
  Object.defineProperty(globalThis,"window",{configurable:true,value:originalWindow});
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:originalLocalStorage});
});

describe("draft agent portrait API", () => {
  test("starts from generated personality fields and polls the owned request", async () => {
    Object.defineProperty(globalThis,"window",{configurable:true,value:new Window({url:"http://localhost"})});
    Object.defineProperty(globalThis,"localStorage",{configurable:true,value:window.localStorage});
    setApiBase("http://127.0.0.1:3333");
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({
        avatarCompletion: {
          status: requests.length === 1 ? "accepted" : "completed",
          generationRequestId: "draft-request-1",
          avatarUrl: requests.length === 1 ? undefined : "/api/uploads/local?key=draft.png",
        },
      }), {
        status: requests.length === 1 ? 202 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await requestDraftAgentAvatarGeneration({
      name: "Mira",
      gender: "female",
      backstory: "A practiced mediator.",
      personality: "Patient and incisive.",
      strategyStyle: "Build stable coalitions.",
      personaKey: "diplomat",
    });
    await getDraftAgentAvatarGeneration("draft-request-1");

    expect(requests[0]!.url).toBe("http://127.0.0.1:3333/api/agent-profiles/avatar/generate-draft");
    expect(requests[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]!.init?.body))).toMatchObject({
      name: "Mira",
      gender: "female",
      personality: "Patient and incisive.",
    });
    expect(requests[1]!.url).toBe("http://127.0.0.1:3333/api/agent-profiles/avatar/generation-drafts/draft-request-1");
  });
});
