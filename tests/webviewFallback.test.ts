import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";

// A rich text page the renderer added no Button bars to: the webview script
// adds them itself (its fallback), numbering Checklists in page order.
const dom = new JSDOM(
  '<h2>A</h2><ul class="joplin-checklist"><li class="checked">a</li><li>b' +
    '<ul class="joplin-checklist"><li>c</li></ul></li></ul>' +
    "<p>x</p><ul><li>plain</li></ul>" +
    '<ul data-is-checklist="1"><li>d</li><li class="checked">e</li></ul>',
);
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  MutationObserver: dom.window.MutationObserver,
});
const doc = dom.window.document;
const ready = new Promise<void>((resolve) => {
  if (doc.readyState !== "loading") resolve();
  else doc.addEventListener("DOMContentLoaded", () => resolve());
})
  .then(() => import("../src/checkboxRendererBrowser.ts"))
  .then(() => new Promise((resolve) => setTimeout(resolve, 10)));

test("the fallback adds one bar per Checklist, numbered in page order", async () => {
  await ready;
  const bars = Array.from(doc.querySelectorAll(".chx-btn-block"));
  assert.deepEqual(
    bars.map((bar) => [
      bar.hasAttribute("data-chx-fallback"),
      bar.querySelector(".chx-toggle")!.getAttribute("data-chx-list"),
      bar.querySelector(".chx-count")!.textContent,
      bar.nextElementSibling!.tagName,
    ]),
    [
      [true, "list-0", "1 / 2", "UL"],
      [true, "list-1", "0 / 1", "UL"],
      [true, "list-2", "1 / 2", "UL"],
    ],
  );
});

test("the fallback page settles: nothing keeps changing after the script ran", async () => {
  // classList.add() rewrites the class attribute even when nothing changes;
  // reacting to every class write once made the script re-trigger itself.
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

test("ticking a rich text item still updates the count on the fallback page", async () => {
  await ready;
  doc
    .querySelectorAll("ul.joplin-checklist")[1]
    .querySelector("li")!
    .classList.add("checked");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(doc.querySelectorAll(".chx-count")[1].textContent, "1 / 1");
});
