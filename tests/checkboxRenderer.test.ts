import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { JSDOM } from "jsdom";
import listScanner from "../src/listScanner.ts";
import createCheckboxRenderer from "../src/checkboxRenderer.ts";

function render(markdown: string, noteId?: string): Document {
  const md = new MarkdownIt();
  createCheckboxRenderer({ contentScriptId: "test" }).plugin(
    md,
    noteId === undefined ? undefined : { noteId },
  );
  return new JSDOM(md.render(markdown)).window.document;
}

const bars = (document: Document) =>
  Array.from(document.querySelectorAll<HTMLElement>(".chx-btn-block"));

test("every Checklist gets exactly one Button bar, right before its list", () => {
  const document = render(
    "- [ ] a\n    - [x] b\n- [ ] c\n\nText\n\n- plain\n- list\n\n* [x] d",
  );
  const found = bars(document).map((bar) => [
    bar.querySelector(".chx-toggle")!.getAttribute("data-chx-list"),
    bar.nextElementSibling!.tagName,
    bar.nextElementSibling!.getAttribute("data-chx-list"),
  ]);
  assert.deepEqual(found, [
    ["list-0", "UL", "list-0"],
    ["list-1", "UL", "list-1"],
    ["list-2", "UL", "list-2"],
  ]);
  assert.equal(document.querySelectorAll("ul").length, 4);
});

test("the renderer needs no checkbox tokens (the rich text editor has none)", () => {
  // Plain markdown-it produces no checkbox_input tokens, like Joplin's rich
  // text editor rendering; the bars still appear.
  assert.equal(bars(render("- [ ] a\n- [x] b")).length, 1);
});

test("top-level bars are blocks, bars of nested Checklists are inline", () => {
  const document = render("- [ ] a\n    - [x] b");
  assert.deepEqual(
    bars(document).map((bar) => [bar.tagName, bar.parentElement!.tagName]),
    [
      ["DIV", "BODY"],
      ["SPAN", "LI"],
    ],
  );
  for (const bar of bars(document)) {
    for (const element of bar.querySelectorAll("*")) {
      if (bar.tagName === "SPAN") {
        assert.ok(
          ["SPAN", "BUTTON", "svg", "rect", "path", "polyline"].includes(
            element.tagName,
          ),
          `inline bar contains a ${element.tagName}`,
        );
      }
    }
  }
});

test("each bar is an editable block whose source converts back to nothing", () => {
  for (const bar of bars(render("- [ ] a\n    - [x] b"))) {
    assert.ok(bar.classList.contains("joplin-editable"));
    const source = bar.firstElementChild!;
    assert.ok(source.classList.contains("joplin-source"));
    // Joplin rebuilds the block as open + text + close; missing attributes
    // would come back as the text "null".
    assert.equal(source.getAttribute("data-joplin-source-open"), "");
    assert.equal(source.getAttribute("data-joplin-source-close"), "");
    assert.equal(source.textContent, "");
    assert.ok(source.hasAttribute("hidden"));
  }
});

test("lists and items are marked with their List ID, counts and done state", () => {
  const document = render("- [x] a\n- [ ] b\n    - [x] c\n    - [x] d");
  const [outer, inner] = Array.from(document.querySelectorAll("ul"));
  assert.ok(outer.classList.contains("chx-list"));
  assert.deepEqual(
    ["data-chx-list", "data-chx-done", "data-chx-total", "data-chx-depth"].map(
      (name) => inner.getAttribute(name),
    ),
    ["list-1", "2", "2", "1"],
  );
  const classes = (list: Element) =>
    Array.from(list.children)
      .filter((item) => item.tagName === "LI")
      .map((item) => item.className);
  assert.deepEqual(classes(outer), ["chx-done", "chx-undone"]);
  assert.deepEqual(classes(inner), ["chx-done", "chx-done"]);
});

test("toggle and copy buttons carry note, list and counts", () => {
  const [bar] = bars(render("- [x] a\n- [ ] b", "note-7"));
  const toggle = bar.querySelector(".chx-toggle")!;
  const copy = bar.querySelector(".chx-copy")!;
  assert.equal(toggle.getAttribute("data-chx-note"), "note-7");
  assert.equal(toggle.getAttribute("data-chx-list"), "list-0");
  assert.equal(toggle.getAttribute("aria-pressed"), "false");
  assert.equal(bar.querySelector(".chx-count")!.textContent, "1 / 2");
  assert.equal(copy.getAttribute("data-chx-note"), "note-7");
  assert.equal(copy.getAttribute("data-chx-list"), "list-0");
});

test("without options the bars carry an empty note ID", () => {
  const [bar] = bars(render("- [ ] a"));
  assert.equal(
    bar.querySelector(".chx-toggle")!.getAttribute("data-chx-note"),
    "",
  );
});

test("the copy button carries the Checklist's Markdown exactly, whatever it contains", () => {
  const markdown = [
    "- [ ] quotes \"double\" and 'single' & ampersands",
    "- [x] <b>html</b> and > arrows",
    "    - [ ] **bold** [link](https://example.com/?a=1&b=2) `code`",
  ].join("\n");
  const lines = markdown.split("\n");
  const [outer, inner] = listScanner.scanLines(lines);
  const document = render(markdown);
  const copies = Array.from(document.querySelectorAll(".chx-copy")).map(
    (copy) => copy.getAttribute("data-chx-markdown"),
  );
  assert.deepEqual(copies, [
    listScanner.listMarkdown(lines, outer),
    listScanner.listMarkdown(lines, inner),
  ]);
});

test("CSS hides Done items of a hidden list without relying on the list's class", () => {
  const css = createCheckboxRenderer({ contentScriptId: "test" })
    .assets({})
    .find((asset) => asset.name === "chx-style")!.text!;
  assert.match(
    css,
    /(^|\})\.chx-done-hidden li\.chx-done \{ display: none; \}/,
  );
  assert.match(css, /\.chx-btn-block \{ display: block;/);
  assert.match(css, /\.chx-toolbar \{[^}]*width: fit-content;/);
});

test("CSS uses the theme's colours", () => {
  const css = createCheckboxRenderer({ contentScriptId: "test" })
    .assets({ color: "#123456", dividerColor: "#abcdef" })
    .find((asset) => asset.name === "chx-style")!.text!;
  assert.match(css, /#123456/);
  assert.match(css, /#abcdef/);
});
