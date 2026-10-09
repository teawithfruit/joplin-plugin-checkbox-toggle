import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { JSDOM } from "jsdom";
import listScanner from "../src/listScanner.ts";
import createCheckboxRenderer from "../src/checkboxRenderer.ts";

// One Checklist identity rule (docs/adr/0001): the same note text must yield
// the same Checklists, List IDs, counts and nesting in every view. The
// editors call listScanner.scanLines directly; the preview and rich text
// editor get their Button bars from the markdown-it renderer.

interface Seen {
  listId: string;
  done: number;
  total: number;
  depth: number;
}

function fromLines(markdown: string): Seen[] {
  return listScanner.scanLines(markdown.split("\n")).map((list) => ({
    listId: list.listId,
    done: list.done,
    total: list.total,
    depth: list.depth,
  }));
}

// Reads the Checklists a rendered page exposes: one Button bar per Checklist,
// directly followed by the Checklist's <ul>.
function fromRenderer(markdown: string): Seen[] {
  const md = new MarkdownIt();
  createCheckboxRenderer({ contentScriptId: "test" }).plugin(md, {
    noteId: "n1",
  });
  const { document } = new JSDOM(md.render(markdown)).window;
  return Array.from(document.querySelectorAll(".chx-btn-block")).map((bar) => {
    const toggle = bar.querySelector("button.chx-toggle")!;
    const list = bar.nextElementSibling!;
    assert.equal(list.tagName, "UL");
    assert.equal(
      list.getAttribute("data-chx-list"),
      toggle.getAttribute("data-chx-list"),
    );
    return {
      listId: toggle.getAttribute("data-chx-list")!,
      done: Number(toggle.getAttribute("data-chx-done")),
      total: Number(toggle.getAttribute("data-chx-total")),
      depth: Number(bar.getAttribute("data-chx-depth")),
    };
  });
}

function assertSameChecklists(markdown: string, expected: Seen[]) {
  assert.deepEqual(fromLines(markdown), expected, "editors (line rule)");
  assert.deepEqual(fromRenderer(markdown), expected, "preview / rich text");
}

const checklist = (
  listId: string,
  done: number,
  total: number,
  depth = 0,
): Seen => ({ listId, done, total, depth });

test("blank lines between items do not split a Checklist", () => {
  assertSameChecklists("- [ ] a\n\n- [x] b", [checklist("list-0", 1, 2)]);
});

test("a list with a plain item is not a Checklist and takes no List ID", () => {
  assertSameChecklists("- [ ] a\n- plain\n- [ ] b\n\nText\n\n- [x] c", [
    checklist("list-0", 1, 1),
  ]);
});

test("a change of bullet marker starts a new Checklist", () => {
  assertSameChecklists("- [ ] a\n- [x] b\n* [x] c\n+ [ ] d", [
    checklist("list-0", 1, 2),
    checklist("list-1", 1, 1),
    checklist("list-2", 0, 1),
  ]);
});

test("nested Checklists have their own List ID", () => {
  assertSameChecklists("- [ ] a\n  - [x] b\n    - [ ] c\n- [x] d", [
    checklist("list-0", 1, 2),
    checklist("list-1", 1, 1, 1),
    checklist("list-2", 0, 1, 2),
  ]);
});

test("checkbox lines inside fenced code are not Checklists", () => {
  assertSameChecklists(
    "```\n- [ ] not a list\n```\n\n~~~md\n- [x] nor this\n~~~\n\n- [x] a",
    [checklist("list-0", 1, 1)],
  );
});

test("indented continuation lines stay inside their item", () => {
  assertSameChecklists(
    "- [x] a\n  more about a\n\n  ```\n  - [ ] code\n  ```\n- [ ] b\n  - [ ] c\n  after c\n- [x] d",
    [checklist("list-0", 2, 3), checklist("list-1", 0, 1, 1)],
  );
});

test("a typical note yields the same Checklists in every view", () => {
  const note = [
    "## General",
    "- [x] first",
    "- [ ] **Important** second (https://example.com/a+b)",
    "- [ ] third",
    "    - [ ] nested one",
    "    - [ ] nested two",
    "",
    "### Person",
    "- [ ] topic",
    "- [x] brochure",
    "    - [x] slides",
    "    - [x] review",
    "- [x] meeting with someone  ",
    "    someone@example.com  ",
    "    one hour",
    "- [ ] think ahead",
    "    - [ ] hire someone?",
    "        - [ ] full stack",
    "    - [ ] other option",
    "",
    "* * *",
    "",
    "## Next",
    "",
    "- [x] done",
  ].join("\n");
  assertSameChecklists(note, [
    checklist("list-0", 1, 3),
    checklist("list-1", 0, 2, 1),
    checklist("list-2", 2, 4),
    checklist("list-3", 2, 2, 1),
    checklist("list-4", 0, 2, 1),
    checklist("list-5", 0, 1, 2),
    checklist("list-6", 1, 1),
  ]);
});

test("the editors' copy of a Checklist covers its continuation lines", () => {
  const lines = ["Intro", "- [x] a", "  more", "", "- [ ] b", "", "After"];
  const [list] = listScanner.scanLines(lines);
  assert.equal(
    listScanner.listMarkdown(lines, list),
    "- [x] a\n  more\n\n- [ ] b",
  );
});

test("headings directly above lists and thematic breaks between them", () => {
  assertSameChecklists(
    "## A\n- [x] a\n- [ ] b\n\n* * *\n\n### B\n- [ ] c\n    - [x] d",
    [
      checklist("list-0", 1, 2),
      checklist("list-1", 0, 1),
      checklist("list-2", 1, 1, 1),
    ],
  );
});

test("ordered lists and block quotes take no List ID in any view", () => {
  assertSameChecklists("1. [ ] a\n\n> - [ ] b\n\n- [x] c", [
    checklist("list-0", 1, 1),
  ]);
});

test("a Checklist with continuation paragraphs and hard line breaks", () => {
  assertSameChecklists(
    "- [x] meeting  \n    mail@example.com  \n    one hour\n- [ ] next\n    - [ ] sub",
    [checklist("list-0", 1, 2), checklist("list-1", 0, 1, 1)],
  );
});

test("empty and upper-case checkbox items", () => {
  assertSameChecklists("- [X] a\n- [ ] \n- [x] c", [checklist("list-0", 2, 3)]);
});
