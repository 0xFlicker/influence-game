import { expect, test } from "bun:test";
import { render, fireEvent, cleanup, waitFor, act } from "@testing-library/react";
import { fileURLToPath } from "node:url";

test("Werewolf start confirms AI filling, allows full casts, and hides controls from non-operators", async () => {
  // Keep auth module mocks in other suites out of this real-context test.
  if (process.env.WEREWOLF_START_UI_TEST !== "1") {
    const child = Bun.spawn([process.execPath, "test", fileURLToPath(import.meta.url)], { env: { ...process.env, WEREWOLF_START_UI_TEST: "1" }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, errors: code ? stdout + stderr : "" }).toEqual({ code: 0, errors: "" });
    return;
  }
  const { Window } = await import("happy-dom");
  const dom = new Window({ url: "http://localhost" });
  const globals = ["window", "document", "navigator", "localStorage", "HTMLElement", "Node", "Event"] as const;
  const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
  const { InfluenceAuthContext } = await import("../hooks/use-auth");
  const { WerewolfWaitingGame } = await import("../components/games/werewolf/werewolf-entry");
  const { setApiBase } = await import("../lib/api");
  setApiBase("");
  const oldFetch = globalThis.fetch;
  const writes: string[] = [];
  globalThis.fetch = Object.assign(async (input: string | URL | Request) => { writes.push(String(input)); return Response.json({}); }, { preconnect: oldFetch.preconnect }) as typeof fetch;
  const game = { id: "game", slug: "test-village", status: "waiting", players: [], playerCount: 6, modelLabel: "test", visibility: "public", started: false, preset: "one_wolf" } as import("../lib/werewolf-api").WerewolfLobbyData;
  const show = (role: string, roster = game) => render(<InfluenceAuthContext.Provider value={{ ready: true, authenticated: true, account: { publicId: "owner", roles: [role], permissions: ["start_game"] }, hydrationError: false } as import("../hooks/use-auth").InfluenceAuthState}>
    <WerewolfWaitingGame game={roster} refresh={async () => {}} />
  </InfluenceAuthContext.Provider>);
  try {
    for (const role of ["player", "producer"]) {
      const view = show(role);
      expect(view.queryByRole("button", { name: "Start Werewolf" })).toBeNull(); cleanup();
    }
    for (const role of ["gamer", "admin", "sysop"]) {
      const view = show(role); const before = writes.length;
      fireEvent.click(view.getByRole("button", { name: "Start Werewolf" }));
      expect(view.getByRole("dialog").textContent).toContain("6 of 6 seats are empty");
      expect(writes.length).toBe(before);
      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      expect(writes.length).toBe(before);
      fireEvent.click(view.getByRole("button", { name: "Start Werewolf" }));
      fireEvent.click(view.getByRole("button", { name: "Add 6 House agents and start" }));
      await waitFor(() => expect(writes.length).toBe(before + 1));
      await waitFor(() => expect(view.getByRole("button", { name: "Start Werewolf" })).toBeTruthy()); cleanup();
    }
    const full = show("gamer", { ...game, players: Array.from({length: 6}, (_, i) => ({id: `p${i}`, agentProfileId: `a${i}`, ownerPublicId: `u${i}`, name: `Player ${i}`, avatarUrl: null, personaKey: "observer", available: true})) });
    fireEvent.click(full.getByRole("button", { name: "Start Werewolf" }));
    expect(full.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(writes).toHaveLength(4));
    expect(writes.every(url => url.endsWith("/api/werewolf/game/start"))).toBe(true);
  } finally {
    await act(async () => cleanup()); globalThis.fetch = oldFetch; dom.close();
    for (const key of globals) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
  }
});
