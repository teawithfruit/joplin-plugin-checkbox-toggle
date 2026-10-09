import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import TurndownService from "@joplin/turndown";
import { gfm } from "@joplin/turndown-plugin-gfm";
import createCheckboxRenderer from "../src/checkboxRenderer.ts";

// When the rich text editor saves, Joplin turns its HTML back into Markdown
// with this turndown fork. The button bars must vanish without a trace:
// no "nullnull", and no blank line that would turn a tight list loose.
const ORIGINAL = "- [ ] Overtime\n- [x] Brochure\n    - [x] Slides\n- [ ] Next";

function toMarkdown(body: HTMLElement): string {
  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });
  turndown.use(gfm);
  return turndown.turndown(body);
}

// The rich text editor's markup for ORIGINAL; `bar(...)` adds a button bar.
function checklistHtml(
  bar: (listId: string, done: number, total: number) => string,
) {
  return (
    bar("list-0", 1, 3) +
    '<ul class="joplin-checklist"><li>Overtime</li><li class="checked">Brochure' +
    bar("list-1", 1, 1) +
    '<ul class="joplin-checklist"><li class="checked">Slides</li></ul></li>' +
    "<li>Next</li></ul>"
  );
}

test("rendered button bars convert back to the original Markdown", () => {
  const renderer = createCheckboxRenderer({ contentScriptId: "test" });
  const html = checklistHtml((listId, done, total) =>
    renderer.buildButtonHtml(
      "note-1",
      listId as `list-${number}`,
      0,
      done,
      total,
      listId !== "list-0",
    ),
  );

  assert.equal(toMarkdown(new JSDOM(html).window.document.body), ORIGINAL);
});

test("button bars inserted by the webview script convert back to the original Markdown", async () => {
  const dom = new JSDOM(checklistHtml(() => ""));
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    MutationObserver: dom.window.MutationObserver,
  });
  await import("../src/checkboxRendererBrowser.ts");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const bars = Array.from(
    dom.window.document.querySelectorAll(".chx-btn-block"),
  ).map((bar) => [bar.tagName, bar.parentElement!.tagName]);
  assert.deepEqual(bars, [
    ["DIV", "BODY"],
    ["SPAN", "LI"],
  ]);

  assert.equal(toMarkdown(dom.window.document.body), ORIGINAL);
});

// The rich text editor wraps top-level inline elements in a <p>, which would
// separate a bar from its list; only bars inside a list item may be inline.
test("rendered button bars are blocks unless they sit inside a list item", () => {
  const renderer = createCheckboxRenderer({ contentScriptId: "test" });
  const tagOf = (inline: boolean) =>
    new JSDOM(renderer.buildButtonHtml("n", "list-0", 0, 0, 1, inline)).window
      .document.body.firstElementChild!.tagName;
  assert.equal(tagOf(false), "DIV");
  assert.equal(tagOf(true), "SPAN");
});
