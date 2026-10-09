import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { JSDOM } from "jsdom";
import listScanner from "../src/listScanner.ts";
import createCheckboxRenderer from "../src/checkboxRenderer.ts";

// Copying a Checklist from the preview or rich text editor must give exactly
// the Markdown the Markdown editors copy: same formatting, same indentation.
const note = [
  "## General",
  "- [x] Figma invoice",
  "- [ ] **Important** use [the licence](https://example.com/a+b) and `code`",
  "- [ ] Experts search",
  "    - [ ] Chat with someone",
  "    - [x] Challenge  ",
  "      second line",
].join("\n");

// Stand-in for Joplin's checkbox rule, which tests cannot load.
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

const lines = note.split("\n");
const [outer, nested] = listScanner.scanLines(lines);
const $ = (selector: string) => dom.window.document.querySelector(selector)!;
const copyButtons = () =>
  Array.from(
    dom.window.document.querySelectorAll<HTMLButtonElement>("button.chx-copy"),
  );
const ready = import("../src/checkboxRendererBrowser.ts").then(
  () => new Promise((resolve) => setTimeout(resolve, 0)),
);

test("copies the same Markdown as the Markdown editors", async () => {
  await ready;
  copied.length = 0;
  copyButtons()[0].click();
  copyButtons()[1].click();

  assert.deepEqual(copied, [
    listScanner.listMarkdown(lines, outer),
    listScanner.listMarkdown(lines, nested),
  ]);
  assert.match(copied[0], /\*\*Important\*\* use \[the licence\]/);
  assert.match(copied[0], /\n {2}- \[ \] Chat with someone\n/);
});

test("copies checkbox states as they are now, not as they were rendered", async () => {
  await ready;
  copied.length = 0;
  ($("ul li:first-child input") as HTMLInputElement).click();
  copyButtons()[0].click();

  assert.equal(
    copied[0],
    listScanner
      .listMarkdown(lines, outer)
      .replace("- [x] Figma", "- [ ] Figma"),
  );
});
