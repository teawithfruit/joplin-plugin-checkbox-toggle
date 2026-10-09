import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import createCheckboxRenderer from "../src/checkboxRenderer.ts";

// The webview script's copy button rebuilds a Checklist's Markdown from the
// rendered page. A nested Button bar sits inside its parent item, so its
// label must not end up in the copied text.
const renderer = createCheckboxRenderer({ contentScriptId: "test" });
const dom = new JSDOM(
  renderer.buildButtonHtml("note-1", "list-0", 0, 1, 3) +
    '<ul class="joplin-checklist"><li>Overtime</li><li class="checked">Brochure' +
    renderer.buildButtonHtml("note-1", "list-1", 1, 1, 1, true) +
    '<ul class="joplin-checklist"><li class="checked">Slides</li></ul></li>' +
    "<li>Next</li></ul>",
);
const copied: string[] = [];
Object.defineProperty(dom.window.navigator, "clipboard", {
  value: { writeText: async (text: string) => void copied.push(text) },
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

test("copying a Checklist leaves out nested Button bars", async () => {
  await import("../src/checkboxRendererBrowser.ts");
  await new Promise((resolve) => setTimeout(resolve, 0));

  (
    dom.window.document.querySelector("button.chx-copy") as HTMLButtonElement
  ).click();

  assert.deepEqual(copied, [
    "- [ ] Overtime\n- [x] Brochure\n  - [x] Slides\n- [ ] Next",
  ]);
});
