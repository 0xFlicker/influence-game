import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { Window } from "happy-dom";
import { CharacterPortraitEditor } from "../app/dashboard/agents/character-portrait-editor";
import { setApiBase } from "../lib/api";

const keys = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event"] as const;
const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let dom: Window;
beforeEach(() => {
  dom = new Window({ url: "http://localhost" });
  for (const key of keys) Object.defineProperty(globalThis, key, { configurable: true, value: key === "window" ? dom : dom[key] });
  dom.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.HTMLDialogElement.prototype.close = function () { this.open = false; };
  setApiBase("https://api.example.test");
});
afterEach(() => {
  cleanup(); dom.close(); setApiBase("");
  for (const key of keys) { const descriptor = saved.get(key); if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
});
function mount() {
  return render(<CharacterPortraitEditor sourceUrl="/api/uploads/local?key=pfp/generated/test.webp" name="Vesper Vale" confirmHead onApply={() => { throw new Error("Must not confirm before loading"); }} onClose={() => {}} onPendingChange={() => {}} onFailure={() => {}} />);
}
function load(image: HTMLImageElement) {
  Object.defineProperties(image, { naturalWidth: { configurable: true, value: 1024 }, naturalHeight: { configurable: true, value: 1536 } });
  fireEvent.load(image);
}
test("failed source delivery retries without generation and recovers the same source geometry", () => {
  const view = mount();
  const image = view.getByAltText("Vesper Vale full image") as HTMLImageElement;
  expect(image.src).toBe("https://api.example.test/api/uploads/local?key=pfp/generated/test.webp");
  expect(view.queryByLabelText("Head box; drag to move")).toBeNull();
  expect(view.getByRole("button", { name: "Confirm this headshot" }).hasAttribute("disabled")).toBe(true);
  fireEvent.error(image);
  expect(view.getByRole("alert").textContent).toContain("without generating another character");
  expect(view.getByText(/The striped part/).closest("div")?.hidden).toBe(true);
  fireEvent.click(view.getByRole("button", { name: "Retry image" }));
  const retry = view.getByAltText("Vesper Vale full image") as HTMLImageElement;
  expect(retry).not.toBe(image);
  expect(retry.src).toBe(image.src);
  load(retry);
  expect(view.queryByRole("alert")).toBeNull();
  expect(view.getByLabelText("Head box; drag to move")).toBeTruthy();
  expect(view.getByRole("button", { name: "Confirm this headshot" }).hasAttribute("disabled")).toBe(false);
});
test("a load failure after successful loading invalidates crop and confirmation", () => {
  const view = mount();
  const image = view.getByAltText("Vesper Vale full image") as HTMLImageElement;
  load(image);
  fireEvent.error(image);
  expect(view.queryByAltText("Vesper Vale portrait preview")).toBeNull();
  expect(view.queryByLabelText("Head box; drag to move")).toBeNull();
  expect(view.getByRole("button", { name: "Confirm this headshot" }).hasAttribute("disabled")).toBe(true);
});
