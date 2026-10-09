import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import {
  EditorState,
  Compartment,
  Facet,
  StateEffect,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import listScanner from "../src/listScanner.ts";
import createContentScript from "../src/contentScript.ts";
import type { PluginMessage } from "../src/messages.ts";

// The CM6 content script in a real CodeMirror 6 editor. jsdom has no layout,
// so CodeMirror's measuring is switched off (no animation frames); layout is
// covered by the browser tests.
const dom = new JSDOM("<body></body>");
Object.assign(dom.window, {
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
});
for (const name of [
  "window",
  "document",
  "Node",
  "Element",
  "HTMLElement",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const) {
  Object.defineProperty(globalThis, name, {
    value: (dom.window as unknown as Record<string, unknown>)[name],
    configurable: true,
  });
}
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
  "- [ ] three",
  "",
  "Text",
  "",
  "* [x] four",
].join("\n");

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

function mount(stored: Record<string, Record<string, boolean>> = {}) {
  const messages: PluginMessage[] = [];
  const context = {
    postMessage: async (message: PluginMessage) => {
      messages.push(message);
      if (message.type === "getNoteId") return { hideDone: false, noteId: "" };
      const note = (stored[message.noteId] ||= {});
      if (message.type === "setState") note[message.listId] = message.hideDone;
      return {
        hideDone: note[message.listId] === true,
        noteId: message.noteId,
      };
    },
  };
  const noteIdFacet = Facet.define<string, string>({
    combine: (v) => v[0] || "",
  });
  const setNoteIdEffect = StateEffect.define<string>();
  const note = new Compartment();
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [note.of(noteIdFacet.of("note-1"))],
    }),
    parent: dom.window.document.body,
  });
  createContentScript(context).plugin({
    cm6: view,
    addExtension: (extension) =>
      view.dispatch({ effects: StateEffect.appendConfig.of(extension) }),
    joplinExtensions: { noteIdFacet, setNoteIdEffect },
  });
  const switchNote = (noteId: string) =>
    view.dispatch({
      effects: [
        note.reconfigure(noteIdFacet.of(noteId)),
        setNoteIdEffect.of(noteId),
      ],
    });
  return { view, messages, switchNote };
}

const bars = (view: EditorView) =>
  Array.from(view.contentDOM.querySelectorAll(".chx-cm-widget")).map((bar) => {
    const toggle = bar.querySelector(".chx-cm-toggle")!;
    return [
      toggle.getAttribute("data-chx-list"),
      toggle.querySelector(".chx-cm-count")!.textContent,
      toggle.getAttribute("aria-pressed"),
    ];
  });

const hiddenLines = (view: EditorView) =>
  Array.from(view.contentDOM.querySelectorAll(".chx-cm-done-hidden")).map(
    (line) => line.textContent,
  );

const click = (view: EditorView, selector: string, index = 0) => {
  const target = view.contentDOM.querySelectorAll(selector)[index];
  target.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
};

test("one bar per Checklist, with the line rule's List IDs and counts", async () => {
  const { view } = mount();
  await settle();
  assert.deepEqual(bars(view), [
    ["list-0", "1 / 3", "false"],
    ["list-1", "1 / 2", "false"],
    ["list-2", "1 / 1", "false"],
  ]);
  view.destroy();
});

test("on load, the Hide State of every Checklist is requested for the note", async () => {
  const { view, messages } = mount();
  await settle();
  assert.deepEqual(messages, [
    { type: "getState", noteId: "note-1", listId: "list-0" },
    { type: "getState", noteId: "note-1", listId: "list-1" },
    { type: "getState", noteId: "note-1", listId: "list-2" },
  ]);
  view.destroy();
});

test("stored Hide States hide Done items, including nested ones of a hidden parent", async () => {
  const { view } = mount({ "note-1": { "list-0": true } });
  await settle();
  assert.deepEqual(hiddenLines(view), ["- [x] two", "    - [x] nested a"]);
  assert.deepEqual(bars(view)[0], ["list-0", "1 / 3", "true"]);
  view.destroy();
});

test("hiding a nested Checklist hides only its own Done items", async () => {
  const { view } = mount({ "note-1": { "list-1": true } });
  await settle();
  assert.deepEqual(hiddenLines(view), ["    - [x] nested a"]);
  view.destroy();
});

test("clicking the toggle hides, stores, and shows again", async () => {
  const stored: Record<string, Record<string, boolean>> = {};
  const { view, messages } = mount(stored);
  await settle();
  messages.length = 0;

  click(view, ".chx-cm-toggle", 2);
  await settle();
  assert.deepEqual(hiddenLines(view), ["* [x] four"]);
  assert.deepEqual(messages, [
    { type: "setState", noteId: "note-1", listId: "list-2", hideDone: true },
  ]);

  click(view, ".chx-cm-toggle", 2);
  await settle();
  assert.deepEqual(hiddenLines(view), []);
  assert.equal(stored["note-1"]["list-2"], false);
  view.destroy();
});

test("switching notes loads the new note's Hide States", async () => {
  const { view, messages, switchNote } = mount({
    "note-2": { "list-0": true },
  });
  await settle();
  messages.length = 0;
  switchNote("note-2");
  await settle();
  assert.ok(
    messages.some(
      (m) =>
        m.type === "getState" && m.noteId === "note-2" && m.listId === "list-0",
    ),
  );
  assert.deepEqual(hiddenLines(view), ["- [x] two", "    - [x] nested a"]);
  view.destroy();
});

test("editing the note updates the bars", async () => {
  const { view } = mount();
  await settle();
  view.dispatch({ changes: { from: doc.indexOf("[ ] one") + 1, insert: "x" } });
  view.dispatch({
    changes: {
      from: doc.indexOf("[ ] one") + 2,
      to: doc.indexOf("[ ] one") + 3,
    },
  });
  await settle();
  assert.deepEqual(bars(view)[0], ["list-0", "2 / 3", "false"]);
  view.destroy();
});

test("copy gives the Checklist's Markdown, as in every other view", async () => {
  const { view } = mount();
  await settle();
  copied.length = 0;
  click(view, ".chx-cm-copy", 0);
  click(view, ".chx-cm-copy", 1);
  const lines = doc.split("\n");
  const [outer, nested] = listScanner.scanLines(lines);
  assert.deepEqual(copied, [
    listScanner.listMarkdown(lines, outer),
    listScanner.listMarkdown(lines, nested),
  ]);
  assert.match(copied[0], /\n {2}- \[x\] nested a\n/);
  view.destroy();
});

test("bars and hidden lines are styled so CodeMirror can measure them", async () => {
  const { view } = mount();
  await settle();
  const css = Array.from(dom.window.document.querySelectorAll("style"))
    .map((style) => style.textContent)
    .join("\n");
  const rule = (selector: string) =>
    (css.match(new RegExp("[^}]*" + selector + "\\s*\\{([^}]*)\\}")) ||
      [])[1] || "";

  // Block widgets are measured without margins; a margin shifts every click
  // below the bar.
  assert.match(rule("\\.chx-cm-widget"), /padding-bottom/);
  assert.doesNotMatch(
    css,
    /chx-cm-(widget|toolbar)[^{]*\{[^}]*margin-(top|bottom)/,
  );
  // Hidden lines collapse instead of display: none, so a fully hidden
  // Checklist's bar can still be lined up with its items.
  assert.match(rule("\\.chx-cm-done-hidden"), /height:\s*0/);
  assert.doesNotMatch(rule("\\.chx-cm-done-hidden"), /display:\s*none/);
  view.destroy();
});

test("bars know their items' lines, for lining up with the drawn bullet", async () => {
  const { view } = mount();
  await settle();
  const offsets = Array.from(
    view.contentDOM.querySelectorAll<HTMLElement>(".chx-cm-widget"),
  ).map((bar) => bar.dataset.chxItemOffsets);
  assert.deepEqual(offsets, ["0,1,4", "0,1", "0"]);
  view.destroy();
});
