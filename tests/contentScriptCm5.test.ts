import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import listScanner from "../src/listScanner.ts";
import createContentScript from "../src/contentScriptCm5.ts";
import type { PluginMessage } from "../src/messages.ts";

// The CM5 content script against a fake CodeMirror 5 editor that keeps the
// widgets and line classes the script adds.
const dom = new JSDOM("<body></body>");
Object.defineProperty(globalThis, "document", {
  value: dom.window.document,
  configurable: true,
});
const copied: string[] = [];
Object.defineProperty(globalThis, "navigator", {
  value: {
    clipboard: { writeText: async (text: string) => void copied.push(text) },
  },
  configurable: true,
});

const doc = [
  "# Title",
  "- [ ] one",
  "- [x] two",
  "    - [x] nested a",
  "    - [ ] nested b",
  "",
  "* [x] three",
];

type Handler = (...args: unknown[]) => void;

function mount(stored: Record<string, boolean> = {}) {
  const lines = doc.slice();
  const widgets: Array<{
    line: number;
    node: HTMLElement;
    cleared: boolean;
    options: unknown;
  }> = [];
  const classes = new Set<string>();
  const handlers: Record<string, Handler> = {};
  const messages: PluginMessage[] = [];
  const editor = {
    lineCount: () => lines.length,
    getLine: (line: number) => lines[line],
    addLineClass: (line: number, _where: string, name: string) =>
      classes.add(line + ":" + name),
    removeLineClass: (line: number, _where: string, name: string) =>
      classes.delete(line + ":" + name),
    addLineWidget(line: number, node: HTMLElement, options: unknown) {
      const widget = {
        line,
        node,
        options,
        cleared: false,
        clear: () => (widget.cleared = true),
      };
      widgets.push(widget);
      return widget;
    },
    on: (event: string, handler: Handler) => (handlers[event] = handler),
  };
  const context = {
    postMessage: async (message: PluginMessage) => {
      messages.push(message);
      if (message.type === "getNoteId")
        return { hideDone: false, noteId: "note-1" };
      if (message.type === "setState")
        stored[message.listId] = message.hideDone;
      return { hideDone: stored[message.listId] === true, noteId: "note-1" };
    },
  };
  let option: ((this: never, enabled: unknown) => void) | undefined;
  const script = createContentScript(context);
  script.plugin({
    defineOption: (_name, _default, handler) => (option = handler),
  });
  Reflect.apply(option!, editor, [true]);
  const live = () => widgets.filter((widget) => !widget.cleared);
  return { lines, editor, live, classes, handlers, messages, script };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const hidden = (classes: Set<string>) =>
  Array.from(classes)
    .filter((name) => name.endsWith(":chx-cm5-done-hidden"))
    .map((name) => Number(name.split(":")[0]))
    .sort();

test("asks the plugin for the note, then for each Checklist's Hide State", async () => {
  const { messages } = mount();
  await settle();
  assert.deepEqual(messages, [
    { type: "getNoteId" },
    { type: "getState", noteId: "note-1", listId: "list-0" },
    { type: "getState", noteId: "note-1", listId: "list-1" },
    { type: "getState", noteId: "note-1", listId: "list-2" },
  ]);
});

test("one bar per Checklist, above its first line, lined up with its bullet", async () => {
  const { live } = mount();
  await settle();
  assert.deepEqual(
    live().map((widget) => [
      widget.line,
      widget.options,
      widget.node.querySelector(".chx-cm5-indent")!.textContent,
      widget.node.querySelector("button")!.getAttribute("data-chx-list"),
      widget.node.querySelector(".chx-cm5-count")!.textContent,
    ]),
    [
      [1, { above: true, noHScroll: true }, "", "list-0", "1 / 2"],
      [3, { above: true, noHScroll: true }, "    ", "list-1", "1 / 2"],
      [6, { above: true, noHScroll: true }, "", "list-2", "1 / 1"],
    ],
  );
});

test("a hidden Checklist hides its Done items and those of nested Checklists", async () => {
  const { classes } = mount({ "list-0": true });
  await settle();
  assert.deepEqual(hidden(classes), [2, 3]);
});

test("clicking the toggle hides, stores, and shows again", async () => {
  const stored: Record<string, boolean> = {};
  const { live, classes, messages } = mount(stored);
  await settle();
  messages.length = 0;
  live()[2].node.querySelector("button")!.click();
  assert.deepEqual(hidden(classes), [6]);
  assert.deepEqual(messages, [
    { type: "setState", noteId: "note-1", listId: "list-2", hideDone: true },
  ]);
  live()[2].node.querySelector("button")!.click();
  assert.deepEqual(hidden(classes), []);
  assert.equal(stored["list-2"], false);
});

test("copy gives the Checklist's Markdown, as in every other view", async () => {
  const { live } = mount();
  await settle();
  copied.length = 0;
  live()[0].node.querySelectorAll("button")[1].click();
  const [outer] = listScanner.scanLines(doc);
  assert.deepEqual(copied, [listScanner.listMarkdown(doc, outer)]);
});

test("loading another document reloads the Hide States", async () => {
  const { handlers, messages } = mount();
  await settle();
  messages.length = 0;
  handlers.swapDoc();
  await settle();
  assert.equal(messages[0].type, "getNoteId");
  messages.length = 0;
  handlers.changes({}, [{ origin: "setValue" }]);
  await settle();
  assert.equal(messages[0].type, "getNoteId");
});

test("typing re-renders the bars without asking the plugin again", async () => {
  const { lines, live, handlers, messages } = mount();
  await settle();
  messages.length = 0;
  lines[1] = "- [x] one";
  handlers.changes({}, [{ origin: "+input" }]);
  await settle();
  assert.equal(
    live()[0].node.querySelector(".chx-cm5-count")!.textContent,
    "2 / 2",
  );
  assert.deepEqual(messages, []);
});

test("does nothing in CodeMirror 6 or without an editor", () => {
  const script = createContentScript(undefined);
  let defined = false;
  script.plugin({ cm6: {}, defineOption: () => (defined = true) });
  script.plugin(undefined);
  assert.equal(defined, false);

  let option: ((this: never, enabled: unknown) => void) | undefined;
  script.plugin({ defineOption: (_n, _d, handler) => (option = handler) });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => Reflect.apply(option!, undefined, [true]));
  } finally {
    console.warn = warn;
  }
});
