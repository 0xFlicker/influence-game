import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window as HappyDOMWindow } from "happy-dom";
import { useState } from "react";
import { AccountRoleEditor } from "../app/admin/account-role-editor";
import { setApiBase } from "../lib/api";

const originals = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document, navigator: globalThis.navigator, localStorage: globalThis.localStorage };
let dom: HappyDOMWindow | null = null;
afterEach(async () => {
  await act(async () => { cleanup(); });
  globalThis.fetch = originals.fetch; setApiBase("");
  for (const name of ["window", "document", "navigator", "localStorage"] as const) Object.defineProperty(globalThis, name, { configurable: true, value: originals[name] });
  dom?.close(); dom = null;
});

test("assigns and revokes an existing role by the selected account's public ID", async () => {
  dom = new HappyDOMWindow({ url: "http://localhost/admin" });
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.navigator });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.localStorage });
  const publicId = "baf597da-c8ad-4bef-ad4b-568bbe51f139";
  const mutations: Array<{ method: string; body: unknown }> = [];
  globalThis.fetch = (async (request, init) => {
    const path = String(request), method = init?.method ?? "GET";
    if (method !== "GET") mutations.push({ method, body: JSON.parse(String(init?.body)) });
    const body = path.endsWith("/roles") ? [{ id: "gamer-id", name: "gamer", permissions: ["create_game", "fill_game", "start_game"] }]
      : {};
    return new Response(JSON.stringify(body), { status: method === "POST" ? 201 : 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  function Harness() {
    const [roles, setRoles] = useState<string[]>([]);
    return <AccountRoleEditor publicId={publicId} accountName="Player" assigned={roles}
      onChange={(role, grant) => setRoles(grant ? [role] : [])} />;
  }
  const mounted = render(<Harness />);
  const select = await mounted.findByLabelText("Role to assign");
  fireEvent.change(select, { target: { value: "gamer-id" } });
  fireEvent.click(mounted.getByRole("button", { name: "Assign role" }));
  await waitFor(() => expect(mutations).toEqual([{ method: "POST", body: { publicId, roleId: "gamer-id" } }]));
  fireEvent.click(await mounted.findByRole("button", { name: "Revoke Game Operator" }));
  await waitFor(() => expect(mutations[1]).toEqual({ method: "DELETE", body: { publicId, roleId: "gamer-id" } }));
  await mounted.findByText("Game Operator revoked.");
});
