import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { JSDOM } from "jsdom";
import createCheckboxRenderer from "../src/checkboxRenderer.ts";
import type { PluginMessage } from "../src/messages.ts";

// The webview script in a preview page, talking to a fake plugin through
// window.webviewApi like Joplin's viewer does.
const note = "- [x] a\n- [ ] b\n    - [x] c\n    - [ ] d\n\nText\n\n- [ ] e";

function joplinCheckboxes(html: string): string {
  return html.replace(
    /(<li[^>]*>)\[([ xX])\] /g,
    (_match, item: string, mark: string) =>
      item + '<input type="checkbox"' + (mark === " " ? "" : " checked") + "> ",
  );
}

const md = new MarkdownIt();
createCheckboxRenderer({ contentScriptId: "test" }).plugin(md, {
  noteId: "note-1",
});
const dom = new JSDOM(joplinCheckboxes(md.render(note)));

// The plugin side: list-1 starts hidden.
const stored: Record<string, boolean> = { "list-1": true };
const messages: Array<{ id: string; message: PluginMessage }> = [];
Object.assign(dom.window, {
  webviewApi: {
    postMessage: async (id: string, message: PluginMessage) => {
      messages.push({ id, message });
      if (message.type === "setState")
        stored[message.listId] = message.hideDone;
      const listId = message.type === "getNoteId" ? "" : message.listId;
      return { hideDone: stored[listId] === true, noteId: "note-1", listId };
    },
  },
});
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  MutationObserver: dom.window.MutationObserver,
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
const ready = import("../src/checkboxRendererBrowser.ts").then(settle);
const doc = dom.window.document;
const lists = () =>
  Array.from(doc.querySelectorAll<HTMLElement>("ul.chx-list"));
const toggles = () =>
  Array.from(doc.querySelectorAll<HTMLButtonElement>("button.chx-toggle"));
const isHidden = (index: number) =>
  lists()[index].classList.contains("chx-done-hidden");

test("on load, every bar asks the plugin for its Hide State", async () => {
  await ready;
  const loads = messages.filter((entry) => entry.message.type === "getState");
  assert.deepEqual(
    loads.map((entry) => [entry.id, entry.message]),
    ["list-0", "list-1", "list-2"].map((listId) => [
      "checkboxHideMarkdown",
      { type: "getState", noteId: "note-1", listId },
    ]),
  );
});

test("a stored Hide State is applied on load", async () => {
  await ready;
  assert.deepEqual(
    [isHidden(0), isHidden(1), isHidden(2)],
    [false, true, false],
  );
  const toggle = toggles()[1];
  assert.equal(toggle.getAttribute("aria-pressed"), "true");
  assert.ok(toggle.classList.contains("chx-hidden"));
  assert.equal(
    toggle.querySelector(".chx-action")!.textContent,
    "Show completed",
  );
});

test("toggling hides and shows Done items and stores the Hide State", async () => {
  await ready;
  messages.length = 0;
  toggles()[0].click();
  await settle();
  assert.equal(isHidden(0), true);
  assert.equal(toggles()[0].getAttribute("aria-pressed"), "true");
  assert.equal(
    toggles()[0].querySelector(".chx-action")!.textContent,
    "Show completed",
  );
  assert.deepEqual(
    messages.map((entry) => entry.message),
    [{ type: "setState", noteId: "note-1", listId: "list-0", hideDone: true }],
  );

  toggles()[0].click();
  await settle();
  assert.equal(isHidden(0), false);
  assert.equal(stored["list-0"], false);
  assert.equal(
    toggles()[0].querySelector(".chx-action")!.textContent,
    "Hide completed",
  );
});

test("toggling one list leaves the others alone", async () => {
  await ready;
  toggles()[2].click();
  await settle();
  assert.deepEqual(
    [isHidden(0), isHidden(1), isHidden(2)],
    [false, true, true],
  );
  toggles()[2].click();
  await settle();
});

test("an item ticked in a hidden list is marked done at once (so it hides)", async () => {
  await ready;
  const item = lists()[1].querySelectorAll(":scope > li")[1];
  assert.ok(item.classList.contains("chx-undone"));
  (item.querySelector("input") as HTMLInputElement).click();
  await settle();
  assert.ok(item.classList.contains("chx-done"));
  assert.equal(doc.querySelectorAll(".chx-count")[1].textContent, "2 / 2");
});

test("the page settles: nothing keeps changing after the script ran", async () => {
  await ready;
  let changes = 0;
  const watcher = new dom.window.MutationObserver((records) => {
    changes += records.length;
  });
  watcher.observe(doc.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  watcher.disconnect();
  assert.equal(changes, 0);
});

test("buttons are set up once, however often the page changes", async () => {
  await ready;
  messages.length = 0;
  doc.body.appendChild(doc.createElement("p"));
  doc.body.appendChild(doc.createElement("p"));
  await settle();
  toggles()[0].click();
  await settle();
  assert.equal(
    messages.filter((entry) => entry.message.type === "setState").length,
    1,
  );
  assert.equal(
    messages.filter((entry) => entry.message.type === "getState").length,
    0,
  );
  toggles()[0].click();
  await settle();
});

test("without the Clipboard API, copying puts the Markdown into the copy event", async () => {
  await ready;
  const data: Record<string, string> = {};
  const reachedEditor: string[] = [];
  doc.body.addEventListener("copy", () => reachedEditor.push("copy"));
  doc.execCommand = ((command: string) => {
    assert.equal(command, "copy");
    const event = new dom.window.Event("copy", {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, "clipboardData", {
      value: { setData: (type: string, value: string) => (data[type] = value) },
    });
    doc.body.dispatchEvent(event);
    return true;
  }) as typeof doc.execCommand;

  doc.querySelectorAll<HTMLButtonElement>("button.chx-copy")[1].click();
  await settle();

  assert.deepEqual(data, { "text/plain": "- [x] c\n- [x] d" });
  assert.deepEqual(reachedEditor, []);
});
