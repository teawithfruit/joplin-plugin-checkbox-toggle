import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import createCheckboxRenderer from "../src/checkboxRenderer.ts";

// The webview script runs as soon as it is imported, so the DOM it works on
// is set up once for the whole file.
const renderer = createCheckboxRenderer({ contentScriptId: "test" });
const dom = new JSDOM(
  `<body>
    ${renderer.buildButtonHtml("note-1", "list-0", 0, 1, 2)}
    <ul class="chx-list" data-chx-list="list-0">
      <li class="chx-undone" id="open"><input type="checkbox"> open</li>
      <li class="chx-done" id="done"><input type="checkbox" checked> done</li>
    </ul>
    <p>rich text</p>
    ${renderer.buildButtonHtml("note-1", "list-1", 0, 1, 2)}
    <ul class="joplin-checklist">
      <li id="rte-open">rte open</li>
      <li class="checked">rte done</li>
    </ul>
    <p>a list the line rule did not match</p>
    <ul class="joplin-checklist"><li>unmatched</li></ul>
  </body>`,
);
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  MutationObserver: dom.window.MutationObserver,
});

const ready = new Promise<void>((resolve) => {
  if (dom.window.document.readyState !== "loading") resolve();
  else
    dom.window.document.addEventListener("DOMContentLoaded", () => resolve());
}).then(() => import("../src/checkboxRendererBrowser.ts"));

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const $ = (selector: string) => dom.window.document.querySelector(selector)!;
const counts = () =>
  Array.from(dom.window.document.querySelectorAll(".chx-count")).map(
    (count) => count.textContent,
  );

test("counts follow preview checkboxes as they are toggled", async () => {
  await ready;
  assert.deepEqual(counts(), ["1 / 2", "1 / 2"]);

  ($("#open input") as HTMLInputElement).click();
  await settle();
  assert.equal(counts()[0], "2 / 2");
  assert.ok($("#open").classList.contains("chx-done"));

  // The checked attribute stays on an unchecked box; only the property flips.
  ($("#done input") as HTMLInputElement).click();
  await settle();
  assert.equal(counts()[0], "1 / 2");
  assert.ok($("#done").classList.contains("chx-undone"));
});

test("counts follow rich text checklist items as they are toggled", async () => {
  await ready;

  $("#rte-open").classList.add("checked");
  await settle();
  assert.equal(counts()[1], "2 / 2");
});

test("lists without a rendered Button bar get no competing one", async () => {
  await ready;
  assert.equal(
    dom.window.document.querySelectorAll(".chx-btn-block").length,
    2,
  );
});

// Regression guard: the rich text editor (TinyMCE) treats a Button bar as a
// non-editable block; if a press reaches it, it selects the whole bar (blue
// frame) and Joplin then copies that selection instead of the Checklist.
test("presses on a Button bar do not reach the rich text editor", async () => {
  await ready;
  const reached: string[] = [];
  for (const type of [
    "pointerdown",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
  ]) {
    dom.window.document.body.addEventListener(type, () => reached.push(type));
  }
  const copy = $(".chx-btn-block button.chx-copy");
  const mousedown = new dom.window.MouseEvent("mousedown", {
    bubbles: true,
    cancelable: true,
  });
  copy.dispatchEvent(
    new dom.window.PointerEvent("pointerdown", { bubbles: true }),
  );
  copy.dispatchEvent(mousedown);
  copy.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
  (copy as HTMLButtonElement).click();
  copy.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true }));

  assert.deepEqual(reached, []);
  assert.ok(mousedown.defaultPrevented, "mousedown must not focus or select");
});
