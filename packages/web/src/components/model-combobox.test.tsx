import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { Window } from "happy-dom";
import { ModelCombobox } from "./model-combobox";

const globals = ["window", "document", "navigator", "HTMLElement", "Element", "Node", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "ResizeObserver"] as const;
const original = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
let window: Window;
beforeEach(() => {
  window = new Window({ url: "http://localhost" });
  const values = {
    window, document: window.document, navigator: window.navigator,
    HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node,
    getComputedStyle: window.getComputedStyle.bind(window),
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    cancelAnimationFrame: window.cancelAnimationFrame.bind(window), ResizeObserver: window.ResizeObserver,
  };
  for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: values[key] });
});
afterEach(async () => {
  await act(async () => cleanup());
  window.close();
  for (const key of globals) {
    const descriptor = original.get(key);
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

const options = [
  { value: "default", label: "Default — Let the House decide" },
  { value: "katana:claude-opus-4-7", label: "Katana Claude Opus 4.7" },
  { value: "katana:claude-sonnet-4-6", label: "Katana Claude Sonnet 4.6" },
  { value: "openai:gpt-6-luna", label: "OpenAI GPT-6 Luna" },
];

test("filters names and exact IDs, selects with Enter, and never submits the enclosing form", async () => {
  const change = mock(), submit = mock();
  const mounted = render(<form onSubmit={event => { event.preventDefault(); submit(); }}><ModelCombobox label="Preferred model" value="default" options={options} onChange={change} /></form>);
  const input = mounted.getByRole("combobox", { name: "Preferred model" }) as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value: "KATANA opus 4.7" } });
  await waitFor(() => expect(mounted.getAllByRole("option")).toHaveLength(1));
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(change).toHaveBeenCalledWith("katana:claude-opus-4-7");
  expect(submit).not.toHaveBeenCalled();
  expect(input.getAttribute("aria-expanded")).toBe("false");
});

test("empty results and Escape preserve the saved preference; reopening clears the search", async () => {
  const change = mock();
  const mounted = render(<ModelCombobox label="Preferred model" value="openai:gpt-6-luna" options={options} onChange={change} />);
  const input = mounted.getByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value: "no-such-model" } });
  await waitFor(() => expect(mounted.getByRole("status").textContent).toBe("No matching models."));
  fireEvent.keyDown(input, { key: "Enter" });
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(input.value).toBe("OpenAI GPT-6 Luna"));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(input);
  await waitFor(() => expect(mounted.getAllByRole("option")).toHaveLength(4));
});

test("arrow navigation selects the highlighted match and pointer selection commits once", async () => {
  const change = mock();
  const mounted = render(<ModelCombobox label="Preferred model" value="default" options={options} onChange={change} />);
  const input = mounted.getByRole("combobox") as HTMLInputElement;
  fireEvent.focus(input);
  fireEvent.input(input, { target: { value: "claude" } });
  await waitFor(() => expect(mounted.getAllByRole("option")).toHaveLength(2));
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(change).toHaveBeenLastCalledWith("katana:claude-sonnet-4-6");
  fireEvent.click(input);
  await waitFor(() => expect(mounted.getAllByRole("option")).toHaveLength(4));
  fireEvent.click(mounted.getByRole("option", { name: /OpenAI GPT-6 Luna/ }));
  expect(change).toHaveBeenLastCalledWith("openai:gpt-6-luna");
  expect(change).toHaveBeenCalledTimes(2);
});

test("disabled preferences cannot open", () => {
  const mounted = render(<ModelCombobox label="Preferred model" value="default" options={options} disabled onChange={mock()} />);
  expect((mounted.getByRole("combobox") as HTMLInputElement).disabled).toBe(true);
  expect((mounted.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  expect(mounted.queryByRole("listbox")).toBeNull();
});
