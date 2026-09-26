import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window } from "happy-dom";
import { useState } from "react";
import type { AgentCreationTraitId } from "@influence/engine/agent-creation-traits";
import { AgentCreationChat, type CharacterChatProfile } from "../app/dashboard/agents/agent-creation-chat";

const originalFetch = globalThis.fetch;
const globalKeys = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "InputEvent", "localStorage"] as const;
const saved = new Map(globalKeys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;
let command: string;
let clarification: string;
let fetchCalls: number;
let generated: string[];
let appearances: string[];
const profile: CharacterChatProfile = { name: "Mira Vale", personaKey: "diplomat", gender: "female", personality: "A warm diplomat who keeps receipts.", backstory: "An exiled ambassador.", strategyStyle: "Build trust.", performanceInstructions: "Quiet gestures.", visualDesign: "Blue coat." };
beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  for (const key of globalKeys) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
  command = "accept_character"; clarification = "Which direction would you like to try?"; generated = []; appearances = []; fetchCalls = 0;
  globalThis.fetch = Object.assign(async () => { fetchCalls++; return Response.json({ command, reply: command === "clarify" ? clarification : "" }); }, { preconnect: originalFetch.preconnect });
});
afterEach(() => {
  cleanup(); dom.close(); globalThis.fetch = originalFetch;
  for (const key of globalKeys) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
function mount(withIngredients = false, hasImage = false, headRequired = false) {
  function Harness() {
    const [ids, setIds] = useState<AgentCreationTraitId[]>([]);
    const [draft, setDraft] = useState(withIngredients ? { ...profile, personality: "" } : profile);
    return <AgentCreationChat creationTraitIds={ids} onCreationTraitIdsChange={withIngredients ? setIds : undefined} profile={draft} onGenerate={async message => { generated.push(message); setDraft(current => ({ ...current, personality: profile.personality })); return true; }} onAppearance={async message => { appearances.push(message); return true; }} busy={false} blocked={false} headRequired={headRequired} hasImage={hasImage} onHeadshot={() => {}} onAdvanced={() => {}} onCancel={() => {}} onSaveDraft={() => {}} submitDisabled={false} submitLabel="Create Agent" />;
  }
  return render(<Harness />);
}
test("the empty creator gives a visual starting point and a labeled composer", () => {
  const view = mount(true);
  expect(view.getByText("Your character starts here.")).toBeTruthy();
  expect(view.getByText(/players build trust, vie for empowerment/)).toBeTruthy();
  expect(view.container.querySelector('img[src="/logo.png"]')).toBeTruthy();
  expect(view.getByText("Your response").getAttribute("for")).toBe("agent-creation-message");
  expect(view.getByLabelText("Message the character assistant").classList.contains("agent-creation-composer")).toBe(true);
  expect(view.getByRole("region", { name: "Character fixtures" }).textContent).not.toContain("Character ingredients");
  expect(view.container.querySelector("footer")?.textContent).toContain("Character ingredients");
  const conversation = view.getByRole("log", { name: "Character creation conversation" });
  const ingredients = view.getByText("Character ingredients");
  const composer = view.getByLabelText("Message the character assistant");
  expect(Boolean(conversation.compareDocumentPosition(ingredients) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  expect(Boolean(ingredients.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
});
test("the House mark and composer stay in place through a clarification", async () => {
  const response = Promise.withResolvers<Response>();
  let sentDraft: Record<string, string> | undefined;
  globalThis.fetch = Object.assign(async (_input: string | URL | Request, init?: RequestInit) => {
    sentDraft = (JSON.parse(String(init?.body)) as { draft: Record<string, string> }).draft;
    return response.promise;
  }, { preconnect: originalFetch.preconnect });
  const view = mount(true);
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "What is empowerment?" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  expect(view.getByText("Your character starts here.")).toBeTruthy();
  expect(view.queryByText("Your name, archetype, and character prompt will take shape here.")).toBeNull();
  expect(view.getByText("Character ingredients")).toBeTruthy();
  expect(view.getByLabelText("Message the character assistant").hasAttribute("hidden")).toBe(false);
  await waitFor(() => expect(sentDraft?.strategyStyle).toBe("Build trust."));
  await act(async () => response.resolve(Response.json({ command: "clarify", reply: "Empowerment can choose the format and break a tie, but gives no immunity. Would your character seek it?" })));
  await waitFor(() => expect(view.getByText(/Empowerment can choose the format/)).toBeTruthy());
  expect(view.getByText("Your character starts here.")).toBeTruthy();
  const log = view.getByRole("log", { name: "Character creation conversation" });
  expect(log.textContent).toContain("In Influence, players build trust");
  expect(log.textContent?.indexOf("In Influence, players build trust")).toBeLessThan(log.textContent?.indexOf("What is empowerment?") ?? 0);
  expect(log.textContent?.indexOf("What is empowerment?")).toBeLessThan(log.textContent?.indexOf("Empowerment can choose") ?? 0);
  expect(generated).toHaveLength(0);
  expect(appearances).toHaveLength(0);
});
test("approval advances immediately without a model call or image generation", async () => {
  const view = mount();
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Yes, that feels right" })));
  await waitFor(() => expect(view.getByText(/What do they look like/)).toBeTruthy());
  expect(generated).toHaveLength(0); expect(appearances).toHaveLength(0);
  expect(fetchCalls).toBe(0);
  expect(view.queryByRole("status", { name: "Assistant typing" })).toBeNull();
  command = "generate_appearance";
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "A blue dragon in a gold coat" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await waitFor(() => expect(appearances).toEqual(["A blue dragon in a gold coat"]));
});
test("negative feedback revises the profile and asks for approval again", async () => {
  command = "revise_character";
  const view = mount();
  fireEvent.click(view.getByRole("button", { name: "Read Character prompt" }));
  fireEvent.click(view.getByRole("button", { name: "Edit Character prompt" }));
  expect(view.getByRole("button", { name: "Remove change Character prompt" })).toBeTruthy();
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "No, make her more suspicious" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await waitFor(() => expect(generated).toEqual(["No, make her more suspicious"]));
  expect(appearances).toHaveLength(0);
  expect(view.getByRole("button", { name: "Yes, that feels right" })).toBeTruthy();
});
test("an illegal command cannot generate images or advance review", async () => {
  command = "generate_appearance";
  const view = mount();
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "Please change this character" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Invalid creation assistant turn"));
  expect(generated).toHaveLength(0); expect(appearances).toHaveLength(0);
});
for (const end of ["end_abuse", "end_fatigue"]) test(`${end} ends chat but leaves manual editing available`, async () => {
  command = end;
  const view = mount();
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "Please change this character" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await waitFor(() => expect(view.queryByLabelText("Message the character assistant")).toBeNull());
  expect(view.getByRole("button", { name: "Advanced create" })).toBeTruthy();
  expect(generated).toHaveLength(0);
});

test("starter pills can be removed and sent without typing a prompt", async () => {
  command = "revise_character";
  const view = mount(true);
  fireEvent.click(view.getByRole("button", { name: "Add Gamer ingredient" }));
  fireEvent.click(view.getByRole("button", { name: "Add Inventor ingredient" }));
  fireEvent.click(view.getByRole("button", { name: "Remove Inventor ingredient" }));
  expect(view.queryByRole("button", { name: "Remove Inventor ingredient" })).toBeNull();
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await waitFor(() => expect(generated).toHaveLength(1));
  expect(generated[0]).toContain("Gamer");
  expect(generated[0]).not.toContain("Inventor");
  expect(view.queryByText("Character ingredients")).toBeNull();
  expect(view.queryByRole("button", { name: "Add Inventor ingredient" })).toBeNull();
  expect(view.getByRole("button", { name: "Yes, that feels right" })).toBeTruthy();
  expect(view.queryByText("Your character starts here.")).toBeNull();
  expect(view.getByRole("button", { name: "Read Character prompt" })).toBeTruthy();
});
test("a browser timeout gives a useful error and preserves the text and ingredient tags", async () => {
  globalThis.fetch = Object.assign(async () => { throw new DOMException("signal timed out", "TimeoutError"); }, { preconnect: originalFetch.preconnect });
  const view = mount(true);
  fireEvent.click(view.getByRole("button", { name: "Add Gamer ingredient" }));
  fireEvent.click(view.getByRole("button", { name: "Add Streamer ingredient" }));
  fireEvent.click(view.getByRole("button", { name: "Remove Streamer ingredient" }));
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "A suspicious dragon" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Your text and ingredients are still here"));
  expect((view.getByLabelText("Message the character assistant") as HTMLTextAreaElement).value).toBe("A suspicious dragon");
  expect(view.getByRole("button", { name: "Remove Gamer ingredient" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Add Streamer ingredient" })).toBeNull();
  expect(generated).toHaveLength(0);
  expect(view.getByText("Your character starts here.")).toBeTruthy();
});

test("appearance offers visual tags and sends them while showing a user bubble and typing indicator", async () => {
  const view = mount(true);
  command = "revise_character";
  fireEvent.click(view.getByRole("button", { name: "Add Gamer ingredient" }));
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  command = "accept_character";
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Yes, that feels right" })));
  expect(view.queryByRole("button", { name: "Add Gamer ingredient" })).toBeNull();
  for (const form of ["Human", "Halfling", "Gnome"]) {
    expect(view.getByRole("button", { name: `Add ${form} ingredient` })).toBeTruthy();
  }
  fireEvent.click(view.getByRole("button", { name: "Add Dragon ingredient" }));
  const response = Promise.withResolvers<Response>();
  globalThis.fetch = Object.assign(() => response.promise, { preconnect: originalFetch.preconnect });
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "Gold coat" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  expect((view.getByLabelText("Message the character assistant") as HTMLTextAreaElement).value).toBe("");
  expect(view.getByText("Gold coat · Dragon")).toBeTruthy();
  expect(view.getByRole("status", { name: "Assistant typing" })).toBeTruthy();
  await act(async () => response.resolve(Response.json({ command: "generate_appearance", reply: "" })));
  await waitFor(() => expect(appearances).toHaveLength(1));
  expect(appearances[0]).toContain("Dragon");
  expect(appearances[0]).toContain("Gold coat");
  expect(view.queryByRole("status", { name: "Assistant typing" })).toBeNull();
  expect(view.queryByRole("button", { name: "Remove Dragon ingredient" })).toBeNull();
});

test("gender tags allow multiple selections and suggestions return only on shuffle", () => {
  const view = mount(true);
  for (const gender of ["Male", "Female", "Non-binary"]) {
    fireEvent.click(view.getByRole("button", { name: `Add ${gender} ingredient` }));
    expect(view.getByRole("button", { name: `Remove ${gender} ingredient` })).toBeTruthy();
    expect(view.queryByRole("button", { name: `Add ${gender} ingredient` })).toBeNull();
  }
  fireEvent.click(view.getByRole("button", { name: "Remove Male ingredient" }));
  expect(view.queryByRole("button", { name: "Add Male ingredient" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: /Surprise me/ }));
  expect(view.getByRole("button", { name: "Add Male ingredient" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Add Female ingredient" })).toBeNull();
  expect(view.queryByRole("button", { name: "Add Non-binary ingredient" })).toBeNull();
});

for (const typed of [false, true]) test(`approval after text refinement preserves completed images (${typed ? "typed" : "button"})`, async () => {
  const view = mount(false, true);
  command = "revise_character";
  fireEvent.click(view.getByRole("button", { name: "Read Strategy" }));
  fireEvent.click(view.getByRole("button", { name: "Edit Strategy" }));
  fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "Make them more patient" } });
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  command = "accept_character";
  if (typed) {
    fireEvent.input(view.getByLabelText("Message the character assistant"), { target: { value: "Yes, looks right" } });
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Send" })));
  } else {
    await act(async () => fireEvent.click(view.getByRole("button", { name: "Yes, that feels right" })));
  }
  expect(view.getByRole("button", { name: "Create Agent" }).hasAttribute("disabled")).toBe(false);
  expect(view.queryByText(/What do they look like/)).toBeNull();
  expect(appearances).toHaveLength(0);
  expect(fetchCalls).toBe(typed ? 2 : 1);
});
test("approval with an unconfirmed existing image asks for headshot confirmation without regeneration", async () => {
  const view = mount(false, true, true);
  await act(async () => fireEvent.click(view.getByRole("button", { name: "Yes, that feels right" })));
  expect(view.getByRole("button", { name: "Confirm this headshot" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Create Agent" })).toBeNull();
  expect(appearances).toHaveLength(0);
  expect(fetchCalls).toBe(0);
});
